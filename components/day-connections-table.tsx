import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Train, Shuffle, TrendingUp, ArrowRight, Euro, Info, Star, Clock, Minus, TrendingDown } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { VehicleTypesSummary } from "@/components/vehicle-types-summary"
import { PriceHistoryChart } from "@/components/price-history-chart"

// Helper function to calculate transfer time between connections
function calculateTransferTime(fromArrival: string, toDepature: string): number {
  const arrival = new Date(fromArrival)
  const departure = new Date(toDepature)
  return Math.round((departure.getTime() - arrival.getTime()) / 60000)
}

// Helper function to get vehicle type icon/color
function getVehicleTypeStyle(produktGattung?: string) {
  switch (produktGattung) {
    case 'ICE':
      return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    case 'EC_IC':
    case 'IC':
    case 'EC':
      return { color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
    case 'IR':
    case 'REGIONAL':
      return { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
    case 'SBAHN':
      return { color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' }
    case 'BUS':
      return { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
    default:
      return { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' }
  }
}

// Component to render journey timeline (Desktop horizontal layout)
function JourneyTimeline({ interval }: { interval: any }) {
  if (!interval.abschnitte || interval.abschnitte.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-600 w-full">
        <div className={`px-2 py-1 rounded font-medium text-gray-600 bg-gray-50 border-gray-200 border`}>
          Zug
        </div>
        <div className="flex-1 h-px bg-gray-300"></div>
        <div className="text-xs font-medium">{interval.abfahrtsOrt} → {interval.ankunftsOrt}</div>
      </div>
    )
  }

  // Helper function to get transfer time styling
  const getTransferTimeStyle = (minutes: number) => {
    if (minutes <= 6) {
      return { 
        bg: 'bg-red-100', 
        text: 'text-red-700', 
        border: 'border-red-300',
        label: '' 
      }
    } else if (minutes <= 10) {
      return { 
        bg: 'bg-orange-100', 
        text: 'text-orange-700', 
        border: 'border-orange-300',
        label: '' 
      }
    } else if (minutes >= 30) {
      return { 
        bg: 'bg-green-100', 
        text: 'text-green-700', 
        border: 'border-green-300',
        label: '' 
      }
    } else {
      return { 
        bg: 'bg-blue-100', 
        text: 'text-blue-700', 
        border: 'border-blue-300',
        label: '' 
      }
    }
  }

  // Split abschnitte into chunks if they're too many for one row
  const maxSegmentsPerRow = 3 // Maximum segments that fit comfortably in one row
  const abschnitteChunks = []
  
  for (let i = 0; i < interval.abschnitte.length; i += maxSegmentsPerRow) {
    abschnitteChunks.push(interval.abschnitte.slice(i, i + maxSegmentsPerRow))
  }

  return (
    <div className="w-full space-y-2">
      {abschnitteChunks.map((chunk, chunkIdx) => {
        const isLastChunk = chunkIdx === abschnitteChunks.length - 1
        const chunkStartIdx = chunkIdx * maxSegmentsPerRow
        
        return (
          <div key={chunkIdx} className="flex items-start">
            {chunk.map((abschnitt: any, idx: number) => {
              const globalIdx = chunkStartIdx + idx
              const vehicleStyle = getVehicleTypeStyle(abschnitt.verkehrsmittel?.produktGattung)
              const isFirst = globalIdx === 0
              const isLast = globalIdx === interval.abschnitte.length - 1
              const nextAbschnitt = !isLast ? interval.abschnitte[globalIdx + 1] : null
              const transferTime = nextAbschnitt 
                ? calculateTransferTime(abschnitt.ankunftsZeitpunkt, nextAbschnitt.abfahrtsZeitpunkt)
                : null
              const transferStyle = transferTime ? getTransferTimeStyle(transferTime) : null

              const duration = (() => {
                const depTime = new Date(abschnitt.abfahrtsZeitpunkt)
                const arrTime = new Date(abschnitt.ankunftsZeitpunkt)
                const durationMinutes = Math.round((arrTime.getTime() - depTime.getTime()) / 60000)
                const hours = Math.floor(durationMinutes / 60)
                const minutes = durationMinutes % 60
                return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`
              })()

              const topRowHeight = 'h-8'
              const textSize = 'text-xs'

              return (
                <React.Fragment key={idx}>
                  {/* === Start Station (First Leg Only) === */}
                  {(isFirst || (chunkIdx > 0 && idx === 0)) && (
                    <div className="flex flex-col text-center flex-shrink-0">
                      <div className={`${topRowHeight} flex items-center justify-center px-1`}>
                        <div className={`font-semibold text-gray-800 ${textSize} whitespace-nowrap`}>
                          {abschnitt.abfahrtsOrt}
                        </div>
                      </div>
                      <div className={`font-semibold text-gray-800 ${textSize} whitespace-nowrap mt-1`}>
                        {new Date(abschnitt.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  )}

                  {/* === Line === */}
                  <div className="flex-1 flex flex-col px-1">
                    <div className={`${topRowHeight} flex items-center`}>
                      <div className="w-full h-px bg-gray-400"></div>
                    </div>
                    <div className={`${textSize} mt-1 invisible`}>-</div>
                  </div>

                  {/* === Vehicle & Duration === */}
                  <div className="flex flex-col text-center flex-shrink-0">
                    <div className={`${topRowHeight} flex items-center justify-center`}>
                      <div className={`px-2 py-1 rounded font-semibold ${textSize} ${vehicleStyle.color} ${vehicleStyle.bg} ${vehicleStyle.border} border whitespace-nowrap shadow-sm`}>
                        {abschnitt.verkehrsmittel?.name || abschnitt.verkehrsmittel?.kategorie || abschnitt.verkehrsmittel?.produktGattung || 'Zug'}
                      </div>
                    </div>
                    <div className={`${textSize} text-gray-500 whitespace-nowrap mt-1`}>
                      {duration}
                    </div>
                  </div>

                  {/* === Line === */}
                  <div className="flex-1 flex flex-col px-1">
                    <div className={`${topRowHeight} flex items-center`}>
                      <div className="w-full h-px bg-gray-400"></div>
                    </div>
                    <div className={`${textSize} mt-1 invisible`}>-</div>
                  </div>

                  {/* === Arrival/Transfer Station === */}
                  <div className="flex flex-col text-center flex-shrink-0">
                    <div className={`${topRowHeight} flex items-center justify-center px-1`}>
                      <div className={`font-semibold text-gray-800 ${textSize} whitespace-nowrap`}>
                        {abschnitt.ankunftsOrt}
                      </div>
                    </div>
                    <div className={`font-semibold text-gray-800 ${textSize} whitespace-nowrap mt-1`}>
                      {!isLast && transferTime !== null && transferStyle && (idx === chunk.length - 1 && !isLastChunk) ? (
                        // Show arrival time only if this is the last segment in chunk but not the last overall
                        <div className={`font-semibold ${textSize}`}>
                          {new Date(abschnitt.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      ) : !isLast && transferTime !== null && transferStyle ? (
                        <div className={`flex items-center gap-1 justify-center ${textSize}`}>
                          <span className={`font-semibold text-gray-600 ${textSize}`}>
                            {new Date(abschnitt.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <div className={`px-1.5 py-0.5 rounded-full ${transferStyle.bg} ${transferStyle.text} font-medium text-[10px] flex items-center gap-0.5 shadow-sm border ${transferStyle.border}`}>
                            <Clock className="h-2 w-2" />
                            {transferTime}min
                          </div>
                          <span className={`font-semibold text-gray-600 ${textSize}`}>
                            {new Date(nextAbschnitt.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ) : (
                        <div className={`font-semibold ${textSize}`}>
                          {new Date(abschnitt.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* === Arrow to next row if this is the last segment of a non-final chunk === */}
                  {idx === chunk.length - 1 && !isLastChunk && (
                    <>
                      <div className="flex-1 flex flex-col px-1">
                        <div className={`${topRowHeight} flex items-center justify-center`}>
                          <ArrowRight className="h-4 w-4 text-gray-400" />
                        </div>
                        <div className={`${textSize} mt-1 text-center text-gray-400`}>weiter</div>
                      </div>
                    </>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}


export function ConnectionsTable({
  intervals,
  displayedIntervals,
  hasMultipleIntervals,
  minDuration,
  data,
  recommendedTrip,
  startStation,
  zielStation,
  searchParams,
  sortKey,
  sortDir,
  handleSort,
  getIntervalPriceColor,
  calculateDuration,
  getDurationMinutes,
  recommendation,
  createBookingLink,
  showOnlyCheapest,
  setShowOnlyCheapest,
  showAllJourneyDetails,
  setShowAllJourneyDetails,
}: any) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
  const [showAllJourneyDetailsLocal, setShowAllJourneyDetailsLocal] = useState<boolean>(false)

  const toggleExpanded = (index: number) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  // Component to render journey timeline for mobile (vertical layout)
  const MobileJourneyTimeline = ({ interval }: { interval: any }) => {
    if (!interval.abschnitte || interval.abschnitte.length === 0) {
      return (
        <div className="text-xs text-gray-600 text-center py-2">
          Keine Verbindungsdetails verfügbar
        </div>
      )
    }

    // Helper function to get transfer time styling
    const getTransferTimeStyle = (minutes: number) => {
      if (minutes <= 6) {
        return { 
          bg: 'bg-red-100', 
          text: 'text-red-700', 
          border: 'border-red-300',
          label: '' 
        }
      } else if (minutes <= 10) {
        return { 
          bg: 'bg-orange-100', 
          text: 'text-orange-700', 
          border: 'border-orange-300',
          label: '' 
        }
      } else if (minutes >= 30) {
        return { 
          bg: 'bg-green-100', 
          text: 'text-green-700', 
          border: 'border-green-300',
          label: '' 
        }
      } else {
        return { 
          bg: 'bg-blue-100', 
          text: 'text-blue-700', 
          border: 'border-blue-300',
          label: '' 
        }
      }
    }

    return (
      <div className="space-y-3">
        {interval.abschnitte.map((abschnitt: any, idx: number) => {
          const vehicleStyle = getVehicleTypeStyle(abschnitt.verkehrsmittel?.produktGattung)
          const isLast = idx === interval.abschnitte.length - 1
          const nextAbschnitt = !isLast ? interval.abschnitte[idx + 1] : null
          const transferTime = nextAbschnitt 
            ? calculateTransferTime(abschnitt.ankunftsZeitpunkt, nextAbschnitt.abfahrtsZeitpunkt)
            : null
          const transferStyle = transferTime ? getTransferTimeStyle(transferTime) : null

          const duration = (() => {
            const depTime = new Date(abschnitt.abfahrtsZeitpunkt)
            const arrTime = new Date(abschnitt.ankunftsZeitpunkt)
            const durationMinutes = Math.round((arrTime.getTime() - depTime.getTime()) / 60000)
            const hours = Math.floor(durationMinutes / 60)
            const minutes = durationMinutes % 60
            return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`
          })()

          return (
            <div key={idx} className="border-l-2 border-gray-300 pl-3">
              {/* Departure */}
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-gray-800 text-xs">
                  {abschnitt.abfahrtsOrt}
                </div>
                <div className="font-semibold text-gray-800 text-xs">
                  {new Date(abschnitt.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>

              {/* Vehicle and duration */}
              <div className="flex items-center justify-between mb-1">
                <div className={`px-2 py-1 rounded font-semibold text-xs ${vehicleStyle.color} ${vehicleStyle.bg} ${vehicleStyle.border} border whitespace-nowrap shadow-sm`}>
                  {abschnitt.verkehrsmittel?.name || abschnitt.verkehrsmittel?.kategorie || abschnitt.verkehrsmittel?.produktGattung || 'Zug'}
                </div>
                <div className="text-xs text-gray-500">
                  {duration}
                </div>
              </div>

              {/* Arrival */}
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-gray-800 text-xs">
                  {abschnitt.ankunftsOrt}
                </div>
                <div className="font-semibold text-gray-800 text-xs">
                  {new Date(abschnitt.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>

              {/* Transfer info */}
              {!isLast && transferTime !== null && transferStyle && (
                <div className="flex items-center justify-center py-2 border-t border-gray-200">
                  <div className={`px-2 py-1 rounded-full ${transferStyle.bg} ${transferStyle.text} font-medium text-xs flex items-center gap-1 shadow-sm border ${transferStyle.border}`}>
                    <Clock className="h-3 w-3" />
                    {transferTime}min Umstieg
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="bg-blue-50 p-4 rounded-lg">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-2 md:gap-0">
        <h3 className="font-semibold text-blue-800 flex items-center gap-2">
          <Train className="h-4 w-4" />
          Alle verfügbaren Verbindungen ({intervals.length})
        </h3>
        <div className="flex flex-col md:flex-row md:items-center gap-1 mt-2 md:mt-0">
          <div className="flex items-center gap-1">
            <span className="text-sm text-blue-700">Nur günstigste Fahrt im Bestpreis-Zeitfenster</span>
            <Switch
              checked={showOnlyCheapest}
              onCheckedChange={setShowOnlyCheapest}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-blue-600" aria-label="Info zu Zeitfenstern">
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm text-gray-700">
                <div className="font-semibold mb-1 text-blue-800">Bestpreis-Zeitfenster</div>
                <div>
                  Die Bahn gruppiert Bestpreis-Verbindungen in folgende Zeitfenster:<br />
                  0–7 Uhr, 7-10 Uhr, 10–13 Uhr, 13–16 Uhr, 16–19 Uhr, 19–24 Uhr.<br />
                  Pro Zeitfenster wird jeweils die günstigste Verbindung angezeigt.<br />
                  Dies entspricht der offiziellen Bestpreis-Suche der Bahn.
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="hidden md:flex items-center gap-1 ml-4">
            <span className="text-sm text-blue-700">Fahrtverlauf aller Verbindungen anzeigen</span>
            <Switch
              checked={showAllJourneyDetails}
              onCheckedChange={setShowAllJourneyDetails}
            />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {/* Sortierbare Tabellen-Header */}
        {hasMultipleIntervals && (
          <div className="mb-2">
            <div className="flex flex-wrap md:grid md:grid-cols-6 gap-2 md:gap-3 text-xs font-semibold select-none sticky top-0 bg-blue-50 z-10 border-b border-blue-200 w-full">
              {[
                { key: 'abfahrt', label: 'Abfahrt' },
                { key: 'ankunft', label: 'Ankunft' },
                { key: 'umstiege', label: 'Umstiege' },
                { key: 'dauer', label: 'Reisedauer' },
                { key: 'preis', label: 'Preis' },
              ].map(col => (
                <button
                  key={col.key}
                  className={`flex-1 min-w-[90px] text-left flex items-center gap-1 px-2 py-1 rounded transition-colors whitespace-nowrap ${sortKey === col.key ? 'bg-blue-100 text-blue-900' : 'hover:bg-blue-100 text-blue-700'}`}
                  onClick={() => handleSort(col.key)}
                  title="Sortieren"
                  type="button"
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="inline-block">
                      {sortDir === 'asc' ? (
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="chevron-up"><path fillRule="evenodd" d="M10 6a1 1 0 01.7.3l4 4a1 1 0 01-1.4 1.4L10 8.42l-3.3 3.3a1 1 0 01-1.4-1.42l4-4A1 1 0 0110 6z" clipRule="evenodd" /></svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="chevron-down"><path fillRule="evenodd" d="M10 14a1 1 0 01-.7-.3l-4-4a1 1 0 011.4-1.4L10 11.58l3.3-3.3a1 1 0 111.4 1.42l-4 4A1 1 0 0110 14z" clipRule="evenodd" /></svg>
                      )}
                    </span>
                  )}
                </button>
              ))}
              <div className="hidden md:block" />
            </div>
          </div>
        )}
        {/* Verbindungen */}
        <div className="space-y-3">
          {displayedIntervals.map((interval: any, index: number) => {
            const isFastest = minDuration !== null && getDurationMinutes(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt) === minDuration;
            const isBestPrice = interval.preis === data.preis;
            const isRecommended = recommendedTrip && 
              interval.abfahrtsZeitpunkt === recommendedTrip.abfahrtsZeitpunkt && 
              interval.ankunftsZeitpunkt === recommendedTrip.ankunftsZeitpunkt &&
              interval.preis === recommendedTrip.preis;
            const bookingLink =
              startStation && zielStation
                ? createBookingLink(
                    interval.abfahrtsZeitpunkt,
                    startStation.name,
                    zielStation.name,
                    startStation.id,
                    zielStation.id,
                    searchParams.klasse || "KLASSE_2",
                    searchParams.maximaleUmstiege || "",
                    searchParams.alter || "ERWACHSENER",
                    searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                    searchParams.ermaessigungKlasse || "KLASSENLOS",
                    searchParams.umstiegszeit
                  )
                : null;
            const cardBg = isBestPrice ? 'bg-green-50' : 
                          isRecommended ? 'bg-amber-50' : 
                          isFastest ? 'bg-purple-50' : 'bg-white';
            const leftBorder = isBestPrice ? 'border-l-8 border-l-green-500' : 
                              isRecommended ? 'border-l-8 border-l-amber-500' :
                              isFastest ? 'border-l-8 border-l-purple-500' : 'border-l-8 border-l-gray-200';
            return (
              <React.Fragment key={index}>
                {/* Mobile */}
                <div className={`md:hidden rounded-lg shadow-sm p-2 mb-2 relative ${cardBg} ${leftBorder}`}
                  style={isRecommended || isBestPrice ? { paddingTop: 32 } : {}}>
                  {(isRecommended || isBestPrice) && (
                    <div className="absolute top-2 left-2 z-10 flex gap-2">
                      {isRecommended && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Badge className="bg-amber-100 text-amber-800 border border-amber-400 rounded-full cursor-help flex items-center gap-1 px-2 py-1 font-semibold shadow-sm">
                              <Star className="h-3 w-3" />
                              Empfohlen
                            </Badge>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 text-sm">
                            <div className="font-semibold mb-2 text-amber-800">🧠 Intelligente Empfehlung</div>
                            <div className="space-y-2">
                              <div className="text-xs">Basiert auf einer gewichteten Bewertung von:</div>
                              <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
                                <li><strong>45%</strong> Preis</li>
                                <li><strong>30%</strong> Reisezeit</li>
                                <li><strong>25%</strong> Anzahl Umstiege (Komfort)</li>
                                <li><strong>Direktverbindung</strong> wird bis zu 40% Aufpreis bevorzugt</li>
                              </ul>
                              <div className="text-xs mt-2 p-2 bg-amber-100 rounded font-medium">
                                {recommendation?.explanation.reason}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {isBestPrice && (
                        <Badge className="bg-green-100 text-green-800 border border-green-400 rounded-full flex items-center gap-1 px-2 py-1 font-semibold shadow-sm">
                          <Euro className="h-3 w-3" />
                          Bestpreis
                        </Badge>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    {/* Hauptzeile mit Zeit/Preis/Buchen */}
                    <div className="flex flex-row items-stretch justify-between gap-2">
                      {/* Links: Abfahrt/Ankunft */}
                      <div className="flex flex-col justify-center min-w-[70px] flex-1">
                        <div>
                          <span className="text-xs text-gray-500 font-semibold">Abfahrt</span><br />
                          <span className="font-medium text-sm">{new Date(interval.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="mt-1">
                          <span className="text-xs text-gray-500 font-semibold">Ankunft</span><br />
                          <span className="font-medium text-sm">{new Date(interval.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                      
                      {/* Mitte: Umstiege/Dauer */}
                      <div className="flex flex-col justify-center min-w-[70px] flex-1">
                        <div>
                          <span className="text-xs text-gray-500 font-semibold">Umstiege</span><br />
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-sm">{interval.umstiegsAnzahl || 0}</span>
                            {(interval.umstiegsAnzahl || 0) === 0 && (
                              <span className="text-xs text-green-600">(Direkt)</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-1">
                          <span className="text-xs text-gray-500 font-semibold">Reisedauer</span><br />
                          <span className="font-medium text-sm">{calculateDuration(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt)}</span>
                          {isFastest && (
                            <div className="mt-0.5">
                              <span title="Schnellste Verbindung" className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-semibold">
                                <TrendingUp className="h-3 w-3 mr-0.5" />
                                Schnellste
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Rechts: Preis/Buchen */}
                      <div className="flex flex-col items-end min-w-[90px] flex-shrink-0 justify-center ml-2">
                        <div>
                          <span className="text-xs text-gray-500 font-semibold">Preis</span><br />
                          <span className={`font-bold text-base px-2 py-1 rounded ${getIntervalPriceColor(interval.preis)}`}>{interval.preis}€</span>
                          {/* Historie-Button für einzelne Verbindung */}
                          {interval.priceHistory && interval.priceHistory.length > 1 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="ml-1 h-6 w-6">
                                  {getTrendIcon(interval.priceHistory)}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[520px]">
                                <PriceHistoryChart history={interval.priceHistory} title="Preisentwicklung dieser Verbindung" />
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                        <div className="mt-2">
                          {bookingLink && (
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 whitespace-nowrap"
                             
                              onClick={() => window.open(bookingLink, "_blank")}
                            >
                              <Train className="h-4 w-4" />
                              Buchen
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Separate row for vehicle types - compact, no border, wenig Abstand */}
                    <div className="flex justify-left mt-1 mb-1">
                      <VehicleTypesSummary interval={interval} />
                    </div>
                    
                    {/* Expand button for journey details */}
                    <div className="pt-2 border-t border-gray-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpanded(index)}
                        className="w-full flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800"
                      >
                        <Train className="h-3 w-3" />
                        {expandedItems.has(index) ? 'Fahrtverlauf ausblenden' : 'Fahrtverlauf anzeigen'}
                        <ArrowRight className={`h-3 w-3 transition-transform ${expandedItems.has(index) ? 'rotate-90' : ''}`} />
                      </Button>
                      
                      {/* Expandable journey timeline */}
                      {expandedItems.has(index) && (
                        <div className="mt-2 pt-2">
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <MobileJourneyTimeline interval={interval} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Desktop-Grid */}
                <div
                  className={`hidden md:block p-3 rounded relative text-sm ${leftBorder} ${cardBg}`}
                  style={isRecommended || isBestPrice ? { paddingTop: 40 } : {}}>
                  {(isRecommended || isBestPrice) && (
                    <div className="absolute top-2 left-2 z-10 flex gap-2">
                      {isRecommended && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Badge className="bg-amber-100 text-amber-800 border border-amber-400 rounded-full cursor-help flex items-center gap-1 px-2 py-1 font-semibold shadow-sm">
                              <Star className="h-3 w-3" />
                              Empfohlen
                            </Badge>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 text-sm">
                            <div className="font-semibold mb-2 text-amber-800">🧠 Intelligente Empfehlung</div>
                            <div className="space-y-2">
                              <div className="text-xs">Basiert auf einer gewichteten Bewertung von:</div>
                              <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
                                <li><strong>45%</strong> Preis</li>
                                <li><strong>30%</strong> Reisezeit</li>
                                <li><strong>25%</strong> Anzahl Umstiege (Komfort)</li>
                                <li><strong>Direktverbindung</strong> wird bis zu 40% Aufpreis bevorzugt</li>
                              </ul>
                              <div className="text-xs mt-2 p-2 bg-amber-100 rounded font-medium">
                                {recommendation?.explanation.reason}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {isBestPrice && (
                        <Badge className="bg-green-100 text-green-800 border border-green-400 rounded-full flex items-center gap-1 px-2 py-1 font-semibold shadow-sm">
                          <Euro className="h-3 w-3" />
                          Bestpreis
                        </Badge>
                      )}
                    </div>
                  )}
                  
                  {/* Top row with main info */}
                  <div className="grid grid-cols-6 gap-3 items-center mb-3">
                    <div>
                      <div className="text-gray-600 mb-1">Abfahrt</div>
                      <div className="font-medium">
                        {new Date(interval.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-xs text-gray-500">{interval.abfahrtsOrt}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Ankunft</div>
                      <div className="font-medium">
                        {new Date(interval.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-xs text-gray-500">{interval.ankunftsOrt}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Umstiege</div>
                      <div className="font-medium flex items-center gap-1">
                        <Shuffle className="h-4 w-4 text-gray-500" />
                        {interval.umstiegsAnzahl || 0}
                        {(interval.umstiegsAnzahl || 0) === 0 && (
                          <span className="text-xs text-green-600 ml-1">(Direkt)</span>
                        )}
                        {!showAllJourneyDetails && (interval.abschnitte && interval.abschnitte.length > 0) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(index)}
                            className="ml-1 h-6 w-6 p-0 flex items-center justify-center text-blue-600 hover:text-blue-800 transition-colors"
                            title={expandedItems.has(index) ? 'Fahrtverlauf ausblenden' : 'Fahrtverlauf anzeigen'}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <VehicleTypesSummary interval={interval} />
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Reisedauer</div>
                      <div className="font-medium">
                        {calculateDuration(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt)}
                      </div>
                      {isFastest && (
                        <div className="mt-0.5">
                          <span title="Schnellste Verbindung" className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-semibold">
                            <TrendingUp className="h-3 w-3 mr-0.5" />
                            Schnellste
                          </span>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Preis</div>
                      <div className="flex items-center">
                        <div className={`font-bold text-lg px-2 py-1 rounded ${getIntervalPriceColor(interval.preis)}`}>{interval.preis}€</div>
                        {/* Historie-Button für einzelne Verbindung */}
                        {interval.priceHistory && interval.priceHistory.length > 1 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="ml-1 h-6 w-6">
                                {getTrendIcon(interval.priceHistory)}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[520px]">
                              <PriceHistoryChart history={interval.priceHistory} title="Preisentwicklung dieser Verbindung" />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                    {bookingLink && (
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 whitespace-nowrap"
                        title="Buchen"
                        onClick={() => window.open(bookingLink, "_blank")}
                      >
                        <Train className="h-4 w-4" />
                        Buchen
                      </Button>
                    )}
                  </div>
                  
                  {/* Journey timeline spanning full width - controlled by global switch */}
                  {showAllJourneyDetails && (
                    <div className="pt-2 border-t border-gray-200">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <JourneyTimeline interval={interval} />
                      </div>
                    </div>
                  )}
                  
                  {/* Individual expandable journey timeline (fallback when global switch is off) */}
                  {!showAllJourneyDetails && expandedItems.has(index) && (
                    <div className="pt-2 border-t border-gray-200">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <JourneyTimeline interval={interval} />
                      </div>
                    </div>
                  )}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function getTrendIcon(history?: { preis: number }[]) {
  if (!history || history.length < 2) return <Minus className="h-3 w-3 text-gray-400" />
  const firstPrice = history[0].preis
  const lastPrice = history[history.length - 1].preis
  if (lastPrice > firstPrice) return <TrendingUp className="h-3 w-3 text-red-500" />
  if (lastPrice < firstPrice) return <TrendingDown className="h-3 w-3 text-green-500" />
  return <Minus className="h-3 w-3 text-gray-400" />
}