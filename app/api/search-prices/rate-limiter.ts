import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logInfo, logWarn } from '@/lib/shared/logger'

const LOG_SCOPE = "bahn-api.rate-limiter"

/* Globales Rate Limiting für alle API-Calls
Die Bahn-API hat strenge Limits, daher ist ein globales Rate Limiting notwendig.
Bei unerwarteten 429-Fehlern wird zusätzlich adaptiv gebremst.
Wir verwenden eine Round-Robin-Queue für Sessions, um Requests effizient zu verarbeiten.
In der Standardkonfiguration werden max. 30 Requests pro Minute zugelassen.
*/
interface QueuedRequest {
  id: string
  sessionId?: string  // Session ID für Abbruch-Prüfung
  execute: () => Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  timestamp: number
}

class GlobalRateLimiter {
  private sessionQueues = new Map<string, QueuedRequest[]>() // Separate Queue pro Session
  private sessionRoundRobin: string[] = [] // Round-Robin Liste der Sessions
  private currentSessionIndex = 0 // Aktueller Index im Round-Robin
  private lastApiCallStart = 0 // Wann der letzte API-Call GESTARTET wurde
  private activeRequests = 0
  
  // Interne Cancel-Session Verwaltung
  private cancelledSessions = new Set<string>() // Cancelled Sessions
  
  // Konfiguration - konsolidiert für bessere Wartbarkeit
  private readonly config = {
    baseInterval: Number(process.env.RL_BASE_INTERVAL_MS ?? 450),
    rollingLimitCount: Number(process.env.RL_ROLLING_LIMIT_COUNT ?? 30),
    rollingLimitWindow: Number(process.env.RL_ROLLING_LIMIT_WINDOW_MS ?? 60 * 1000),
    rollingLimitSafetyBuffer: Number(process.env.RL_ROLLING_LIMIT_SAFETY_MS ?? 1000),
    pacingStartCount: Number(process.env.RL_PACING_START_COUNT ?? 10),
    minPacedInterval: Number(process.env.RL_MIN_PACED_INTERVAL_MS ?? 1250),
    maxInterval: Number(process.env.RL_MAX_INTERVAL_MS ?? 12000),
    maxRetries: 3,
    cleanupInterval: 15000, // 15 Sekunden (erhöht für weniger CPU-Last)
    sessionCancelTimeout: 3 * 60 * 1000, // 3 Minuten (reduziert)
    completedSessionTimeout: 30 * 1000 // 30 Sekunden (reduziert)
  }

  private minInterval = this.config.baseInterval
  private readonly maxConcurrentRequests = Number(process.env.RL_MAX_CONCURRENT_REQUESTS ?? 3)
  
  // Request-Tracking für DB-API Limits
  private requestHistory: number[] = [] // Timestamps der letzten Requests
  private processingTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Starte regelmäßigen Cleanup abgebrochener Sessions
    this.cleanupTimer = setInterval(() => {
      this.cleanupCancelledSessions()
    }, this.config.cleanupInterval)
  }

  async addToQueue<T>(requestId: string, apiCall: () => Promise<T>, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestId,
        sessionId,
        execute: apiCall,
        resolve,
        reject,
        timestamp: Date.now()
      }
      
      // Verwende 'default' als sessionId falls keine angegeben
      const effectiveSessionId = sessionId || 'default'
      
      // Erstelle Queue für Session falls nicht vorhanden
      if (!this.sessionQueues.has(effectiveSessionId)) {
        this.sessionQueues.set(effectiveSessionId, [])
        this.sessionRoundRobin.push(effectiveSessionId)
        logDebug(LOG_SCOPE, "Session added to round-robin queue", { sessionId: effectiveSessionId })
      }
      
      // Füge Request zur Session-Queue hinzu
      this.sessionQueues.get(effectiveSessionId)!.push(queuedRequest)
      
      const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
      logDebug(LOG_SCOPE, "Request queued", {
        requestId,
        sessionId: effectiveSessionId,
        queueSize: totalRequests,
        activeSessions: this.sessionQueues.size,
      })
      
      // Starte Verarbeitung falls noch nicht aktiv
      this.scheduleNextProcessing()
    })
  }

  private scheduleNextProcessing() {
    // Wenn bereits ein Timer läuft oder keine Anfragen in den Queues, mache nichts
    const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    if (this.processingTimer || totalRequests === 0 || this.activeRequests >= this.maxConcurrentRequests) {
      return
    }

    // Bestimme aktuelles Rate-Limit basierend auf Request-Historie
    this.updateRateLimit()

    // Berechne wann der nächste Request starten kann
    const now = Date.now()
    const timeSinceLastStart = now - this.lastApiCallStart
    const intervalDelay = Math.max(0, this.minInterval - timeSinceLastStart)
    const pacingDelay = this.getRollingWindowPacingDelay(now)
    const rollingWindowDelay = this.getRollingWindowDelay(now)
    const delay = Math.max(intervalDelay, pacingDelay, rollingWindowDelay)

    logDebug(LOG_SCOPE, "Next request processing scheduled", {
      delayMs: delay,
      intervalDelayMs: intervalDelay,
      pacingDelayMs: pacingDelay,
      rollingWindowDelayMs: rollingWindowDelay,
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.maxConcurrentRequests,
      intervalMs: this.minInterval,
      rollingLimitCount: this.config.rollingLimitCount,
      rollingLimitWindowMs: this.config.rollingLimitWindow,
    })
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null
      this.processNextRequest()
    }, delay)
  }

  private async processNextRequest() {
    // Prüfe ob wir verarbeiten können
    const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    if (totalRequests === 0 || this.activeRequests >= this.maxConcurrentRequests) {
      return
    }

    // Cleanup abgebrochene Sessions BEVOR wir Round-Robin machen
    this.cleanupCancelledSessions()

    // Round-Robin: Finde nächste Session mit Requests
    let request: QueuedRequest | null = null
    let attempts = 0
    const maxAttempts = this.sessionRoundRobin.length
    
    while (!request && attempts < maxAttempts) {
      // Cleanup: Entferne leere Sessions aus Round-Robin
      this.sessionRoundRobin = this.sessionRoundRobin.filter(sessionId => {
        const queue = this.sessionQueues.get(sessionId)
        if (!queue || queue.length === 0) {
          this.sessionQueues.delete(sessionId)
          return false
        }
        return true
      })
      
      // Wenn keine Sessions mehr vorhanden, beende
      if (this.sessionRoundRobin.length === 0) {
        return
      }
      
      // Normalisiere Index falls außerhalb des Bereichs
      if (this.currentSessionIndex >= this.sessionRoundRobin.length) {
        this.currentSessionIndex = 0
      }
      
      const currentSessionId = this.sessionRoundRobin[this.currentSessionIndex]
      const sessionQueue = this.sessionQueues.get(currentSessionId)
      
      if (sessionQueue && sessionQueue.length > 0) {
        // Prüfe Session-Abbruch BEVOR Request aus Queue genommen wird
        if (currentSessionId !== 'default' && this.isSessionCancelledSync(currentSessionId)) {
          // Entferne Session aus Round-Robin und Queue
          this.sessionQueues.delete(currentSessionId)
          this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== currentSessionId)
          if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
            this.currentSessionIndex = 0
          }
          attempts++
          continue
        }
        
        request = sessionQueue.shift()!
        logDebug(LOG_SCOPE, "Round-robin request selected", {
          sessionId: currentSessionId,
          remainingSessionRequests: sessionQueue.length,
        })
      }
      
      // Gehe zur nächsten Session
      this.currentSessionIndex = (this.currentSessionIndex + 1) % this.sessionRoundRobin.length
      attempts++
    }
    
    if (!request) {
      logWarn(LOG_SCOPE, "No queued request found during round-robin selection", { attempts })
      return
    }
    
    // Prüfe Session-Abbruch vor Ausführung (finale Prüfung)
    if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
      request.reject(new Error(`Session ${request.sessionId} was cancelled`))
      // Verarbeite nächsten Request
      this.scheduleNextProcessing()
      return
    }
    
    const totalRequestsAfter = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    logDebug(LOG_SCOPE, "API request started from queue", {
      requestId: request.id,
      queueSize: totalRequestsAfter,
      activeRequests: this.activeRequests,
    })
    
    // Setze Zeitstempel und erhöhe aktive Requests
    this.lastApiCallStart = Date.now()
    this.activeRequests++

    // Tracking für Rate Limit Logik
    this.trackRequest(this.lastApiCallStart)

    // Führe Request aus (async, damit wir den nächsten planen können)
    this.executeRequestWithRetry(request)
      .catch(() => { /* rejection handled via request.reject() */ })
      .finally(() => {
        this.activeRequests--
        const totalRequestsCompleted = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
        logDebug(LOG_SCOPE, "API request completed", {
          requestId: request!.id,
          queueSize: totalRequestsCompleted,
          activeRequests: this.activeRequests,
        })
        
        // Plane nächsten Request falls Queue nicht leer
        this.scheduleNextProcessing()
      })

    // Plane bereits den nächsten Request (falls vorhanden)
    this.scheduleNextProcessing()
  }

    // Vereinfachte Funktion: Cleanup abgebrochene Sessions (nur synchrone Prüfung)
  private cleanupCancelledSessions() {
    const sessionsToRemove: string[] = []
    
    // Prüfe alle Sessions auf Abbruch (nur synchron für bessere Performance im Dev-Modus)
    for (const sessionId of this.sessionQueues.keys()) {
      if (sessionId !== 'default' && this.isSessionCancelledSync(sessionId)) {
        sessionsToRemove.push(sessionId)
      }
    }
    
    // Entferne abgebrochene Sessions
    for (const sessionId of sessionsToRemove) {
      const queue = this.sessionQueues.get(sessionId)
      if (queue) {
        const requestCount = queue.length
        
        // Lehne alle Requests der Session ab
        for (const request of queue) {
          request.reject(new Error(`Session ${sessionId} was cancelled`))
        }
        
        // Entferne Session aus Maps und Round-Robin
        this.sessionQueues.delete(sessionId)
        this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
        
        // Adjustiere currentSessionIndex falls nötig
        if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
          this.currentSessionIndex = 0
        }
        
        logDebug(LOG_SCOPE, "Cancelled session removed from queue", {
          sessionId,
          rejectedRequests: requestCount,
        })
      }
    }
    
    if (sessionsToRemove.length > 0) {
      logDebug(LOG_SCOPE, "Cancelled sessions cleanup completed", {
        removedSessions: sessionsToRemove.length,
      })
    }
  }

  private async executeRequestWithRetry(request: QueuedRequest, retryCount = 0) {
    const maxRetries = this.config.maxRetries
    
    // Prüfe Session BEFORE executing request
    if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
      request.reject(new Error(`Session ${request.sessionId} was cancelled`))
      return
    }
    
    try {
      // Wrapper um request.execute() mit periodischer Session-Abbruch-Prüfung
      const executeWithCancellation = async () => {
        // Starte den ursprünglichen Request
        const requestPromise = request.execute().catch((e) => { 
          // Attach a catch immediately to avoid unhandledRejection logs, then rethrow
          throw e 
        })
        
        // Periodenprüfung ob Session abgebrochen wurde (alle 500ms)
        const checkCancellation = () => {
          return new Promise<never>((_, reject) => {
            const checkInterval = setInterval(() => {
              if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
                clearInterval(checkInterval)
                reject(new Error(`Session ${request.sessionId} was cancelled during execution`))
              }
            }, 500) // Alle 500ms prüfen
            
            // Cleanup wenn Request fertig ist
            requestPromise.finally(() => {
              clearInterval(checkInterval)
            })
          })
        }
        
        // Race zwischen Request und Cancellation Check
        return Promise.race([requestPromise, checkCancellation()])
      }
      
      const result: any = await executeWithCancellation()

      // Sentinel-Erkennung: request.execute() kann ein Objekt mit __httpStatus zurückgeben
      if (result && typeof result === 'object' && '__httpStatus' in result) {
        const status = Number((result as any).__httpStatus)
        const msg = (result as any).__errorText || ''

        if (status === 429) {
          logWarn(LOG_SCOPE, "Rate limit response received", {
            requestId: request.id,
            status,
          })
          // Sofort auf Max-Intervall springen
          this.onRateLimitHit(true)

          // Retry-Logik
          if (retryCount < maxRetries) {
            const retryDelay = this.calculateRetryDelay(retryCount)
            logInfo(LOG_SCOPE, "Request re-queued after rate limit response", {
              requestId: request.id,
              retryDelayMs: retryDelay,
              retryAttempt: retryCount + 1,
              maxRetries,
            })
            setTimeout(() => {
              if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
                request.reject(new Error(`Session ${request.sessionId} was cancelled`))
                return
              }
              const retryRequest: QueuedRequest = { ...request, timestamp: Date.now() }
              const effectiveSessionId = request.sessionId || 'default'
              if (!this.sessionQueues.has(effectiveSessionId)) {
                this.sessionQueues.set(effectiveSessionId, [])
                this.sessionRoundRobin.push(effectiveSessionId)
              }
              this.sessionQueues.get(effectiveSessionId)!.unshift(retryRequest)
              const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
              logDebug(LOG_SCOPE, "Rate-limited request reinserted at front of session queue", {
                requestId: request.id,
                sessionId: effectiveSessionId,
                queueSize: totalRequests,
              })
              this.scheduleNextProcessing()
            }, retryDelay)
            return
          } else {
            logWarn(LOG_SCOPE, "Request failed after rate limit retries", {
              requestId: request.id,
              maxRetries,
            })
            request.reject(new Error('HTTP 429'))
            return
          }
        }

        // Andere HTTP-Fehler-Sentinels: sauber ablehnen
        request.reject(new Error(`HTTP ${status}: ${msg}`))
        return
      }
      
      // Finale Session-Prüfung vor resolve
      if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
        request.reject(new Error(`Session ${request.sessionId} was cancelled`))
        return
      }
      
      // Erfolgreicher Request - Rate Limit kann langsam reduziert werden
      this.onRequestSuccess()
      request.resolve(result)
      
    } catch (error) {
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || error.message.includes('Too Many Requests'))
      
      if (isRateLimitError) {
        logWarn(LOG_SCOPE, "Rate limit error received", {
          requestId: request.id,
        })
        // Sofort auf Max-Intervall springen
        this.onRateLimitHit(true)
        
        // Retry bei 429-Fehlern - Request geht ZURÜCK in die Session-Queue
        if (retryCount < maxRetries) {
          const retryDelay = this.calculateRetryDelay(retryCount)
          logInfo(LOG_SCOPE, "Request re-queued after rate limit error", {
            requestId: request.id,
            retryDelayMs: retryDelay,
            retryAttempt: retryCount + 1,
            maxRetries,
          })
          
          setTimeout(() => {
            // Prüfe Session nochmal vor Re-Queue
            if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
              request.reject(new Error(`Session ${request.sessionId} was cancelled`))
              return
            }
            
            // Erstelle neuen Request für Retry und füge ihn in die richtige Session-Queue GANZ VORNE ein
            const retryRequest: QueuedRequest = {
              ...request,
              timestamp: Date.now()
            }
            const effectiveSessionId = request.sessionId || 'default'
            if (!this.sessionQueues.has(effectiveSessionId)) {
              this.sessionQueues.set(effectiveSessionId, [])
              this.sessionRoundRobin.push(effectiveSessionId)
            }
            // GANZ VORNE einreihen (unshift)
            this.sessionQueues.get(effectiveSessionId)!.unshift(retryRequest)
            const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
            logDebug(LOG_SCOPE, "Rate-limited request reinserted at front of session queue", {
              requestId: request.id,
              sessionId: effectiveSessionId,
              queueSize: totalRequests,
            })
            this.scheduleNextProcessing()
          }, retryDelay)
          return
        } else {
          // Nach allen Retry-Versuchen - Request endgültig fehlgeschlagen (aber NICHT unhandled)
          logWarn(LOG_SCOPE, "Request failed after rate limit retries", {
            requestId: request.id,
            maxRetries,
          })
        }
      }
      
      // Alle Retries aufgebraucht oder anderer Fehler
      request.reject(error)
    }
  }

  private onRateLimitHit(forceMax: boolean = false) {
    // Sofort auf Max-Intervall springen, wenn gefordert
    const target = forceMax ? this.config.maxInterval : Math.min(this.minInterval * 1.5, this.config.maxInterval)
    
    logWarn(LOG_SCOPE, "Rate limit interval increased", {
      previousIntervalMs: this.minInterval,
      nextIntervalMs: Math.round(target),
    })
    this.minInterval = Math.round(target)
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private onRequestSuccess() {
    // Nach jedem erfolgreichen Request Intervall um 20% reduzieren, wenn über Basiswert
    if (this.minInterval > this.config.baseInterval) {
      const newInterval = Math.max(this.minInterval * 0.8, this.config.baseInterval)
      if (newInterval < this.minInterval) {
        logDebug(LOG_SCOPE, "Rate limit interval reduced after successful request", {
          previousIntervalMs: this.minInterval,
          nextIntervalMs: Math.round(newInterval),
        })
        this.minInterval = Math.round(newInterval)
      }
    }
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 2s, 4s, 8s
    const exponentialDelay = Math.min(2000 * Math.pow(2, retryCount), 8000)
    const now = Date.now()
    return Math.max(
      exponentialDelay,
      this.getRollingWindowPacingDelay(now),
      this.getRollingWindowDelay(now)
    )
  }

  // Neue Methode: Request-Tracking für intelligente Rate-Limits
  private trackRequest(timestamp: number) {
    this.requestHistory.push(timestamp)
    
    // Behalte etwas mehr als das Rolling Window für Logging und Retry-Entscheidungen.
    const retentionAgo = timestamp - Math.max(2 * 60 * 1000, this.config.rollingLimitWindow * 2)
    this.requestHistory = this.requestHistory.filter(t => t > retentionAgo)
  }

  private getRollingWindowDelay(now: number): number {
    const windowStart = now - this.config.rollingLimitWindow
    this.requestHistory = this.requestHistory.filter(t => t > windowStart)

    if (this.requestHistory.length < this.config.rollingLimitCount) {
      return 0
    }

    const oldestRequest = Math.min(...this.requestHistory)
    const nextAllowedAt = oldestRequest + this.config.rollingLimitWindow + this.config.rollingLimitSafetyBuffer
    const delay = Math.max(0, nextAllowedAt - now)

    if (delay > 0) {
      logInfo(LOG_SCOPE, "Rolling rate limit budget exhausted; delaying next request", {
        delayMs: delay,
        requestsInWindow: this.requestHistory.length,
        rollingLimitCount: this.config.rollingLimitCount,
        rollingLimitWindowMs: this.config.rollingLimitWindow,
      })
    }

    return delay
  }

  private getRollingWindowPacingInterval(now: number): number {
    const windowStart = now - this.config.rollingLimitWindow
    const requestsInWindow = this.requestHistory.filter(t => t > windowStart)

    if (requestsInWindow.length < this.config.pacingStartCount) {
      return this.config.baseInterval
    }

    const remainingSlots = this.config.rollingLimitCount - requestsInWindow.length
    if (remainingSlots <= 0) {
      return this.config.maxInterval
    }

    const oldestRequest = Math.min(...requestsInWindow)
    const elapsedWindowMs = Math.max(0, now - oldestRequest)
    const remainingWindowMs = Math.max(
      0,
      this.config.rollingLimitWindow + this.config.rollingLimitSafetyBuffer - elapsedWindowMs
    )

    return Math.max(
      this.config.minPacedInterval,
      Math.ceil(remainingWindowMs / remainingSlots)
    )
  }

  private getRollingWindowPacingDelay(now: number): number {
    const targetInterval = this.getRollingWindowPacingInterval(now)
    if (targetInterval <= this.config.baseInterval) {
      return 0
    }

    const timeSinceLastStart = now - this.lastApiCallStart
    const delay = Math.max(0, targetInterval - timeSinceLastStart)

    if (delay > 0) {
      logDebug(LOG_SCOPE, "Rolling rate limit pacing active", {
        delayMs: delay,
        targetIntervalMs: targetInterval,
        requestsInWindow: this.requestHistory.filter(t => t > now - this.config.rollingLimitWindow).length,
        pacingStartCount: this.config.pacingStartCount,
        rollingLimitCount: this.config.rollingLimitCount,
      })
    }

    return delay
  }

  // Neue Methode: Intelligente Rate-Limit Bestimmung
  private updateRateLimit() {
    const now = Date.now()
    
    // Cleanup alte Requests aus Historie
    const retentionAgo = now - Math.max(2 * 60 * 1000, this.config.rollingLimitWindow * 2)
    this.requestHistory = this.requestHistory.filter(t => t > retentionAgo)

    if (this.minInterval <= this.config.baseInterval) {
      return
    }

    const targetInterval = Math.max(this.minInterval * 0.9, this.config.baseInterval)
    
    // Update nur wenn sich etwas geändert hat (min. 50ms)
    if (Math.abs(targetInterval - this.minInterval) > 50) {
      logInfo(LOG_SCOPE, "Rate limit interval adjusted", {
        previousIntervalMs: this.minInterval,
        nextIntervalMs: Math.round(targetInterval),
        reason: "Recovering after previous rate limit backoff",
        requestsInRollingWindow: this.requestHistory.filter(t => t > now - this.config.rollingLimitWindow).length,
        rollingWindowSeconds: Math.round(this.config.rollingLimitWindow / 1000),
        trackedRequests: this.requestHistory.length,
      })
      this.minInterval = Math.round(targetInterval)
      // Update metrics
      metricsCollector.updateRateLimitInterval(this.minInterval)
    }
  }

  // Prüfe ob Session abgebrochen wurde (synchrone Version bevorzugen)
  public isSessionCancelledSync(sessionId: string): boolean {
    return this.cancelledSessions.has(sessionId)
  }
  public cancelSession(sessionId: string, reason: string = 'user_request'): void {
    // Spezielle Behandlung für abgeschlossene Suchen - kein Cancel-Log
    if (reason === 'search_completed') {
      this.cancelledSessions.add(sessionId)
      
      // Entferne Session aus Queues ohne Logging (da erfolgreich abgeschlossen)
      const queue = this.sessionQueues.get(sessionId)
      if (queue && queue.length > 0) {
        // Lehne alle verbleibenden Requests ab (falls vorhanden)
        for (const request of queue) {
          request.reject(new Error(`Session ${sessionId} was completed`))
        }
        
        // Entferne Session komplett
        this.sessionQueues.delete(sessionId)
        this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
        
        if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
          this.currentSessionIndex = 0
        }
      }
      
      // Auto-cleanup nach 1 Minute (kürzer für completed sessions)
      setTimeout(() => {
        this.cancelledSessions.delete(sessionId)
      }, this.config.completedSessionTimeout)
      
      return
    }
    
    // Prüfe ob Session bereits als completed markiert wurde - dann ignoriere weitere Cancels
    if (this.cancelledSessions.has(sessionId)) {
      logDebug(LOG_SCOPE, "Duplicate session cancellation ignored", {
        sessionId,
        reason,
      })
      return
    }
    
    const logCancellation = reason === "user_request" ? logInfo : logDebug
    logCancellation(LOG_SCOPE, "🛑 Session cancellation requested", {
      sessionId,
      reason,
    })
    
    // Record metrics
    metricsCollector.recordSessionCancellation(reason)
    
    this.cancelledSessions.add(sessionId)
    
    // Sofort alle Requests dieser Session aus den Queues entfernen
    const queue = this.sessionQueues.get(sessionId)
    if (queue) {
      const requestCount = queue.length
      
      // Lehne alle wartenden Requests ab
      for (const request of queue) {
        request.reject(new Error(`Session ${sessionId} was cancelled`))
      }
      
      // Entferne Session komplett
      this.sessionQueues.delete(sessionId)
      this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
      
      // Index anpassen
      if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
        this.currentSessionIndex = 0
      }
      
      logDebug(LOG_SCOPE, "Pending requests cancelled for session", {
        sessionId,
        cancelledRequests: requestCount,
      })
    }
    
    // Auto-cleanup nach 5 Minuten (nur für das cancelled-Set)
    setTimeout(() => {
      this.cancelledSessions.delete(sessionId)
      logDebug(LOG_SCOPE, "Cancelled session marker cleaned up", { sessionId })
    }, this.config.sessionCancelTimeout)
  }

  getQueueStatus(sessionId?: string) {
    // Berechne Gesamt-Queue-Größe über alle Sessions
    const totalQueueSize = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    
    // Finde Position des Users in der Round-Robin Abarbeitung
    let ownPosition: number | null = null
    let sessionQueueSize = 0
    
    if (sessionId) {
      const sessionQueue = this.sessionQueues.get(sessionId)
      if (sessionQueue && sessionQueue.length > 0) {
        sessionQueueSize = sessionQueue.length
        
        // Schätze Position basierend auf Round-Robin
        // Position = Anzahl Sessions vor mir + meine eigene Position in der Session-Queue
        const sessionIndex = this.sessionRoundRobin.indexOf(sessionId)
        if (sessionIndex !== -1) {
          // Berechne wie viele Requests vor mir sind (Round-Robin Logik)
          const sessionsBeforeMe = sessionIndex < this.currentSessionIndex ? 
            (this.sessionRoundRobin.length - this.currentSessionIndex + sessionIndex) : 
            (sessionIndex - this.currentSessionIndex)
          
          ownPosition = sessionsBeforeMe // Erste eigene Anfrage ist nach X anderen Sessions dran
        }
      }
    }
    
    // Anzahl unterschiedlicher Sessions in den Queues
    const totalUsers = this.sessionQueues.size
    const hasOwnRequest = sessionQueueSize > 0
    
    // Geschätzte Wartezeit basierend auf Round-Robin
    const waitingRequests = ownPosition !== null ? ownPosition : 0
    const effectiveInterval = Math.max(this.minInterval, this.getRollingWindowPacingInterval(Date.now()))
    const estimatedWaitTime = hasOwnRequest ? waitingRequests * (effectiveInterval / 1000) : 0
    
    const result = {
      queueSize: totalQueueSize,
      activeRequests: this.activeRequests,
      lastApiCall: this.lastApiCallStart,
      currentInterval: this.minInterval,
      // Neue benutzerfreundliche Werte für Round-Robin
      waitingRequests, // Wie viele Sessions vor mir warten
      totalUsers, // Wie viele unterschiedliche Sessions in den Queues
      hasOwnRequest, // Ob ich überhaupt Requests in der Queue habe
      estimatedWaitTime, // Geschätzte Wartezeit in Sekunden
      sessionQueueSize, // Wie viele eigene Requests in der Queue sind
      sessionPosition: ownPosition // Position in der Round-Robin Liste
    }
    
    // Update queue metrics
    metricsCollector.updateQueueMetrics(
      result.queueSize,
      result.activeRequests,
      this.sessionQueues.size
    )
    
    return result
  }
}

// Globale Instanz des Rate Limiters
export const globalRateLimiter = new GlobalRateLimiter()
