"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  MapPin,
  TrendingDown,
  Loader2,
  Train,
  ChevronDown,
  ChevronUp,
  Trophy,
  ArrowRight,
  RotateCcw,
} from "lucide-react"
import { createBookingLink } from "@/lib/train-search/day-details-utils"
import {
  JourneyTimelineHorizontal,
  JourneyTimelineVertical,
  type JourneyLeg,
} from "@/components/bestpreissuche/journey-timeline"

const DynamicLeaflet = dynamic(
  () =>
    import("@/components/urlaubsfinder/urlaubsfinder-leaflet-map").then((mod) => ({
      default: mod.UrlauberfinderLeafletMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full flex items-center justify-center text-gray-400 text-sm bg-gray-50"
        style={{ height: 420 }}
      >
        Karte wird geladen...
      </div>
    ),
  }
)

function formatTime(iso: string): string {
  if (!iso) return "–"
  try {
    return new Date(iso).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    })
  } catch {
    return "–"
  }
}

function formatDate(iso: string): string {
  if (!iso) return "–"
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Berlin",
    })
  } catch {
    return "–"
  }
}

function formatDuration(dep: string, arr: string): string {
  if (!dep || !arr) return ""
  try {
    const mins = Math.round(
      (new Date(arr).getTime() - new Date(dep).getTime()) / 60000
    )
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  } catch {
    return ""
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

interface SearchParams {
  klasse: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  maximaleUmstiege?: string
}

interface UrlauberfinderResultsProps {
  results: DestinationResult[]
  unavailableResults?: UnavailableDestination[]
  isLoading: boolean
  homeStation: string
  homeCoords?: { lat: number; lon: number }
  progress?: { processed: number; total: number; destination: string } | null
  searchParams?: SearchParams | null
  onCancel?: () => void
}

function JourneyBlock({
  direction,
  departure,
  arrival,
  price,
  transfers,
  bookingHref,
  legs,
}: {
  direction: "out" | "return"
  departure: string
  arrival: string
  price: number
  transfers?: number
  bookingHref: string
  legs?: JourneyLeg[]
}) {
  const isOut = direction === "out"
  const accent = isOut ? "text-blue-600" : "text-orange-500"
  const borderCls = isOut ? "border-blue-200" : "border-orange-200"
  const bgCls = isOut ? "bg-blue-50/70" : "bg-orange-50/70"

  return (
    <div className={`min-w-0 rounded-lg border ${borderCls} ${bgCls} p-4 md:p-5`}>
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className={`${accent} border-current bg-white/70 rounded-full px-2 py-0.5`}>
          {isOut ? "Hinfahrt" : "Rückfahrt"}
        </Badge>
        <span className={`text-lg font-bold px-2 py-1 rounded bg-white/70 ${accent}`}>
          {price.toFixed(2)} €
        </span>
      </div>
      <div className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-2.5">
        <span className="tabular-nums">{formatTime(departure)}</span>
        <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="tabular-nums">{formatTime(arrival)}</span>
        {departure && arrival && (
          <span className="text-xs text-gray-500 font-medium ml-0.5">
            ({formatDuration(departure, arrival)})
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {transfers === 0
            ? "✓ Direktverbindung"
            : transfers !== undefined && transfers > 0
            ? `${transfers} Umstieg${transfers > 1 ? "e" : ""}`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm">
            <a
              href={bookingHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Train className="w-3.5 h-3.5" />
              Buchen
            </a>
          </Button>
        </div>
      </div>
      {legs && legs.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/80">
          <div className="hidden min-w-0 overflow-x-auto md:block rounded-lg border border-gray-200 bg-white p-4 pb-5">
            <JourneyTimelineHorizontal legs={legs} />
          </div>
          <div className="md:hidden rounded-lg border border-gray-200 bg-white p-3">
            <JourneyTimelineVertical legs={legs} />
          </div>
        </div>
      )}
    </div>
  )
}

function ResultCard({
  result,
  rank,
  minPrice,
  maxPrice,
  averagePrice,
  searchParams,
  homeStation,
  onMapFocus,
  isExpanded,
  onToggle,
}: {
  result: DestinationResult
  rank: number
  minPrice: number
  maxPrice: number
  averagePrice: number
  searchParams: SearchParams | null | undefined
  homeStation: string
  onMapFocus: (r: DestinationResult) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const priceRange = maxPrice - minPrice
  const deltaVsAverage =
    averagePrice > 0
      ? Math.round(((averagePrice - result.totalPrice) / averagePrice) * 100)
      : 0
  const isBest = rank === 1
  const tier = priceRange > 0 ? (result.totalPrice - minPrice) / priceRange : 0
  const cardBg = isBest ? "bg-green-50" : tier < 0.33 ? "bg-white" : tier < 0.66 ? "bg-amber-50" : "bg-red-50"
  const leftBorder = isBest
    ? "border-l-8 border-l-green-500"
    : tier < 0.33
    ? "border-l-8 border-l-gray-200"
    : tier < 0.66
    ? "border-l-8 border-l-amber-400"
    : "border-l-8 border-l-red-400"
  const priceTone =
    tier < 0.33 ? "text-green-600 bg-green-50" : tier < 0.66 ? "text-orange-600 bg-orange-50" : "text-red-600 bg-red-50"
  const outwardTransferLabel =
    result.outwardTransfers === 0
      ? "Direkt"
      : result.outwardTransfers !== undefined
      ? `${result.outwardTransfers} Umstieg${result.outwardTransfers > 1 ? "e" : ""}`
      : "–"
  const returnTransferLabel =
    result.returnTransfers === 0
      ? "Direkt"
      : result.returnTransfers !== undefined
      ? `${result.returnTransfers} Umstieg${result.returnTransfers > 1 ? "e" : ""}`
      : "–"

  const outBooking = searchParams
    ? createBookingLink(
        result.outwardDeparture,
        result.homeStationName || homeStation,
        result.destination,
        result.homeStationId,
        result.destinationId,
        searchParams.klasse,
        searchParams.maximaleUmstiege ?? "",
        searchParams.alter,
        searchParams.ermaessigungArt,
        searchParams.ermaessigungKlasse
      )
    : "#"

  const retBooking =
    searchParams && result.returnDeparture
      ? createBookingLink(
          result.returnDeparture,
          result.destination,
          result.homeStationName || homeStation,
          result.destinationId,
          result.homeStationId,
          searchParams.klasse,
          searchParams.maximaleUmstiege ?? "",
          searchParams.alter,
          searchParams.ermaessigungArt,
          searchParams.ermaessigungKlasse
        )
      : "#"

  function handleToggle() {
    onToggle()
    onMapFocus(result)
  }

  return (
    <>
      <div
        id={`result-card-${encodeURIComponent(result.destination)}`}
        className={`rounded-2xl relative text-sm shadow-sm transition-all hover:shadow-md border bg-white ${leftBorder} ${cardBg} ${
          isExpanded ? "ring-2 ring-blue-200" : ""
        }`}
      >
        <div className="md:hidden p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <Badge className={isBest ? "bg-green-100 text-green-800 border border-green-400 rounded-full" : "bg-gray-100 text-gray-700 border border-gray-200 rounded-full"}>
                {isBest ? <Trophy className="w-3 h-3 mr-1" /> : null}
                #{rank}
              </Badge>
              <div className="min-w-0">
                <div className="font-bold text-gray-900 text-base truncate">{result.destination.replace(" Hbf", "")}</div>
                <div className="text-xs text-gray-500 truncate">{formatDate(result.outwardDeparture)}</div>
              </div>
            </div>
            <div className={`text-2xl font-bold px-3 py-2 rounded-lg ${priceTone}`}>
              {result.totalPrice.toFixed(0)}€
            </div>
          </div>

          <div className="py-3 border-t border-b border-gray-200 space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Hinfahrt</div>
                <div className="font-semibold text-sm text-gray-900">
                  {formatTime(result.outwardDeparture)} <ArrowRight className="inline h-3 w-3 mx-1 text-gray-400" /> {formatTime(result.outwardArrival)}
                </div>
                <div className="text-xs text-gray-500 mt-1">{formatDuration(result.outwardDeparture, result.outwardArrival)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Rückfahrt</div>
                <div className="font-semibold text-sm text-gray-900">
                  {result.returnDeparture ? (
                    <>
                      {formatTime(result.returnDeparture)} <ArrowRight className="inline h-3 w-3 mx-1 text-gray-400" /> {formatTime(result.returnArrival ?? "")}
                    </>
                  ) : "–"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {result.returnDeparture ? formatDuration(result.returnDeparture, result.returnArrival ?? "") : ""}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-blue-700 border-blue-200 bg-white/70">Hin: {outwardTransferLabel}</Badge>
              {result.returnDate && <Badge variant="outline" className="text-orange-700 border-orange-200 bg-white/70">Rück: {returnTransferLabel}</Badge>}
              {isBest && <Badge className="bg-green-100 text-green-800 border border-green-400 rounded-full">Bestpreis</Badge>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant={isExpanded ? "default" : "outline"} size="sm" onClick={handleToggle} className="h-9 text-xs">
              <Train className="h-3.5 w-3.5 mr-1.5" />
              {isExpanded ? "Weniger" : "Details"}
            </Button>
            <Button asChild size="sm" className="h-9 bg-blue-600 hover:bg-blue-700 text-white text-xs">
              <a href={outBooking} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                Buchen
              </a>
            </Button>
          </div>
        </div>

        <div className="hidden md:grid grid-cols-[minmax(190px,2.4fr)_minmax(150px,1.6fr)_minmax(150px,1.6fr)_minmax(105px,1fr)_minmax(95px,0.9fr)_minmax(115px,0.9fr)] gap-4 lg:gap-6 items-center min-h-[96px] p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-bold text-lg text-gray-900 leading-snug break-words">{result.destination.replace(" Hbf", "")}</div>
              {isBest && (
                <Badge className="bg-green-100 text-green-800 border border-green-400 rounded-full flex items-center gap-1 px-2 py-1 font-semibold shadow-sm">
                  <Trophy className="h-3 w-3" />
                  Bestpreis
                </Badge>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1 leading-snug">
              {formatDate(result.outwardDeparture)}
              {result.returnDate ? ` · Rück ${formatDate(result.returnDeparture || result.returnDate)}` : ""}
            </div>
          </div>

          <div>
            <div className="font-bold text-lg text-gray-900">
              {formatTime(result.outwardDeparture)}
              <ArrowRight className="inline h-4 w-4 mx-2 text-gray-300" />
              {formatTime(result.outwardArrival)}
            </div>
            <div className="text-xs text-gray-500 mt-1">{formatDuration(result.outwardDeparture, result.outwardArrival)} · {result.outwardPrice.toFixed(0)}€</div>
          </div>

          <div>
            <div className="font-bold text-lg text-gray-900">
              {result.returnDeparture ? (
                <>
                  {formatTime(result.returnDeparture)}
                  <ArrowRight className="inline h-4 w-4 mx-2 text-gray-300" />
                  {formatTime(result.returnArrival ?? "")}
                </>
              ) : "–"}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {result.returnDeparture ? `${formatDuration(result.returnDeparture, result.returnArrival ?? "")} · ${(result.returnPrice ?? 0).toFixed(0)}€` : "Keine Rückfahrt"}
            </div>
          </div>

          <div>
            <div className="font-medium text-gray-900 flex items-center gap-1">
              <RotateCcw className="h-3.5 w-3.5 text-gray-400" />
              {outwardTransferLabel}
            </div>
            {result.returnDate && (
              <div className="text-xs text-gray-500 mt-1">Rück: {returnTransferLabel}</div>
            )}
          </div>

          <div>
            <div className={`font-bold text-xl px-2 py-1 rounded inline-block ${priceTone}`}>
              {result.totalPrice.toFixed(0)}€
            </div>
            {deltaVsAverage !== 0 && (
              <div className={`text-xs font-medium mt-1 ${deltaVsAverage > 0 ? "text-green-600" : "text-red-600"}`}>
                {deltaVsAverage > 0 ? `-${deltaVsAverage}% ggü. Ø` : `+${Math.abs(deltaVsAverage)}% ggü. Ø`}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              size="default"
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm w-full"
              onClick={handleToggle}
            >
              <Train className="h-4 w-4" />
              {isExpanded ? "Schließen" : "Details"}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-100 px-4 md:px-6 pb-4 md:pb-6 pt-4 md:pt-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="grid gap-3">
              <JourneyBlock
                direction="out"
                departure={result.outwardDeparture}
                arrival={result.outwardArrival}
                price={result.outwardPrice}
                transfers={result.outwardTransfers}
                bookingHref={outBooking}
                legs={result.outwardLegs}
              />
              {result.returnDate && result.returnPrice && result.returnPrice > 0 && (
              <JourneyBlock
                direction="return"
                departure={result.returnDeparture ?? ""}
                arrival={result.returnArrival ?? ""}
                price={result.returnPrice}
                transfers={result.returnTransfers}
                bookingHref={retBooking}
                legs={result.returnLegs}
              />
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <span className="text-sm font-semibold text-gray-600">Gesamtpreis</span>
              <span className="text-xl font-black text-gray-900 tabular-nums">
                {result.totalPrice.toFixed(2)} €
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export function UrlauberfinderResults({
  results,
  unavailableResults = [],
  isLoading,
  homeStation,
  homeCoords,
  progress,
  searchParams,
  onCancel,
}: UrlauberfinderResultsProps) {
  const [mapSelected, setMapSelected] = useState<DestinationResult | null>(null)
  const [expandedDestination, setExpandedDestination] = useState<string | null>(null)

  const minPrice =
    results.length > 0 ? Math.min(...results.map((r) => r.totalPrice)) : 0
  const maxPrice =
    results.length > 0 ? Math.max(...results.map((r) => r.totalPrice)) : 0
  const averagePrice =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.totalPrice, 0) / results.length
      : 0
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0
  const hasResults = results.length > 0
  const hasUnavailable = unavailableResults.length > 0
  const hasMapData = results.some((r) => r.lat && r.lon)

  useEffect(() => {
    if (!mapSelected) return
    const cardId = `result-card-${encodeURIComponent(mapSelected.destination)}`
    const card = document.getElementById(cardId)
    if (!card) return

    setExpandedDestination(mapSelected.destination)
    card.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [mapSelected])

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
              <p className="text-sm font-semibold text-gray-700 truncate">
                {progress ? (
                  <>
                    Suche{" "}
                    <span className="text-blue-600">
                      {progress.destination.replace(" Hbf", "")}
                    </span>
                    {"  "}
                    <span className="text-gray-400 font-normal text-xs">
                      ({progress.processed}/{progress.total})
                    </span>
                  </>
                ) : (
                  "Starte Suche..."
                )}
              </p>
            </div>
            {onCancel && (
              <button
                onClick={onCancel}
                className="ml-3 flex-shrink-0 text-xs text-red-500 hover:text-red-700 font-semibold underline underline-offset-2 transition-colors"
              >
                Abbrechen
              </button>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent || (isLoading ? 2 : 0)}%` }}
            />
          </div>
          {hasResults && (
            <p className="text-[11px] text-gray-400 mt-1.5">
              {results.length} Ziel{results.length !== 1 ? "e" : ""} gefunden
              {" "}· wird aktualisiert...
            </p>
          )}
        </div>
      )}

      {!isLoading && !hasResults && !hasUnavailable && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <AlertCircle className="w-9 h-9 text-amber-400 mx-auto mb-3" />
          <p className="font-semibold text-gray-800 mb-1">Keine Ergebnisse</p>
          <p className="text-sm text-gray-500">
            Für die gewählten Kriterien wurden keine Verbindungen gefunden.
            Versuche andere Daten oder Ziele.
          </p>
        </div>
      )}

      {hasResults && (
        <>
          {hasMapData && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-blue-800 text-sm">Karte</span>
                <span className="ml-auto text-xs text-blue-700">
                  {results.length} Ziele
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
                <DynamicLeaflet
                  destinations={results}
                  homeStation={homeStation}
                  homeCoords={homeCoords}
                  selectedResult={mapSelected}
                  onSelectResult={(result: DestinationResult) => setMapSelected({ ...result })}
                />
              </div>
            </div>
          )}

          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-2 md:gap-0">
              <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                Günstigste Ziele
                <span className="text-blue-700">({results.length})</span>
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-xs text-blue-700">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  Bestpreis
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Mittel
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                  Teuer
                </span>
              </div>
            </div>

            <div className="mb-2 hidden md:block">
              <div className="grid grid-cols-[minmax(190px,2.4fr)_minmax(150px,1.6fr)_minmax(150px,1.6fr)_minmax(105px,1fr)_minmax(95px,0.9fr)_minmax(115px,0.9fr)] gap-4 lg:gap-6 text-xs font-semibold select-none sticky top-0 bg-blue-50 z-10 border-b border-blue-200 pb-2 px-5 text-gray-600">
                <div>Ziel</div>
                <div>Hinfahrt</div>
                <div>Rückfahrt</div>
                <div>Umstiege</div>
                <div>Preis</div>
                <div className="text-right">Details</div>
              </div>
            </div>

            <div className="space-y-3">
              {results.map((result, index) => (
                <ResultCard
                  key={result.destination}
                  result={result}
                  rank={index + 1}
                  minPrice={minPrice}
                  maxPrice={maxPrice}
                  averagePrice={averagePrice}
                  searchParams={searchParams}
                  homeStation={homeStation}
                  onMapFocus={setMapSelected}
                  isExpanded={expandedDestination === result.destination}
                  onToggle={() =>
                    setExpandedDestination((prev) =>
                      prev === result.destination ? null : result.destination
                    )
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}

      {hasUnavailable && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-100 flex items-center gap-2 bg-amber-50">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-sm text-amber-900">
              Nicht verfügbare Ziele
            </span>
            <span className="ml-auto text-xs text-amber-700">
              {unavailableResults.length}
            </span>
          </div>
          <div className="p-3 space-y-2">
            {unavailableResults.map((item) => (
              <div
                key={item.destination}
                className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">
                      {item.destination.replace(" Hbf", "")}
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">{item.reason}</p>
                  </div>
                  <div className="text-right text-[11px] text-amber-900">
                    {item.outwardPrice !== undefined && (
                      <p>Hin: {item.outwardPrice.toFixed(2)} €</p>
                    )}
                    {item.returnPrice !== undefined && (
                      <p>Rück: {item.returnPrice.toFixed(2)} €</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
