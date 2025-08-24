import { metricsCollector } from '@/app/api/metrics/collector'

/* Globales Rate Limiting für alle API-Calls
Die Bahn-API hat strenge Limits, daher ist ein globales Rate Limiting notwendig.
Kurzzeitig eine hohe Anzahl an Requests möglich, aber danach antwortet die API schnell mit 429-Fehlern (Too Many Requests).
Daher beobachtet diese Funktion die letzten Requests und passt das Intervall dynamisch an, bei 429-Fehlern wird das Intervall auf bis zu 10 Sekunden erhöht.
Das Ziel ist es möglichst keine 429-Fehler zu erhalten, um die Performance zu optimieren.
Wir verwenden eine Round-Robin-Queue für Sessions, um Requests effizient zu verarbeiten.

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
  private minInterval = 1200 // Adaptive: Startet bei 1 Sekunde zwischen API-Call STARTS
  private activeRequests = 0
  private readonly maxConcurrentRequests = 3 // Bis zu 3 parallele Requests für bessere Performance
  
  // Interne Cancel-Session Verwaltung
  private cancelledSessions = new Set<string>() // Cancelled Sessions
  
  // Adaptive Rate Limiting mit DB-API Burst-Logik
  private readonly baseInterval = 1200 // Basis-Intervall (1,2 Sekunden)
  private readonly burstInterval = 2000 // Nach Burst-Limit: 2 Sekunden
  private readonly burstLimitCount = 15 // Burst-Limit: 20 Requests
  private readonly burstLimitWindow = 30 * 1000 // 30 Sekunden
  private readonly sustainedInterval = 2500 // Nach Sustained-Limit: 2,5 Sekunden
  private readonly maxInterval = 10000 // Maximum 10 Sekunden
  
  // Request-Tracking für DB-API Limits
  private requestHistory: number[] = [] // Timestamps der letzten Requests
  private rateLimitHits = 0 // Anzahl 429-Fehler
  private lastRateLimitTime = 0
  private successfulRequests = 0 // Erfolgreiche Anfragen seit letztem 429
  private processingTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Starte regelmäßigen Cleanup abgebrochener Sessions (alle 10 Sekunden im Dev-Modus)
    this.cleanupTimer = setInterval(() => {
      this.cleanupCancelledSessions()
    }, 10000)
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
        console.log(`🆕 New session ${effectiveSessionId} added to round-robin`)
      }
      
      // Füge Request zur Session-Queue hinzu
      this.sessionQueues.get(effectiveSessionId)!.push(queuedRequest)
      
      const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
      console.log(`🎯 Added request ${requestId} to session ${effectiveSessionId}. Total queue size: ${totalRequests}, Sessions: ${this.sessionQueues.size}`)
      
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
    const delay = Math.max(0, this.minInterval - timeSinceLastStart)

    console.log(`⏰ Scheduling next request processing in ${delay}ms (active: ${this.activeRequests}/${this.maxConcurrentRequests}, interval: ${this.minInterval}ms)`)
    
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
        console.log(`🎯 Round-robin: Selected request from session ${currentSessionId} (${sessionQueue.length} remaining)`)
      }
      
      // Gehe zur nächsten Session
      this.currentSessionIndex = (this.currentSessionIndex + 1) % this.sessionRoundRobin.length
      attempts++
    }
    
    if (!request) {
      console.log(`⚠️ No requests found after ${attempts} attempts`)
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
    console.log(`🚀 Starting API request ${request.id}. Total queue size: ${totalRequestsAfter}, Active: ${this.activeRequests}`)
    
    // Setze Zeitstempel und erhöhe aktive Requests
    this.lastApiCallStart = Date.now()
    this.activeRequests++

    // Tracking für Rate Limit Logik
    this.trackRequest(this.lastApiCallStart)

    // Führe Request aus (async, damit wir den nächsten planen können)
    this.executeRequestWithRetry(request).finally(() => {
      this.activeRequests--
      const totalRequestsCompleted = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
      console.log(`✅ Completed request ${request!.id}. Total queue size: ${totalRequestsCompleted}, Active: ${this.activeRequests}`)
      
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
        
        console.log(`🧹 Cleaned up cancelled session ${sessionId} (${requestCount} requests rejected)`)
      }
    }
    
    if (sessionsToRemove.length > 0) {
      console.log(`🧹 Total cleanup: ${sessionsToRemove.length} cancelled sessions removed from queue`)
    }
  }

  private async executeRequestWithRetry(request: QueuedRequest, retryCount = 0) {
    const maxRetries = 3
    const requestStartTime = Date.now()
    
    // Prüfe Session BEFORE executing request
    if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
      request.reject(new Error(`Session ${request.sessionId} was cancelled`))
      return
    }
    
    try {
      // Wrapper um request.execute() mit periodischer Session-Abbruch-Prüfung
      const executeWithCancellation = async () => {
        // Starte den ursprünglichen Request
        const requestPromise = request.execute()
        
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
      
      const result = await executeWithCancellation()
      
      // Finale Session-Prüfung vor resolve
      if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
        request.reject(new Error(`Session ${request.sessionId} was cancelled`))
        return
      }
      
      // Record successful API call metrics
      const responseTime = Date.now() - requestStartTime
      metricsCollector.recordBahnApiRequest(responseTime, 200)
      
      // Erfolgreicher Request - Rate Limit kann langsam reduziert werden
      this.onRequestSuccess()
      request.resolve(result)
      
    } catch (error) {
      const responseTime = Date.now() - requestStartTime
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || error.message.includes('Too Many Requests'))
      
      if (isRateLimitError) {
        console.log(`🚫 Rate limit hit (429) for request ${request.id}`)
        metricsCollector.recordBahnApiRequest(responseTime, 429)
        this.onRateLimitHit()
        
        // Retry bei 429-Fehlern - Request geht ZURÜCK in die Session-Queue
        if (retryCount < maxRetries) {
          const retryDelay = this.calculateRetryDelay(retryCount)
          console.log(`🔄 Re-queueing request ${request.id} after ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`)
          
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
            console.log(`🔄 Request ${request.id} re-queued to FRONT of session ${effectiveSessionId}. Total queue size: ${totalRequests}`)
            this.scheduleNextProcessing()
          }, retryDelay)
          return
        }
      } else {
        // Record failed API call
        metricsCollector.recordBahnApiRequest(responseTime, 500)
      }
      
      // Alle Retries aufgebraucht oder anderer Fehler
      request.reject(error)
    }
  }

  private onRateLimitHit() {
    this.rateLimitHits++
    this.lastRateLimitTime = Date.now()
    this.successfulRequests = 0
    
    // Record metrics
    metricsCollector.recordBahnApiRequest(0, 429) // 0ms response time for rate limit
    
    // Sanftere Erhöhung: +50% statt Verdopplung, aber nicht über Maximum
    const newInterval = Math.min(this.minInterval * 1.5, this.maxInterval)
    
    console.log(`📈 Rate limit hit! Increasing interval from ${this.minInterval}ms to ${Math.round(newInterval)}ms (hits: ${this.rateLimitHits})`)
    this.minInterval = Math.round(newInterval)
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private onRequestSuccess() {
    // Nach jedem erfolgreichen Request Intervall um 20% reduzieren, wenn über Basiswert
    if (this.minInterval > this.baseInterval) {
      const newInterval = Math.max(this.minInterval * 0.8, this.baseInterval)
      if (newInterval < this.minInterval) {
        console.log(`📉 Reducing interval from ${this.minInterval}ms to ${Math.round(newInterval)}ms after success`)
        this.minInterval = Math.round(newInterval)
      }
    }
    this.successfulRequests++
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 2s, 4s, 8s
    return Math.min(2000 * Math.pow(2, retryCount), 8000)
  }

  // Neue Methode: Request-Tracking für intelligente Rate-Limits
  private trackRequest(timestamp: number) {
    // Füge Request zur Historie hinzu
    this.requestHistory.push(timestamp)
    
    // Behalte nur Requests der letzten 2 Minuten
    const twoMinutesAgo = timestamp - (2 * 60 * 1000)
    this.requestHistory = this.requestHistory.filter(t => t > twoMinutesAgo)
  }

  // Neue Methode: Intelligente Rate-Limit Bestimmung
  private updateRateLimit() {
    const now = Date.now()
    
    // Cleanup alte Requests aus Historie
    const twoMinutesAgo = now - (2 * 60 * 1000)
    this.requestHistory = this.requestHistory.filter(t => t > twoMinutesAgo)
    
    // Prüfe Burst-Limit: 20 Requests in letzten 20 Sekunden
    const burstAgo = now - this.burstLimitWindow
    const requestsInBurst = this.requestHistory.filter(t => t > burstAgo).length
    
    // Prüfe Sustained-Limit: 40 Requests in letzten 60 Sekunden  
    const sixtySecondsAgo = now - (60 * 1000)
    const requestsIn60Seconds = this.requestHistory.filter(t => t > sixtySecondsAgo).length
    
    let newInterval = this.baseInterval
    let limitReason = ""
    
    // Sustained-Limit hat Priorität (strengeres Limit)
    if (requestsIn60Seconds >= 40) {
      newInterval = this.sustainedInterval
      limitReason = `Sustained limit: ${requestsIn60Seconds}/50 requests in 60s`
    } else if (requestsInBurst >= this.burstLimitCount) {
      newInterval = this.burstInterval  
      limitReason = `Burst limit: ${requestsInBurst}/15 requests in 30s`
    } else {
      // Langsam zurück zum Basis-Intervall wenn unter den Limits
      if (this.minInterval > this.baseInterval) {
        newInterval = Math.max(this.minInterval * 0.9, this.baseInterval)
        limitReason = "Slowly reducing interval"
      }
    }
    
    // Update nur wenn sich etwas geändert hat
    if (newInterval !== this.minInterval) {
      console.log(`📊 Rate limit update: ${this.minInterval}ms → ${newInterval}ms (${limitReason})`)
      console.log(`📈 Request stats: ${requestsInBurst} in 20s, ${requestsIn60Seconds} in 60s, total history: ${this.requestHistory.length}`)
      this.minInterval = Math.round(newInterval)
    }
  }

  // Prüfe ob Session abgebrochen wurde
  private async isSessionCancelled(sessionId: string): Promise<boolean> {
    // Verwende internen cancelled sessions cache
    return this.cancelledSessions.has(sessionId)
  }

  // Neue Methoden für Cancel-Session Management
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
      }, 60 * 1000)
      
      return
    }
    
    // Prüfe ob Session bereits als completed markiert wurde - dann ignoriere weitere Cancels
    if (this.cancelledSessions.has(sessionId)) {
      console.log(`ℹ️ Session ${sessionId} already cancelled/completed - ignoring additional cancel (reason: ${reason})`)
      return
    }
    
    console.log(`🛑 Cancelling session ${sessionId} (reason: ${reason})`)
    
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
      
      console.log(`🧹 Immediately cancelled ${requestCount} requests for session ${sessionId}`)
    }
    
    // Auto-cleanup nach 5 Minuten (nur für das cancelled-Set)
    setTimeout(() => {
      this.cancelledSessions.delete(sessionId)
      console.log(`🧹 Auto-cleaned cancelled session ${sessionId}`)
    }, 5 * 60 * 1000)
  }

  public isSessionCancelledSync(sessionId: string): boolean {
    return this.cancelledSessions.has(sessionId)
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
    const estimatedWaitTime = hasOwnRequest ? waitingRequests * (this.minInterval / 1000) : 0
    
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