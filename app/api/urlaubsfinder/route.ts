import { type NextRequest, NextResponse } from "next/server"
import { getBestPrice, searchBahnhof } from '@/app/api/search-prices/bahn-api'
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

        for (let i = 0; i < destinationEntries.length; i++) {
          if (request.signal.aborted) {
            logDebug(LOG_SCOPE, "Client disconnected; stopping Urlaubsfinder destination processing", {
              processedDestinations: i,
              totalDestinations,
            })
            break
          }

          const [destName, destData] = destinationEntries[i]
          const destinationDisplayName = destData.displayName

          // Send progress update for the currently processed destination.
          // processed counts finished destinations, so the first destination starts at 0.
          const progress = {
            processed: i,
            total: totalDestinations,
            destination: destinationDisplayName,
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: progress })}\n\n`)
          )
          
          try {
            // Fetch outward journey prices
            const outwardConfig = {
              abfahrtsHalt: homeStationData.id,
              ankunftsHalt: destData.id,
              startStationNormalizedId: homeStationData.normalizedId,
              zielStationNormalizedId: destData.normalizedId,
              anfrageDatum: new Date(outwardDate), // Convert to Date object
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

            const outwardResult = await getBestPrice(outwardConfig)

            if (request.signal.aborted) {
              logDebug(LOG_SCOPE, "Client disconnected after outward search; stopping Urlaubsfinder", {
                destination: destinationDisplayName,
                outwardDate,
              })
              break
            }

            let outwardPrice = 0
            let outwardDeparture = ""
            let outwardArrival = ""
            let outwardTransfers = 0
            let outwardLegs: JourneyLeg[] = []

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

            let returnPrice = 0
            let returnDeparture = ""
            let returnArrival = ""
            let returnTransfers = 0
            let returnLegs: JourneyLeg[] = []

            // Fetch return journey if return date is provided
            if (returnDate) {
              const returnConfig = {
              abfahrtsHalt: destData.id,
              ankunftsHalt: homeStationData.id,
              startStationNormalizedId: destData.normalizedId,
              zielStationNormalizedId: homeStationData.normalizedId,
              anfrageDatum: new Date(returnDate), // Convert to Date object
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

            const returnResult = await getBestPrice(returnConfig)

              if (request.signal.aborted) {
                logDebug(LOG_SCOPE, "Client disconnected after return search; stopping Urlaubsfinder", {
                  destination: destinationDisplayName,
                  returnDate,
                })
                break
              }

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
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'result', data: newResult })}\n\n`)
              )
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
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'unavailable', data: unavailableEntry })}\n\n`)
              )
            }

          } catch (error) {
            logError(LOG_SCOPE, "Urlaubsfinder destination search failed", error, {
              destination: destName,
              outwardDate,
              returnDate,
            })
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                message: `Error searching ${destName}` 
              })}\n\n`)
            )
          }

          if (!request.signal.aborted) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: 'progress',
                data: {
                  processed: i + 1,
                  total: totalDestinations,
                  destination: destinationDisplayName,
                },
              })}\n\n`)
            )
          }
        }

        // Sort by total price
        results.sort((a, b) => a.totalPrice - b.totalPrice)

        logInfo(LOG_SCOPE, "✅ Urlaubsfinder abgeschlossen", {
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

        if (request.signal.aborted) {
          try {
            controller.close()
          } catch {}
          return
        }

        // Send final results
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'results', data: results })}\n\n`)
        )
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'unavailables', data: unavailableDestinations })}\n\n`)
        )
        controller.close()
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
