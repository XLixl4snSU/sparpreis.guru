import { type NextRequest, NextResponse } from "next/server"
import { getBestPrice, searchBahnhof } from '@/app/api/search-prices/bahn-api'
import { globalRateLimiter } from '@/app/api/search-prices/rate-limiter'
import { metricsCollector } from '@/app/api/metrics/collector'
import { ICE_STATIONS } from '@/lib/stations/ice-stations'
import { isUrlaubsfinderEnabled } from '@/lib/shared/feature-flags'
import { logDebug, logError, logInfo } from '@/lib/shared/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG_SCOPE = "urlaubsfinder.request"

function formatTimeWindow(abfahrtAb?: string, abfahrtBis?: string, ankunftAb?: string, ankunftBis?: string): string {
  if (!abfahrtAb && !abfahrtBis && !ankunftAb && !ankunftBis) return "beliebig"
  return `Abfahrt ${abfahrtAb || "beliebig"}-${abfahrtBis || "beliebig"}, Ankunft ${ankunftAb || "beliebig"}-${ankunftBis || "beliebig"}`
}

interface JourneyLeg {
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

interface DestinationResult {
  destination: string
  destinationId: string
  homeStationId: string
  homeStationName: string
  outwardDate: string
  outwardPrice: number
  outwardDeparture: string
  outwardArrival: string
  outwardTransfers?: number
  outwardLegs?: JourneyLeg[]
  returnDate?: string
  returnPrice?: number
  returnDeparture?: string
  returnArrival?: string
  returnTransfers?: number
  returnLegs?: JourneyLeg[]
  totalPrice: number
  lat?: number
  lon?: number
}

interface UnavailableDestination {
  destination: string
  reason: string
  outwardPrice?: number
  returnPrice?: number
}

interface JourneyInterval {
  preis?: number
  abfahrtsZeitpunkt?: string
  ankunftsZeitpunkt?: string
  umstiegsAnzahl?: number
  abschnitte?: JourneyLeg[]
}

interface JourneyPriceData {
  preis?: number
  abfahrtsZeitpunkt?: string
  ankunftsZeitpunkt?: string
  allIntervals?: JourneyInterval[]
}

interface UrlauberfinderRequest {
  homeStation: string
  destinations: string[]
  outwardDate: string
  returnDate?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: boolean
  maximaleUmstiege?: string
  // Separate time filters for outward and return journeys
  outwardAbfahrtAb?: string
  outwardAbfahrtBis?: string
  outwardAnkunftAb?: string
  outwardAnkunftBis?: string
  returnAbfahrtAb?: string
  returnAbfahrtBis?: string
  returnAnkunftAb?: string
  returnAnkunftBis?: string
  umstiegszeit?: string
}

function hasJourneyTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function getDisplayInterval(data: JourneyPriceData): JourneyInterval | undefined {
  const intervals = Array.isArray(data.allIntervals) ? data.allIntervals : []
  if (intervals.length === 0) return undefined

  const matchingPriceInterval = intervals.find(
    (interval) =>
      interval.preis === data.preis &&
      hasJourneyTimestamp(interval.abfahrtsZeitpunkt) &&
      hasJourneyTimestamp(interval.ankunftsZeitpunkt)
  )

  return (
    matchingPriceInterval ||
    intervals.find(
      (interval) =>
        hasJourneyTimestamp(interval.abfahrtsZeitpunkt) &&
        hasJourneyTimestamp(interval.ankunftsZeitpunkt)
    )
  )
}

function getJourneyTimes(data: JourneyPriceData) {
  const displayInterval = getDisplayInterval(data)
  const legs = Array.isArray(displayInterval?.abschnitte)
    ? displayInterval.abschnitte.map((leg: JourneyLeg) => ({
        abfahrtsZeitpunkt: leg.abfahrtsZeitpunkt,
        ankunftsZeitpunkt: leg.ankunftsZeitpunkt,
        abfahrtsOrt: leg.abfahrtsOrt,
        ankunftsOrt: leg.ankunftsOrt,
        verkehrsmittel: leg.verkehrsmittel,
      }))
    : []

  return {
    departure:
      data.abfahrtsZeitpunkt ||
      displayInterval?.abfahrtsZeitpunkt ||
      legs[0]?.abfahrtsZeitpunkt ||
      "",
    arrival:
      data.ankunftsZeitpunkt ||
      displayInterval?.ankunftsZeitpunkt ||
      legs[legs.length - 1]?.ankunftsZeitpunkt ||
      "",
    transfers: displayInterval?.umstiegsAnzahl || 0,
    legs,
  }
}

export async function POST(request: NextRequest) {
  const searchStartTime = Date.now()
  const sessionId = crypto.randomUUID()

  if (!isUrlaubsfinderEnabled()) {
    return NextResponse.json({ error: 'Urlaubsfinder is disabled' }, { status: 404 })
  }

  try {
    const body: UrlauberfinderRequest = await request.json()
    const {
      homeStation,
      destinations,
      outwardDate,
      returnDate,
      alter = "ERWACHSENER",
      ermaessigungArt = "KEINE_ERMAESSIGUNG",
      ermaessigungKlasse = "KLASSENLOS",
      klasse = "KLASSE_2",
      schnelleVerbindungen = true,
      maximaleUmstiege,
      outwardAbfahrtAb,
      outwardAbfahrtBis,
      outwardAnkunftAb,
      outwardAnkunftBis,
      returnAbfahrtAb,
      returnAbfahrtBis,
      returnAnkunftAb,
      returnAnkunftBis,
      umstiegszeit,
    } = body

    if (!homeStation || !destinations || destinations.length === 0) {
      return NextResponse.json(
        { error: "homeStation and destinations array required" },
        { status: 400 }
      )
    }

    metricsCollector.recordUrlaubsfinderSearch(destinations.length)

    logInfo(LOG_SCOPE, "🏖️ Urlaubsfinder gestartet", {
      sessionId,
      homeStation,
      destinationCount: destinations.length,
      outwardDate,
      returnDate,
      outwardTimeWindow: formatTimeWindow(outwardAbfahrtAb, outwardAbfahrtBis, outwardAnkunftAb, outwardAnkunftBis),
      returnTimeWindow: formatTimeWindow(returnAbfahrtAb, returnAbfahrtBis, returnAnkunftAb, returnAnkunftBis),
      maxTransfers: maximaleUmstiege ?? "alle",
      travelClass: klasse,
    })

    // Resolve home station
    const homeStationData = await searchBahnhof(homeStation)
    if (!homeStationData) {
      metricsCollector.recordUrlaubsfinderError()
      return NextResponse.json(
        { error: `Home station "${homeStation}" not found` },
        { status: 404 }
      )
    }

    // Resolve all destination stations
    const destinationMap = new Map<string, {
      id: string
      normalizedId: string
      name: string
      displayName: string
      lat?: number
      lon?: number
    }>()
    
    for (const dest of destinations) {
      const stationInfo = ICE_STATIONS.find(s => s.name === dest)
      const destData = await searchBahnhof(dest)
      if (destData) {
        destinationMap.set(dest, {
          ...destData,
          displayName: stationInfo?.displayName || dest,
          lat: stationInfo?.lat,
          lon: stationInfo?.lon,
        })
      }
    }

    if (destinationMap.size === 0) {
      metricsCollector.recordUrlaubsfinderError()
      return NextResponse.json(
        { error: "No valid destinations found" },
        { status: 404 }
      )
    }

    logDebug(LOG_SCOPE, "📍 Urlaubsfinder stations resolved", {
      homeStation: homeStationData.name,
      homeStationId: homeStationData.normalizedId,
      requestedDestinationCount: destinations.length,
      resolvedDestinationCount: destinationMap.size,
    })

    // Streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const results: DestinationResult[] = []
        const unavailableDestinations: UnavailableDestination[] = []
        const destinationEntries = Array.from(destinationMap.entries())
        const totalDestinations = destinationEntries.length
        let completedDestinations = 0
        let isStreamClosed = false

        const abortHandler = () => {
          globalRateLimiter.cancelSession(sessionId, 'user_request')
        }
        request.signal.addEventListener('abort', abortHandler, { once: true })

        const safeEnqueue = (payload: unknown) => {
          if (isStreamClosed || request.signal.aborted) return false

          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            )
            return true
          } catch {
            isStreamClosed = true
            globalRateLimiter.cancelSession(sessionId, 'user_request')
            return false
          }
        }

        const processDestination = async (
          entry: [string, {
            id: string
            normalizedId: string
            name: string
            displayName: string
            lat?: number
            lon?: number
          }],
          index: number
        ) => {
          if (request.signal.aborted) {
            return
          }

          const [destName, destData] = entry
          const destinationDisplayName = destData.displayName

          safeEnqueue({
            type: 'progress',
            data: {
              processed: completedDestinations,
              queued: index + 1,
              total: totalDestinations,
              destination: destinationDisplayName,
            },
          })

          logDebug(LOG_SCOPE, "Urlaubsfinder destination queued", {
            sessionId,
            destination: destinationDisplayName,
            queuedDestination: index + 1,
            total: totalDestinations,
          })
          
          try {
            // Fetch outward journey prices
            const outwardConfig = {
              abfahrtsHalt: homeStationData.id,
              ankunftsHalt: destData.id,
              startStationNormalizedId: homeStationData.normalizedId,
              zielStationNormalizedId: destData.normalizedId,
              anfrageDatum: new Date(outwardDate), // Convert to Date object
              sessionId,
              alter,
              ermaessigungArt,
              ermaessigungKlasse,
              klasse,
              schnelleVerbindungen,
              maximaleUmstiege: maximaleUmstiege ? parseInt(maximaleUmstiege) : undefined,
              abfahrtAb: outwardAbfahrtAb,
              abfahrtBis: outwardAbfahrtBis,
              ankunftAb: outwardAnkunftAb,
              ankunftBis: outwardAnkunftBis,
              umstiegszeit,
            }

            const outwardResultPromise = getBestPrice(outwardConfig)

            let outwardPrice = 0
            let outwardDeparture = ""
            let outwardArrival = ""
            let outwardTransfers = 0
            let outwardLegs: JourneyLeg[] = []

            let returnPrice = 0
            let returnDeparture = ""
            let returnArrival = ""
            let returnTransfers = 0
            let returnLegs: JourneyLeg[] = []
            let returnResultPromise: ReturnType<typeof getBestPrice> | Promise<null> = Promise.resolve(null)

            // Fetch return journey if return date is provided
            if (returnDate) {
              const returnConfig = {
                abfahrtsHalt: destData.id,
                ankunftsHalt: homeStationData.id,
                startStationNormalizedId: destData.normalizedId,
                zielStationNormalizedId: homeStationData.normalizedId,
                anfrageDatum: new Date(returnDate), // Convert to Date object
                sessionId,
                alter,
                ermaessigungArt,
                ermaessigungKlasse,
                klasse,
                schnelleVerbindungen,
                maximaleUmstiege: maximaleUmstiege ? parseInt(maximaleUmstiege) : undefined,
                abfahrtAb: returnAbfahrtAb,
                abfahrtBis: returnAbfahrtBis,
                ankunftAb: returnAnkunftAb,
                ankunftBis: returnAnkunftBis,
                umstiegszeit,
              }

              returnResultPromise = getBestPrice(returnConfig)
            }

            const [outwardResult, returnResult] = await Promise.all([
              outwardResultPromise,
              returnResultPromise,
            ])

            if (request.signal.aborted) {
              return
            }

            if (outwardResult?.result) {
              // Find the entry for the requested date
              const dateKey = outwardDate // The key will be in YYYY-MM-DD format
              const outwardData = outwardResult.result[dateKey]
              if (outwardData && outwardData.preis > 0) {
                outwardPrice = outwardData.preis
                const outwardJourney = getJourneyTimes(outwardData)
                outwardDeparture = outwardJourney.departure
                outwardArrival = outwardJourney.arrival
                outwardTransfers = outwardJourney.transfers
                outwardLegs = outwardJourney.legs
              }
            }

            if (returnDate) {
              if (returnResult?.result) {
                const dateKey = returnDate // The key will be in YYYY-MM-DD format
                const returnData = returnResult.result[dateKey]
                if (returnData && returnData.preis > 0) {
                  returnPrice = returnData.preis
                  const returnJourney = getJourneyTimes(returnData)
                  returnDeparture = returnJourney.departure
                  returnArrival = returnJourney.arrival
                  returnTransfers = returnJourney.transfers
                  returnLegs = returnJourney.legs
                }
              }
            }

            const hasOutward = outwardPrice > 0
            const hasReturn = returnDate ? returnPrice > 0 : true
            const totalPrice = outwardPrice + (returnDate ? returnPrice : 0)

            if (hasOutward && hasReturn) {
              const newResult: DestinationResult = {
                destination: destinationDisplayName,
                destinationId: destData.normalizedId,
                homeStationId: homeStationData.normalizedId,
                homeStationName: homeStation,
                outwardDate,
                outwardPrice,
                outwardDeparture,
                outwardArrival,
                outwardTransfers,
                outwardLegs: outwardLegs.length > 0 ? outwardLegs : undefined,
                ...(returnDate && {
                  returnDate,
                  returnPrice,
                  returnDeparture,
                  returnArrival,
                  returnTransfers,
                  returnLegs: returnLegs.length > 0 ? returnLegs : undefined,
                }),
                totalPrice,
                lat: destData.lat,
                lon: destData.lon,
              }
              results.push(newResult)

              // Stream this result immediately so the UI updates live
              safeEnqueue({ type: 'result', data: newResult })
            } else {
              let reason = 'Keine verwertbare Verbindung gefunden'
              if (returnDate) {
                if (!hasOutward && !hasReturn) {
                  reason = 'Keine Hinfahrt und keine Rückfahrt am gewählten Datum gefunden'
                } else if (!hasOutward) {
                  reason = 'Keine Hinfahrt am gewählten Datum gefunden'
                } else if (!hasReturn) {
                  reason = 'Keine Rückfahrt am gewählten Datum gefunden'
                }
              } else if (!hasOutward) {
                reason = 'Keine Hinfahrt am gewählten Datum gefunden'
              }

              const unavailableEntry: UnavailableDestination = {
                destination: destinationDisplayName,
                reason,
                outwardPrice: hasOutward ? outwardPrice : undefined,
                returnPrice: returnDate && hasReturn ? returnPrice : undefined,
              }
              unavailableDestinations.push(unavailableEntry)
              safeEnqueue({ type: 'unavailable', data: unavailableEntry })
            }

          } catch (error) {
            if (error instanceof Error && error.message.includes('was cancelled')) {
              return
            }

            logError(LOG_SCOPE, "Urlaubsfinder destination search failed", error, {
              destination: destName,
              outwardDate,
              returnDate,
            })
            safeEnqueue({
              type: 'error',
              message: `Error searching ${destName}`,
            })
          } finally {
            completedDestinations++

            if (!request.signal.aborted) {
              safeEnqueue({
                type: 'progress',
                data: {
                  processed: completedDestinations,
                  total: totalDestinations,
                  destination: destinationDisplayName,
                },
              })
            }
          }
        }

        logInfo(LOG_SCOPE, "Urlaubsfinder destination price requests queued in parallel", {
          sessionId,
          destinations: totalDestinations,
          priceRequests: totalDestinations * (returnDate ? 2 : 1),
        })

        await Promise.all(
          destinationEntries.map((entry, index) => processDestination(entry, index))
        )

        if (request.signal.aborted) {
          logDebug(LOG_SCOPE, "Client disconnected; stopping Urlaubsfinder destination processing", {
            sessionId,
            processedDestinations: completedDestinations,
            totalDestinations,
          })
          request.signal.removeEventListener('abort', abortHandler)
          try {
            controller.close()
          } catch {}
          isStreamClosed = true
          return
        }

        // Sort by total price
        results.sort((a, b) => a.totalPrice - b.totalPrice)

        logInfo(LOG_SCOPE, "✅ Urlaubsfinder abgeschlossen", {
          sessionId,
          outwardDate,
          returnDate,
          foundDestinations: results.length,
          unavailableDestinations: unavailableDestinations.length,
          cheapestDestination: results[0]?.destination,
          cheapestTotalPrice: results[0]?.totalPrice,
        })
        metricsCollector.recordUrlaubsfinderCompletion(
          Date.now() - searchStartTime,
          results.length,
          unavailableDestinations.length
        )

        globalRateLimiter.cancelSession(sessionId, 'search_completed')
        request.signal.removeEventListener('abort', abortHandler)

        // Send final results
        safeEnqueue({ type: 'results', data: results })
        safeEnqueue({ type: 'unavailables', data: unavailableDestinations })
        if (!isStreamClosed) {
          controller.close()
          isStreamClosed = true
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    metricsCollector.recordUrlaubsfinderError()
    logError(LOG_SCOPE, "Urlaubsfinder API request failed", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
