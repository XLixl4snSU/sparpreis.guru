import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Train, Shuffle, TrendingUp, ArrowRight, Euro, Info, Star, Clock, Minus, TrendingDown, ChevronDown, ChevronUp } from "lucide-react"
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
  const [expandedItems, setExpandedItems] = useState<Set<number|string>>(new Set())
  const [showAllJourneyDetailsLocal, setShowAllJourneyDetailsLocal] = useState<boolean>(false)

  const toggleExpanded = (key: number|string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(key)) {
        newSet.delete(key)
      } else {
        newSet.add(key)
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
  // Set showOnlyCheapest default to false if undefined
  // React.useEffect(() => {
  //   if (typeof showOnlyCheapest === "undefined") {
  //     setShowOnlyCheapest(false)
  //   }
  // }, [showOnlyCheapest, setShowOnlyCheapest])

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
        {/* Sortierbare Tabellen-Header - Desktop Only */}
        {hasMultipleIntervals && (
          <div className="mb-2 hidden md:block">
            <div className="grid grid-cols-[1.5fr_1.5fr_3fr_2fr_2fr_2fr] gap-6 text-xs font-semibold select-none sticky top-0 bg-blue-50 z-10 border-b border-blue-200 pb-2 px-5 text-gray-600">
              <div className="cursor-pointer hover:text-blue-700 flex items-center gap-1" onClick={() => handleSort('abfahrt')}>
                Abfahrt
                {sortKey === 'abfahrt' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
              </div>
              <div className="cursor-pointer hover:text-blue-700 flex items-center gap-1" onClick={() => handleSort('ankunft')}>
                Ankunft
                {sortKey === 'ankunft' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
              </div>
              <div className="cursor-pointer hover:text-blue-700 flex items-center gap-1" onClick={() => handleSort('dauer')}>
                Dauer
                {sortKey === 'dauer' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
              </div>
              <div className="cursor-pointer hover:text-blue-700 flex items-center gap-1" onClick={() => handleSort('umstiege')}>
                Umstiege
                {sortKey === 'umstiege' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
              </div>
              <div className="cursor-pointer hover:text-blue-700 flex items-center gap-1" onClick={() => handleSort('preis')}>
                Preis
                {sortKey === 'preis' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
              </div>
              <div className="text-right">Buchung</div>
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
                <div className={`md:hidden rounded-lg shadow-md p-4 mb-3 relative ${cardBg} ${leftBorder}`}
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
                  
                  {/* Hauptzeile: Zeit und Preis */}
                  <div className="flex items-center justify-between mb-3">
                    {/* Abfahrt - Pfeil - Ankunft */}
                    <div className="flex items-center gap-2">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {new Date(interval.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">Abfahrt</div>
                      </div>
                      
                      <ArrowRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {new Date(interval.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">Ankunft</div>
                      </div>
                    </div>
                    
                    {/* Preis */}
                    <div className="text-right">
                      <div className={`text-2xl font-bold px-3 py-2 rounded-lg ${getIntervalPriceColor(interval.preis)}`}>
                        {interval.preis}€
                      </div>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="py-3 border-t border-b border-gray-200 space-y-2">
                    {/* Erste Zeile: Dauer und Umstiege nebeneinander */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Dauer</div>
                        <div className="font-semibold text-sm text-gray-900">
                          {calculateDuration(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt)}
                        </div>
                        {isFastest && (
                          <div className="mt-1">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[9px] font-semibold">
                              <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
                              Schnellste
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Umstiege</div>
                        <div className="font-semibold text-sm text-gray-900">
                          {interval.umstiegsAnzahl || 0}
                          {(interval.umstiegsAnzahl || 0) === 0 && (
                            <span className="text-[10px] text-green-600 font-medium ml-1">(Direkt)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Zweite Zeile: Fahrzeugtypen über die gesamte Breite */}
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Züge</div>
                      <div className="flex flex-wrap gap-1">
                        <VehicleTypesSummary interval={interval} />
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-3 space-y-2">
                    {bookingLink && (
                      <Button
                        size="lg"
                        variant="default"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11"
                        onClick={() => window.open(bookingLink, "_blank")}
                      >
                        <Train className="h-5 w-5 mr-2" />
                        Jetzt buchen
                      </Button>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2">
                      {/* Preisverlauf als Toggle-Button, exklusiv */}
                      <Button
                        variant={interval.priceHistory && interval.priceHistory.length > 1 && expandedItems.has(`preisverlauf-${index}`) ? "default" : "outline"}
                        size="sm"
                        className="w-full h-9 text-xs"
                        onClick={() => {
                          if (interval.priceHistory && interval.priceHistory.length > 1) {
                            toggleExpanded(`preisverlauf-${index}`)
                            if (expandedItems.has(index)) toggleExpanded(index)
                          }
                        }}
                        disabled={!interval.priceHistory || interval.priceHistory.length <= 1}
                        title={
                          !interval.priceHistory || interval.priceHistory.length <= 1
                            ? "Keine Preisentwicklung verfügbar"
                            : "Preisentwicklung anzeigen"
                        }
                      >
                        {getTrendIcon(interval.priceHistory)}
                        Preisentwicklung
                      </Button>
                      
                      <Button
                        variant={expandedItems.has(index) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          toggleExpanded(index)
                          if (expandedItems.has(`preisverlauf-${index}`)) toggleExpanded(`preisverlauf-${index}`)
                        }}
                        className={`h-9 text-xs ${!interval.priceHistory || interval.priceHistory.length <= 1 ? 'col-span-2' : ''}`}
                      >
                        <Train className="h-3.5 w-3.5 mr-1.5" />
                        {expandedItems.has(index) ? 'Weniger' : 'Fahrtverlauf'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Exklusiv: Preisverlauf */}
                  {interval.priceHistory && interval.priceHistory.length > 1 && expandedItems.has(`preisverlauf-${index}`) && (
                    <div className="mt-5 pt-5 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-200">
                       {/* Keine doppelte Box mehr, Chart direkt rendern */}
                       <PriceHistoryChart history={interval.priceHistory} title="Preisentwicklung" />
                    </div>
                  )}

                  {/* Exklusiv: Fahrtverlauf */}
                  {expandedItems.has(index) && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <MobileJourneyTimeline interval={interval} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop View - Redesigned */}
                <div
                  className={`hidden md:block p-6 rounded-2xl relative text-sm shadow-sm transition-all hover:shadow-md border bg-white ${leftBorder} ${cardBg}`}
                  style={isRecommended || isBestPrice ? { paddingTop: 48 } : {}}
                >
                  {/* Badges (Recommended / Best Price) */}
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

                  <div className="grid grid-cols-[1.5fr_1.5fr_3fr_2fr_2fr_2fr] gap-6 items-center min-h-[88px]">
                    
                    {/* Abfahrt */}
                    <div className="relative">
                      <div className="font-bold text-lg text-gray-900">
                        {new Date(interval.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-xs text-gray-500 truncate" title={interval.abfahrtsOrt}>
                        {interval.abfahrtsOrt}
                      </div>
                      <ArrowRight className="absolute -right-5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300" />
                    </div>

                    {/* Ankunft */}
                    <div>
                      <div className="font-bold text-lg text-gray-900">
                        {new Date(interval.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-xs text-gray-500 truncate" title={interval.ankunftsOrt}>
                        {interval.ankunftsOrt}
                      </div>
                    </div>

                    {/* Dauer & Fahrzeuge */}
                    <div>
                      <div className="flex items-center gap-2 font-medium text-gray-900">
                        {calculateDuration(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt)}
                        {isFastest && (
                          <span className="inline-flex items-center px-1 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-semibold ml-1">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            Schnell
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <VehicleTypesSummary interval={interval} />
                      </div>
                    </div>

                    {/* Umstiege & Fahrtverlauf */}
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-1">
                         <Shuffle className="h-3.5 w-3.5 text-gray-400" />
                         {interval.umstiegsAnzahl === 0 ? "Direkt" : interval.umstiegsAnzahl}
                      </div>
                      
                      {/* Details Toggle */}
                      {!showAllJourneyDetails && (
                        <button
                          onClick={() => toggleExpanded(index)}
                          className={`text-xs font-medium flex items-center gap-1 mt-1.5 transition-colors ${expandedItems.has(index) ? 'text-blue-700' : 'text-gray-500 hover:text-blue-600'}`}
                        >
                          <Info className="h-3 w-3" />
                          Fahrtverlauf
                          {expandedItems.has(index) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      )}
                    </div>

                    {/* Preis & History */}
                    <div>
                      <div className={`font-bold text-xl px-2 py-1 rounded inline-block ${getIntervalPriceColor(interval.preis)}`}>
                        {interval.preis}€
                      </div>
                      {/* Price History Toggle */}
                      {interval.priceHistory && interval.priceHistory.length > 1 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(`preisverlauf-${index}`);
                          }}
                          className={`text-xs font-medium flex items-center gap-1 mt-1 transition-colors ${expandedItems.has(`preisverlauf-${index}`) ? 'text-blue-700' : 'text-gray-500 hover:text-blue-600'}`}
                        >
                          {getTrendIcon(interval.priceHistory)}
                          Preisentwicklung
                          {expandedItems.has(`preisverlauf-${index}`) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      ) : (
                         <div className="text-xs text-gray-300 flex items-center gap-1 mt-1 cursor-not-allowed" title="Keine Daten verfügbar">
                            <Minus className="h-3 w-3" />
                            Preisentwicklung
                         </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end">
                       {bookingLink && (
                        <Button
                          size="default"
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm w-full flex items-center justify-center gap-2"
                          onClick={() => window.open(bookingLink, "_blank")}
                        >
                          <Train className="h-4 w-4" />
                          Buchen
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {/* Expanded Content: Price History */}
                  {interval.priceHistory && interval.priceHistory.length > 1 && expandedItems.has(`preisverlauf-${index}`) && (
                    <div className="mt-5 pt-5 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-200">
                       {/* Keine doppelte Box mehr, Chart direkt rendern */}
                       <PriceHistoryChart history={interval.priceHistory} title="Preisentwicklung dieser Verbindung" />
                    </div>
                  )}

                  {/* Expanded Content: Journey Details */}
                  {(showAllJourneyDetails || expandedItems.has(index)) && (
                    <div className="mt-5 pt-5 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
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