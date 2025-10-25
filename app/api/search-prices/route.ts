import { type NextRequest, NextResponse } from "next/server"
import { globalRateLimiter } from './rate-limiter'
import { searchBahnhof, getBestPrice } from './bahn-api'
import { updateProgress, updateAverageResponseTimes, getAverageResponseTimes } from './utils'
import { generateCacheKey, getCachedResult, getCacheSize, type PriceHistoryEntry } from './cache'
import { recommendBestPrice } from '@/lib/recommendation-engine'
import { metricsCollector } from '@/app/api/metrics/collector'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


// Hilfsfunktion für lokales Datum im Format YYYY-MM-DD
function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${year}-${month}-${day}`
}

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: Array<{
    preis: number
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt: string
    ankunftsOrt: string
    info: string
    umstiegsAnzahl: number
    isCheapestPerInterval?: boolean
    priceHistory?: PriceHistoryEntry[]
    abschnitte?: Array<{
      abfahrtsZeitpunkt: string
      ankunftsZeitpunkt: string
      abfahrtsOrt: string
      ankunftsOrt: string
      abfahrtsOrtExtId?: string
      ankunftsOrtExtId?: string
      verkehrsmittel?: {
        produktGattung?: string
        kategorie?: string
        name?: string
      }
    }>
  }>
}

interface TrainResults {
  [date: string]: TrainResult
}

export async function POST(request: NextRequest) {
  // Track search start time for metrics
  const searchStartTime = Date.now()
  
  try {
    const body = await request.json()
    const {
      sessionId: providedSessionId,
      start,
      ziel,
      tage,
      alter,
      ermaessigungArt,
      ermaessigungKlasse,
      klasse,
      schnelleVerbindungen,
      nurDeutschlandTicketVerbindungen,
      maximaleUmstiege,
      abfahrtAb,
      ankunftBis,
      umstiegszeit,
    } = body

    // Record user search metrics
    metricsCollector.recordUserSearch(tage?.length || 0)
    metricsCollector.recordStreamingConnection()

    console.log("\n🚂 Starting bestpreissuche request")
    console.log("📋 Request parameters:")
    console.log("  - Route:", start, "→", ziel)
    console.log("  - Days:", tage?.length || 0, "| Time:", abfahrtAb || "any", "-", ankunftBis || "any")
    console.log("  - Class:", klasse, "| Max transfers:", maximaleUmstiege, "(type:", typeof maximaleUmstiege, ")")
    console.log("  - RAW maximaleUmstiege from body:", JSON.stringify(body.maximaleUmstiege))
    if (umstiegszeit && umstiegszeit !== "normal") {
      console.log("  - Transfer time:", umstiegszeit, "min")
    }

    if (!start || !ziel) {
      return NextResponse.json({ error: "Start and destination required" }, { status: 400 })
    }

    // Verwende die übergebene sessionId oder generiere eine neue
    const sessionId = providedSessionId || crypto.randomUUID()
    console.log(`📱 Session ID: ${sessionId}`)

    // Search for stations
    console.log("\n📍 Searching for stations...")
    const startStation = await searchBahnhof(start)
    const zielStation = await searchBahnhof(ziel)
        
    if (!startStation || !zielStation) {
      return NextResponse.json(
        {
          error: `Station not found. Start: ${startStation ? "✓" : "✗"}, Ziel: ${zielStation ? "✓" : "✗"}`,
        },
        { status: 404 },
      )
    }

    // Streaming Response Setup
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let isStreamClosed = false
        let cancelLoggedForSession = false
        let completeSent = false

        // Diese Variablen müssen im gesamten Scope sichtbar sein!
        let datesToProcess: string[] = []
        let maxDays = 0
        let metaData: any = undefined
        const results: TrainResults = {}

        // Helper function to safely enqueue data
        const safeEnqueue = (data: Uint8Array) => {
          if (!isStreamClosed) {
            try {
              controller.enqueue(data)
              return true
            } catch (error) {
              if (!cancelLoggedForSession) {
                console.log(`ℹ️ User disconnected - search stopped gracefully (session: ${sessionId})`)
                cancelLoggedForSession = true
              }
              isStreamClosed = true
              return false
            }
          }
          return false
        }
        
        // Helper function to safely close stream
        const safeClose = () => {
          if (!isStreamClosed) {
            try {
              controller.close()
              isStreamClosed = true
            } catch (error) {
              console.log(`ℹ️ Stream was already closed by user`)
              isStreamClosed = true
            }
          }
        }
        
        // Helper to send final complete (idempotent)
        const sendFinalComplete = async () => {
          if (completeSent) return
          completeSent = true

          // Record search completion metrics
          const searchDuration = Date.now() - searchStartTime
          metricsCollector.recordSearchDuration(searchDuration)

          // Hilfsfunktion: Zähle nur echte Tagesergebnisse
          function countProcessedDays(resultsObj: TrainResults) {
            return Object.entries(resultsObj).filter(
              ([key, val]) => key !== '_meta' && val && (val.preis > 0 || (val.preis === 0 && val.info && val.info !== 'Search cancelled'))
            ).length
          }

          const processedDays = countProcessedDays(results)
          const finalQueueStatus = globalRateLimiter.getQueueStatus()
          const finalAvgTimes = getAverageResponseTimes()
          await updateProgress(
            sessionId,
            processedDays,
            maxDays,
            datesToProcess[maxDays - 1] || "",
            true,
            0,
            0,
            finalAvgTimes.uncached,
            finalAvgTimes.cached,
            finalQueueStatus.queueSize,
            finalQueueStatus.activeRequests
          )

          const resultsWithStations = {
            ...results,
            _meta: metaData,
          }

          const completeResult = {
            type: 'complete',
            results: resultsWithStations,
            processedDays,
            plannedDays: maxDays
          }

          if (safeEnqueue(encoder.encode(JSON.stringify(completeResult) + '\n'))) {
            safeClose()
          }
        }

        try {
          // Verwende tage-Array wenn vorhanden, sonst fallback zu altem System
          datesToProcess = tage.slice(0, 30) // Limitiere auf max 30 Tage
          maxDays = datesToProcess.length
          console.log(`\n🔍 Processing ${datesToProcess.length} specific dates`)
          console.log(`📊 Cache status: ${getCacheSize()} entries`)

          // Update cache metrics
          const cacheSize = getCacheSize()
          // Assuming you have a way to get station cache size, otherwise use 0
          metricsCollector.updateCacheMetrics(0, cacheSize)

          // Erstelle Liste aller Tage mit Cache-Status
          const dayStatusList: { date: string; isCached: boolean; cacheKey: string }[] = []
          for (const dateStr of datesToProcess) {
            const cacheKey = generateCacheKey({
              startStationId: startStation.normalizedId,
              zielStationId: zielStation.normalizedId,
              date: dateStr,
              alter: alter || "ERWACHSENER",
              ermaessigungArt: ermaessigungArt || "KEINE_ERMAESSIGUNG",
              ermaessigungKlasse: ermaessigungKlasse || "KLASSENLOS",
              klasse: klasse || "KLASSE_2",
              schnelleVerbindungen: Boolean(schnelleVerbindungen === true || schnelleVerbindungen === "true"),
              umstiegszeit: (umstiegszeit && umstiegszeit !== "normal" && umstiegszeit !== "undefined") ? umstiegszeit : undefined,
            })
            const isCached = !!getCachedResult(cacheKey)
            dayStatusList.push({ date: dateStr, isCached, cacheKey })
          }

          // Gesamtanzahl der gecached und ungecachten Tage für die gesamte Suche
          let totalUncachedDays = dayStatusList.filter((d) => !d.isCached).length
          let totalCachedDays = dayStatusList.filter((d) => d.isCached).length
          const avgTimes = getAverageResponseTimes()

          // Meta-Daten für Frontend
          metaData = {
            startStation: startStation,
            zielStation: zielStation,
            searchParams: {
              klasse,
              maximaleUmstiege,
              schnelleVerbindungen,
              nurDeutschlandTicketVerbindungen,
              abfahrtAb,
              ankunftBis,
              umstiegszeit,
            },
            sessionId,
          }

          // Initialer Progress-Update - zeigt sofort die Queue-Size an
          const queueStatus = globalRateLimiter.getQueueStatus()
          await updateProgress(
            sessionId,
            0, // Start bei Tag 0
            maxDays,
            datesToProcess[0] || "",
            false,
            totalUncachedDays,
            totalCachedDays,
            avgTimes.uncached,
            avgTimes.cached,
            queueStatus.queueSize,
            queueStatus.activeRequests
          )

          // Starte alle Requests parallel (nicht sequenziell!)
          const requestPromises = datesToProcess.map(async (currentDateStr, dayCount) => {
            // Prüfe Session-Abbruch VOR jedem Request
            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              if (!cancelLoggedForSession) {
                console.log(`🛑 Session ${sessionId} cancelled by user - stopping search`)
                cancelLoggedForSession = true
              }
              return { currentDateStr, dayResponse: { result: null }, dayCount }
            }

            const isCached = dayStatusList[dayCount].isCached
            const currentDate = new Date(currentDateStr)
            const t0 = Date.now()

            // Konvertiere maximaleUmstiege explizit
            let processedMaxUmstiege: number | string | undefined = undefined
            if (maximaleUmstiege === "0" || maximaleUmstiege === 0) {
              processedMaxUmstiege = 0
            } else if (maximaleUmstiege !== undefined && maximaleUmstiege !== "alle" && maximaleUmstiege !== "" && maximaleUmstiege !== null) {
              processedMaxUmstiege = Number.parseInt(String(maximaleUmstiege))
            }
            // Falls maximaleUmstiege === undefined, null, "alle" oder "", bleibt processedMaxUmstiege = undefined (= alle Verbindungen)

            const dayResponse = await getBestPrice({
              abfahrtsHalt: startStation.id,
              ankunftsHalt: zielStation.id,
              startStationNormalizedId: startStation.normalizedId,
              zielStationNormalizedId: zielStation.normalizedId,
              anfrageDatum: currentDate,
              sessionId,
              alter,
              ermaessigungArt,
              ermaessigungKlasse,
              klasse,
              maximaleUmstiege: processedMaxUmstiege,
              schnelleVerbindungen: schnelleVerbindungen === true || schnelleVerbindungen === "1",
              nurDeutschlandTicketVerbindungen:
                nurDeutschlandTicketVerbindungen === true || nurDeutschlandTicketVerbindungen === "1",
              abfahrtAb,
              ankunftBis,
              umstiegszeit,
            })

            // Prüfe Session-Abbruch NACH dem Request aber VOR der Verarbeitung
            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              // Nur einmal loggen, nicht für jeden Tag
              return { currentDateStr, dayResponse: { result: null }, dayCount }
            }

            // Zeitfilter für Abfahrt/Ankunft anwenden (vereinheitlicht)
            if ((abfahrtAb || ankunftBis) && dayResponse.result) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = dayResponse.result[dateKey]
                if (priceData && priceData.allIntervals && Array.isArray(priceData.allIntervals)) {
                  
                  const filteredIntervals = priceData.allIntervals.filter(interval => {
                    const depDate = new Date(interval.abfahrtsZeitpunkt)
                    const arrDate = new Date(interval.ankunftsZeitpunkt)
                    const depMinutes = depDate.getHours() * 60 + depDate.getMinutes()
                    const arrMinutes = arrDate.getHours() * 60 + arrDate.getMinutes()
                    
                    // Parse Filterzeiten
                    const abfahrtAbMinutes = abfahrtAb ? (() => { const [h, m] = abfahrtAb.split(":").map(Number); return h * 60 + (m || 0) })() : null
                    const ankunftBisMinutes = ankunftBis ? (() => { const [h, m] = ankunftBis.split(":").map(Number); return h * 60 + (m || 0) })() : null

                    // Helper: Check if dates are same day
                    const isSameDay = (date1: Date, date2: Date) => (
                      date1.getFullYear() === date2.getFullYear() &&
                      date1.getMonth() === date2.getMonth() &&
                      date1.getDate() === date2.getDate()
                    )

                    // Helper: Check if arrival is next day
                    const isNextDay = (depDate: Date, arrDate: Date) => {
                      const nextDay = new Date(depDate)
                      nextDay.setDate(depDate.getDate() + 1)
                      return isSameDay(arrDate, nextDay)
                    }

                    // Beide Filter gesetzt
                    if (abfahrtAbMinutes !== null && ankunftBisMinutes !== null) {
                      if (abfahrtAbMinutes < ankunftBisMinutes) {
                        // Zeitfenster innerhalb eines Tages (z.B. 10–18 Uhr): Nur Tagesverbindungen
                        return isSameDay(depDate, arrDate) && 
                               depMinutes >= abfahrtAbMinutes && 
                               arrMinutes <= ankunftBisMinutes
                      } else {
                        // Zeitfenster über Mitternacht (z.B. 22–06 Uhr): Nachtverbindungen erlauben
                        if (isSameDay(depDate, arrDate)) {
                          // Abfahrt und Ankunft am selben Tag
                          return depMinutes >= abfahrtAbMinutes
                        } else if (isNextDay(depDate, arrDate)) {
                          // Ankunft am Folgetag
                          return depMinutes >= abfahrtAbMinutes && arrMinutes <= ankunftBisMinutes
                        }
                        return false
                      }
                    }
                    
                    // Nur abfahrtAb gesetzt
                    if (abfahrtAbMinutes !== null) {
                      return depMinutes >= abfahrtAbMinutes
                    }
                    
                    // Nur ankunftBis gesetzt
                    if (ankunftBisMinutes !== null) {
                      if (isSameDay(depDate, arrDate)) {
                        return arrMinutes <= ankunftBisMinutes
                      } else if (isNextDay(depDate, arrDate)) {
                        // Nachtverbindungen: nur wenn Abfahrt nach Ankunftszeit liegt
                        return arrMinutes <= ankunftBisMinutes && depMinutes > arrMinutes
                      }
                      return false
                    }
                    
                    // Kein Filter: alles erlauben
                    return true
                  })

                  // WICHTIG: Aktualisiere allIntervals VOR der Bestpreis-Berechnung
                  priceData.allIntervals = filteredIntervals
                  
                  console.log(`🔍 Time filter: ${priceData.allIntervals.length} intervals after time filtering for ${dateKey}`)
                  
                  if (filteredIntervals.length === 0) {
                    priceData.preis = 0
                    priceData.abfahrtsZeitpunkt = ""
                    priceData.ankunftsZeitpunkt = ""
                    priceData.info = "Keine Verbindungen im gewählten Zeitfenster"
                  } else {
                    // Verwende intelligenten Algorithmus für Bestpreis-Auswahl
                    const recommendedTrip = recommendBestPrice(filteredIntervals)
                    
                    if (recommendedTrip) {
                      priceData.preis = recommendedTrip.preis
                      priceData.abfahrtsZeitpunkt = recommendedTrip.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = recommendedTrip.ankunftsZeitpunkt
                      priceData.info = recommendedTrip.info
                    } else {
                      const minPrice = Math.min(...filteredIntervals.map(i => i.preis))
                      const bestPriceIntervals = filteredIntervals.filter(i => i.preis === minPrice)
                      bestPriceIntervals.sort((a, b) => {
                        const aDuration = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
                        const bDuration = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                        if (aDuration !== bDuration) return aDuration - bDuration
                        return new Date(a.abfahrtsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                      })
                      const bestInterval = bestPriceIntervals[0]
                      
                      priceData.preis = minPrice
                      priceData.abfahrtsZeitpunkt = bestInterval?.abfahrtsZeitpunkt || priceData.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = bestInterval?.ankunftsZeitpunkt || priceData.ankunftsZeitpunkt
                      priceData.info = bestInterval?.info || priceData.info
                    }
                  }
                }
              }
            }

            const duration = Date.now() - t0
            updateAverageResponseTimes(duration, isCached)

            // Markiere günstigste Verbindung pro Zeitfenster NACH allen Filtern
            if (dayResponse.result) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = dayResponse.result[dateKey]
                if (priceData && priceData.allIntervals && Array.isArray(priceData.allIntervals)) {
                  
                  // Falls noch kein spezifischer Bestpreis gesetzt wurde
                  if (!abfahrtAb && !ankunftBis && priceData.allIntervals.length > 1) {
                    const recommendedTrip = recommendBestPrice(priceData.allIntervals)
                    if (recommendedTrip) {
                      priceData.preis = recommendedTrip.preis
                      priceData.abfahrtsZeitpunkt = recommendedTrip.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = recommendedTrip.ankunftsZeitpunkt
                      priceData.info = recommendedTrip.info
                    }
                  }

                  // Zeitfenster-Definition (immer verwenden, auch mit Zeitfiltern!)
                  const timeSlots = [
                    { start: 0, end: 7 },
                    { start: 7, end: 10 },
                    { start: 10, end: 13 },
                    { start: 13, end: 16 },
                    { start: 16, end: 19 },
                    { start: 19, end: 24 },
                  ]

                  // Setze alle auf false
                  for (const interval of priceData.allIntervals) {
                    interval.isCheapestPerInterval = false
                  }

                  // Gruppiere nach Zeitfenstern
                  const slotMap = new Map<number, any[]>()
                  for (const interval of priceData.allIntervals) {
                    const depDate = new Date(interval.abfahrtsZeitpunkt)
                    const depHour = depDate.getHours() + (depDate.getMinutes() / 60)
                    const slotIndex = timeSlots.findIndex(slot => depHour >= slot.start && depHour < slot.end)
                    if (slotIndex >= 0) {
                      if (!slotMap.has(slotIndex)) {
                        slotMap.set(slotIndex, [])
                      }
                      slotMap.get(slotIndex)!.push(interval)
                    }
                  }

                  // Markiere günstigste pro Slot
                  slotMap.forEach((intervals, slotIndex) => {
                    if (intervals.length > 0) {
                      const bestInSlot = recommendBestPrice(intervals)
                      if (bestInSlot) {
                        for (const interval of intervals) {
                          const isMatch = (
                            interval.abfahrtsZeitpunkt === bestInSlot.abfahrtsZeitpunkt &&
                            interval.ankunftsZeitpunkt === bestInSlot.ankunftsZeitpunkt &&
                            interval.preis === bestInSlot.preis
                          )
                          if (isMatch) {
                            interval.isCheapestPerInterval = true
                          }
                        }
                      } else {
                        const sortedIntervals = intervals.slice().sort((a, b) => {
                          if (a.preis !== b.preis) return a.preis - b.preis
                          const aDuration = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
                          const bDuration = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                          if (aDuration !== bDuration) return aDuration - bDuration
                          return new Date(a.abfahrtsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                        })
                        sortedIntervals[0].isCheapestPerInterval = true
                      }
                    }
                  })
                  
                  // Final count
                  const markedCount = priceData.allIntervals.filter(i => i.isCheapestPerInterval === true).length
                  console.log(`🏁 Final result for ${dateKey}: ${markedCount} intervals marked as cheapest out of ${priceData.allIntervals.length} total`)
                }
              }
            }

            return { currentDateStr, dayResponse, dayCount }
          })

          // Verarbeite Ergebnisse sobald sie ankommen
          let completedRequests = 0
          const processResult = async (resultPromise: Promise<any>) => {
            try {
              const { currentDateStr, dayResponse, dayCount } = await resultPromise
              completedRequests++

              // Prüfe Session-Abbruch BEVOR Ergebnis verarbeitet wird
              if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
                return false
              }

              if (dayResponse.result) {
                Object.assign(results, dayResponse.result)
                //console.log(`Day ${currentDateStr} result:`, Object.values(dayResponse.result)[0])
                
                // Stream einzelnes Tagesergebnis nur wenn Session noch aktiv
                if (!globalRateLimiter.isSessionCancelledSync(sessionId)) {
                  const dayResult = {
                    type: 'dayResult',
                    date: currentDateStr,
                    result: Object.values(dayResponse.result)[0],
                    meta: metaData
                  }
                  
                  if (!safeEnqueue(encoder.encode(JSON.stringify(dayResult) + '\n'))) {
                    // User disconnected - stop processing but don't log multiple times
                    return false
                  }
                }
              }

              // Progress-Update nach jedem abgeschlossenen Request (nur wenn Session noch aktiv)
              if (!globalRateLimiter.isSessionCancelledSync(sessionId)) {
                const updatedQueueStatus = globalRateLimiter.getQueueStatus()
                const updatedAvgTimes = getAverageResponseTimes()
                await updateProgress(
                  sessionId,
                  completedRequests,
                  maxDays,
                  currentDateStr,
                  false,
                  Math.max(0, totalUncachedDays - completedRequests),
                  Math.max(0, totalCachedDays - completedRequests),
                  updatedAvgTimes.uncached,
                  updatedAvgTimes.cached,
                  updatedQueueStatus.queueSize,
                  updatedQueueStatus.activeRequests
                )
              }

              // Wenn letzter Tag verarbeitet wurde, sofort Abschluss senden
              if (!completeSent && completedRequests >= maxDays && !globalRateLimiter.isSessionCancelledSync(sessionId)) {
                await sendFinalComplete()
              }

              return true
            } catch (error) {
              completedRequests++
              
              // Behandle cancelled sessions nicht als Fehler
              if (error instanceof Error && error.message.includes('was cancelled')) {
                if (!cancelLoggedForSession) {
                  console.log(`ℹ️ Search was cancelled by user (session: ${sessionId})`)
                  cancelLoggedForSession = true
                }
                return true
              }
              
              console.error(`❌ Error processing request:`, error)
              return true
            }
          }

          // Warte auf alle Requests, aber verarbeite sie sobald sie fertig sind
          await Promise.all(requestPromises.map(processResult))

          // Falls aus irgendeinem Grund noch nicht gesendet, jetzt senden
          if (!completeSent && !globalRateLimiter.isSessionCancelledSync(sessionId)) {
            await sendFinalComplete()
          }

        } catch (error) {
          console.error("Error in streaming bestpreissuche:", error)
          const errorResult = {
            type: 'error',
            error: "Internal server error",
            details: error instanceof Error ? error.message : "Unknown error"
          }
          safeEnqueue(encoder.encode(JSON.stringify(errorResult) + '\n'))
          safeClose()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    console.error("Error in bestpreissuche API:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
