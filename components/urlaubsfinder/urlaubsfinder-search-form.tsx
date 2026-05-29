"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { FAQPopup } from "@/components/layout/faq-popup"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertTriangle, MapPin, Calendar, Settings, User, Train, Percent, Baby, Clock, X } from "lucide-react"
import { ICE_STATIONS, getDefaultStations } from "@/lib/stations/ice-stations"
import { logError } from "@/lib/shared/logger"

const LOG_SCOPE = "urlaubsfinder.search-form"

interface UrlauberfinderSearchFormProps {
  onSearch: (params: UrlauberfinderSearchParams) => void
  isSearching: boolean
  initialParams?: Partial<UrlauberfinderSearchParams>
}

export interface UrlauberfinderSearchParams {
  homeStation: string
  homeStationLabel?: string
  homeStationExtId?: string
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

interface StationSuggestion {
  extId: string
  id: string
  name: string
}

const ctrl =
  "h-11 w-full min-w-0 max-w-full box-border px-3 text-base leading-tight rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
const dateTimeCtrl =
  `${ctrl} px-2 text-[16px] appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:p-0`

const CURATED_SMALL_CITIES_PRESET = [
  "Heidelberg Hbf",
  "Freiburg Hbf",
  "Lübeck Hbf",
  "Bamberg",
  "Passau Hbf",
  "Konstanz",
  "Stralsund Hbf",
  "Rostock Hbf",
  "Trier Hbf",
  "Erfurt Hbf",
  "Potsdam Hbf",
]

interface TimeWindowControlsProps {
  departureFromId: string
  departureFrom: string
  onDepartureFromChange: (value: string) => void
  departureToId: string
  departureTo: string
  onDepartureToChange: (value: string) => void
  arrivalFromId: string
  arrivalFrom: string
  onArrivalFromChange: (value: string) => void
  arrivalToId: string
  arrivalTo: string
  onArrivalToChange: (value: string) => void
}

function TimeInput({
  id,
  label,
  value,
  onChange,
  ariaLabel,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-600">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="time"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={dateTimeCtrl}
          aria-label={ariaLabel}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            aria-label={`${ariaLabel} zurücksetzen`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function TimeWindowControls({
  departureFromId,
  departureFrom,
  onDepartureFromChange,
  departureToId,
  departureTo,
  onDepartureToChange,
  arrivalFromId,
  arrivalFrom,
  onArrivalFromChange,
  arrivalToId,
  arrivalTo,
  onArrivalToChange,
}: TimeWindowControlsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-sm font-medium text-gray-600 mb-2 block">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-4 h-4 text-blue-500" />
              Abfahrt
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <TimeInput
              id={departureFromId}
              label="frühestens"
              value={departureFrom}
              onChange={onDepartureFromChange}
              ariaLabel="Abfahrt frühestens"
            />
            <span className="mt-6 text-sm font-medium text-gray-500">-</span>
            <TimeInput
              id={departureToId}
              label="spätestens"
              value={departureTo}
              onChange={onDepartureToChange}
              ariaLabel="Abfahrt spätestens"
            />
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-sm font-medium text-gray-600 mb-2 block">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-4 h-4 text-blue-500" />
              Ankunft
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <TimeInput
              id={arrivalFromId}
              label="frühestens"
              value={arrivalFrom}
              onChange={onArrivalFromChange}
              ariaLabel="Ankunft frühestens"
            />
            <span className="mt-6 text-sm font-medium text-gray-500">-</span>
            <TimeInput
              id={arrivalToId}
              label="spätestens"
              value={arrivalTo}
              onChange={onArrivalToChange}
              ariaLabel="Ankunft spätestens"
            />
          </div>
      </div>
    </div>
  )
}

function normalizeDiscount(art: string, klasse: string): { art: string; klasse: string } {
  const normalizedArt =
    art === "BAHNCARD_25" ? "BAHNCARD25" :
    art === "BAHNCARD_50" ? "BAHNCARD50" :
    art

  // Legacy fallback: if old value had no class, default to 2. Klasse like train-search-form
  if ((normalizedArt === "BAHNCARD25" || normalizedArt === "BAHNCARD50") && klasse === "KLASSENLOS") {
    return { art: normalizedArt, klasse: "KLASSE_2" }
  }

  return { art: normalizedArt, klasse }
}

export function UrlauberfinderSearchForm({
  onSearch,
  isSearching,
  initialParams,
}: UrlauberfinderSearchFormProps) {
  const hasInitialParams = !!initialParams && Object.keys(initialParams).length > 0
  const initialDestinationNames = (initialParams?.destinations ?? []).filter(destination =>
    ICE_STATIONS.some(station => station.name === destination)
  )

  const normalizedInitialDiscount = normalizeDiscount(
    initialParams?.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    initialParams?.ermaessigungKlasse || "KLASSENLOS"
  )

  const initialOutwardDate = (() => {
    if (initialParams?.outwardDate) {
      return initialParams.outwardDate
    }
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split("T")[0]
  })()

  const initialReturnDate = (() => {
    if (initialParams?.returnDate) {
      return initialParams.returnDate
    }
    const dateIn3Days = new Date()
    dateIn3Days.setDate(dateIn3Days.getDate() + 3)
    return dateIn3Days.toISOString().split("T")[0]
  })()

  const initialUmstiegsOption = (() => {
    if (!initialParams?.maximaleUmstiege) {
      return "alle"
    }
    return initialParams.maximaleUmstiege === "0" ? "direkt" : initialParams.maximaleUmstiege
  })()

  // Home station
  const [homeStation, setHomeStation] = useState(initialParams?.homeStationLabel || initialParams?.homeStation || "")
  const [homeStationId, setHomeStationId] = useState(initialParams?.homeStationExtId || "")
  const [homeSuggestions, setHomeSuggestions] = useState<StationSuggestion[]>([])
  const [showHomeSuggestions, setShowHomeSuggestions] = useState(false)
  const [loadingHome, setLoadingHome] = useState(false)
  const [homeError, setHomeError] = useState<string | null>(null)

  // Destinations
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>(
    () => initialDestinationNames.length > 0 ? initialDestinationNames : getDefaultStations().map(s => s.name)
  )

  // Dates
  const [outwardDate, setOutwardDate] = useState(initialOutwardDate)

  const [returnDate, setReturnDate] = useState(initialReturnDate)

  const [includeReturnDate, setIncludeReturnDate] = useState(
    hasInitialParams ? !!initialParams?.returnDate : true
  )

  // Filters
  const [alter, setAlter] = useState(initialParams?.alter || "ERWACHSENER")
  const initialDiscount = normalizeDiscount("KEINE_ERMAESSIGUNG", "KLASSENLOS")
  const [ermaessigungArt, setErmaessigungArt] = useState(normalizedInitialDiscount.art || initialDiscount.art)
  const [ermaessigungKlasse, setErmaessigungKlasse] = useState(normalizedInitialDiscount.klasse || initialDiscount.klasse)
  const [klasse, setKlasse] = useState(initialParams?.klasse || "KLASSE_2")
  const [schnelleVerbindungen, setSchnelleVerbindungen] = useState(initialParams?.schnelleVerbindungen ?? true)
  const [umstiegsOption, setUmstiegsOption] = useState<string>(initialUmstiegsOption)
  
  // Separate time filters for outward and return journeys
  const [outwardAbfahrtAb, setOutwardAbfahrtAb] = useState(initialParams?.outwardAbfahrtAb || "")
  const [outwardAbfahrtBis, setOutwardAbfahrtBis] = useState(initialParams?.outwardAbfahrtBis || "")
  const [outwardAnkunftAb, setOutwardAnkunftAb] = useState(initialParams?.outwardAnkunftAb || "")
  const [outwardAnkunftBis, setOutwardAnkunftBis] = useState(initialParams?.outwardAnkunftBis || "")
  const [returnAbfahrtAb, setReturnAbfahrtAb] = useState(initialParams?.returnAbfahrtAb || "")
  const [returnAbfahrtBis, setReturnAbfahrtBis] = useState(initialParams?.returnAbfahrtBis || "")
  const [returnAnkunftAb, setReturnAnkunftAb] = useState(initialParams?.returnAnkunftAb || "")
  const [returnAnkunftBis, setReturnAnkunftBis] = useState(initialParams?.returnAnkunftBis || "")
  
  const [umstiegszeit, setUmstiegszeit] = useState(initialParams?.umstiegszeit || "normal")
  const [showLargeRequestDialog, setShowLargeRequestDialog] = useState(false)
  const [pendingSearchParams, setPendingSearchParams] = useState<UrlauberfinderSearchParams | null>(null)

  const togglePreset = useCallback((presetNames: string[]) => {
    setSelectedDestinations(prev => {
      const allSelected = presetNames.every(name => prev.includes(name))
      if (allSelected) {
        return prev.filter(name => !presetNames.includes(name))
      }
      return [...new Set([...prev, ...presetNames])]
    })
  }, [])

  const germanRegionsSorted = Array.from(
    new Set(
      ICE_STATIONS
        .filter((s) => s.region !== "Europa" && !s.isDefault)
        .map((s) => s.region)
    )
  ).sort((a, b) => a.localeCompare(b, "de"))

  const homeInputRef = useRef<HTMLInputElement>(null)
  const homeSuggestionsRef = useRef<HTMLDivElement>(null)
  const homeDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const fetchHomeSuggestions = useCallback(async (query: string, retryCount = 0) => {
    const maxRetries = 3

    if (query.trim().length < 2) {
      setHomeSuggestions([])
      setShowHomeSuggestions(false)
      setHomeError(null)
      return
    }

    try {
      setLoadingHome(true)
      setHomeError(null)

      const response = await fetch(`/api/station-search?q=${encodeURIComponent(query)}`)

      if (response.status === 429) {
        const data = await response.json()
        const retryAfter = data.retryAfter || 1000

        if (retryCount < maxRetries) {
          const errorMsg = `Zu viele Anfragen, versuche erneut in ${Math.ceil(retryAfter / 1000)}s...`
          setHomeError(errorMsg)
          await new Promise(resolve => setTimeout(resolve, retryAfter))
          return fetchHomeSuggestions(query, retryCount + 1)
        } else {
          throw new Error("Rate limit exceeded. Bitte versuche es in einigen Sekunden erneut.")
        }
      }

      if (!response.ok) {
        throw new Error("Fehler beim Laden der Bahnhöfe")
      }

      const data = await response.json()
      if (data.results) {
        setHomeSuggestions(data.results)
        setShowHomeSuggestions(true)
      }
    } catch (error) {
      logError(LOG_SCOPE, "Could not fetch home station suggestions", error, { query })
      const errorMsg = error instanceof Error ? error.message : "Fehler beim Laden der Bahnhöfe"
      setHomeError(errorMsg)
    } finally {
      setLoadingHome(false)
    }
  }, [])

  const handleHomeInput = useCallback(
    (value: string) => {
      setHomeStation(value)
      setHomeStationId("")

      if (homeDebounceRef.current) {
        clearTimeout(homeDebounceRef.current)
      }

      homeDebounceRef.current = setTimeout(() => {
        fetchHomeSuggestions(value)
      }, 300)
    },
    [fetchHomeSuggestions]
  )

  const recordStationSelection = useCallback((query: string, suggestion: StationSuggestion) => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 2) {
      return
    }

    void fetch("/api/station-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: trimmedQuery, station: suggestion }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  const selectHomeSuggestion = useCallback((suggestion: StationSuggestion) => {
    recordStationSelection(homeStation, suggestion)
    setHomeStation(suggestion.name)
    setHomeStationId(suggestion.extId)
    setShowHomeSuggestions(false)
  }, [homeStation, recordStationSelection])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        homeInputRef.current &&
        !homeInputRef.current.contains(event.target as Node) &&
        homeSuggestionsRef.current &&
        !homeSuggestionsRef.current.contains(event.target as Node)
      ) {
        setShowHomeSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (homeDebounceRef.current) clearTimeout(homeDebounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!initialParams || Object.keys(initialParams).length === 0) {
      return
    }

    if (initialParams.homeStation || initialParams.homeStationLabel) {
      setHomeStation(initialParams.homeStationLabel || initialParams.homeStation || "")
      setHomeStationId(initialParams.homeStationExtId || "")
    }

    const hydratedDestinations = (initialParams.destinations ?? []).filter(destination =>
      ICE_STATIONS.some(station => station.name === destination)
    )
    if (hydratedDestinations.length > 0) {
      setSelectedDestinations(hydratedDestinations)
    }

    if (initialParams.outwardDate) {
      setOutwardDate(initialParams.outwardDate)
    }

    if (initialParams.returnDate) {
      setReturnDate(initialParams.returnDate)
      setIncludeReturnDate(true)
    } else {
      setIncludeReturnDate(false)
    }

    setAlter(initialParams.alter || "ERWACHSENER")

    const normalizedDiscount = normalizeDiscount(
      initialParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
      initialParams.ermaessigungKlasse || "KLASSENLOS"
    )
    setErmaessigungArt(normalizedDiscount.art)
    setErmaessigungKlasse(normalizedDiscount.klasse)

    if (initialParams.klasse) {
      setKlasse(initialParams.klasse)
    }

    setSchnelleVerbindungen(initialParams.schnelleVerbindungen ?? true)

    const mappedUmstiegsOption = !initialParams.maximaleUmstiege
      ? "alle"
      : initialParams.maximaleUmstiege === "0"
      ? "direkt"
      : initialParams.maximaleUmstiege
    setUmstiegsOption(mappedUmstiegsOption)

    setOutwardAbfahrtAb(initialParams.outwardAbfahrtAb || "")
    setOutwardAbfahrtBis(initialParams.outwardAbfahrtBis || "")
    setOutwardAnkunftAb(initialParams.outwardAnkunftAb || "")
    setOutwardAnkunftBis(initialParams.outwardAnkunftBis || "")
    setReturnAbfahrtAb(initialParams.returnAbfahrtAb || "")
    setReturnAbfahrtBis(initialParams.returnAbfahrtBis || "")
    setReturnAnkunftAb(initialParams.returnAnkunftAb || "")
    setReturnAnkunftBis(initialParams.returnAnkunftBis || "")
    setUmstiegszeit(initialParams.umstiegszeit || "normal")
  }, [initialParams])

  const submitSearch = (params: UrlauberfinderSearchParams) => {
    onSearch(params)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!homeStation.trim() && !homeStationId) {
      setHomeError("Bitte wähle einen Heimatbahnhof aus")
      return
    }

    if (selectedDestinations.length === 0) {
      alert("Bitte wähle mindestens ein Ziel aus")
      return
    }

    const payload: UrlauberfinderSearchParams = {
      // Always use the extId when available – it's unambiguous (same as train-search-form)
      homeStation: homeStationId || homeStation.trim(),
      homeStationLabel: homeStation.trim(),
      homeStationExtId: homeStationId || undefined,
      destinations: [...selectedDestinations],
      outwardDate,
      ...(includeReturnDate && { returnDate }),
      alter,
      ermaessigungArt,
      ermaessigungKlasse,
      klasse,
      schnelleVerbindungen,
      maximaleUmstiege: umstiegsOption === "alle" ? undefined : umstiegsOption === "direkt" ? "0" : umstiegsOption,
      outwardAbfahrtAb: outwardAbfahrtAb || undefined,
      outwardAbfahrtBis: outwardAbfahrtBis || undefined,
      outwardAnkunftAb: outwardAnkunftAb || undefined,
      outwardAnkunftBis: outwardAnkunftBis || undefined,
      returnAbfahrtAb: returnAbfahrtAb || undefined,
      returnAbfahrtBis: returnAbfahrtBis || undefined,
      returnAnkunftAb: returnAnkunftAb || undefined,
      returnAnkunftBis: returnAnkunftBis || undefined,
      umstiegszeit: umstiegszeit !== "normal" ? umstiegszeit : undefined,
    }

    if (selectedDestinations.length > 25) {
      setPendingSearchParams(payload)
      setShowLargeRequestDialog(true)
      return
    }

    submitSearch(payload)
  }

  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-2 sm:p-4 rounded-xl shadow-lg border border-gray-200">
      <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
        <h2 className="text-lg font-bold text-gray-800 sm:text-xl">
          Urlaubsfinder
        </h2>
        <FAQPopup context="urlaubsfinder" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
        {/* Heimatbahnhof */}
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Heimatbahnhof
          </h3>
          <div className="relative">
            <Label htmlFor="homeStation" className="text-sm font-medium text-gray-600 mb-2 block">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-4 h-4 text-blue-500" />
                Von wo startest du?
              </span>
            </Label>
            <Input
              ref={homeInputRef}
              id="homeStation"
              type="text"
              placeholder="z.B. München Hbf"
              value={homeStation}
              onChange={e => handleHomeInput(e.target.value)}
              onFocus={() => homeStation.length >= 2 && setShowHomeSuggestions(true)}
              required
              className={ctrl}
              autoComplete="off"
            />
            {homeError && (
              <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                <p className="text-xs text-amber-800 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {homeError}
                </p>
              </div>
            )}
            {showHomeSuggestions && homeSuggestions.length > 0 && (
              <div
                ref={homeSuggestionsRef}
                className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
              >
                {loadingHome && (
                  <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    Lädt...
                  </div>
                )}
                {homeSuggestions.map(suggestion => (
                  <button
                    key={suggestion.extId}
                    type="button"
                    onClick={() => selectHomeSuggestion(suggestion)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 text-sm"
                  >
                    {suggestion.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ziele */}
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h3 className="text-md font-semibold text-gray-700 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-600" />
              Reiseziele
            </h3>
            <span className="text-xs text-gray-500 font-medium">
              {selectedDestinations.length} ausgewählt
            </span>
          </div>

          {/* Vorauswahl-Buttons */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.filter(s => s.isDefault).map(s => s.name))}
              className="text-xs px-2.5 py-1 rounded-full border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium transition-colors"
            >
              🏙 Großstädte
            </button>
            <button
              type="button"
              onClick={() => togglePreset(CURATED_SMALL_CITIES_PRESET.filter(name => ICE_STATIONS.some(s => s.name === name)))}
              className="text-xs px-2.5 py-1 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium transition-colors"
            >
              🌳 Kleinere Städte (Top-Auswahl)
            </button>
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.filter(s => s.region === "Europa").map(s => s.name))}
              className="text-xs px-2.5 py-1 rounded-full border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium transition-colors"
            >
              🌍 Europäische Ziele
            </button>
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.map(s => s.name))}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 font-medium transition-colors"
            >
              ✓ Alle
            </button>
            <button
              type="button"
              onClick={() => setSelectedDestinations([])}
              className="text-xs px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
            >
              ✗ Keine
            </button>
          </div>

          {/* Gruppierte Stationsauswahl – immer sichtbar */}
          <div className="space-y-4 max-h-[340px] overflow-y-auto pr-1">
            {/* Großstädte */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">🏙 Großstädte</h4>
                <button
                  type="button"
                  onClick={() => {
                    const names = ICE_STATIONS.filter(s => s.isDefault).map(s => s.name)
                    const allSelected = names.every(n => selectedDestinations.includes(n))
                    if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                    else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold"
                >
                  alle ±
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ICE_STATIONS.filter(s => s.isDefault).map(station => {
                  const checked = selectedDestinations.includes(station.name)
                  return (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                        else setSelectedDestinations(prev => [...prev, station.name])
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                        checked
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {station.displayName.replace(" Hauptbahnhof", "")}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Europäische Ziele */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-bold text-purple-500 uppercase tracking-wider">🌍 Europäische Ziele</h4>
                <button
                  type="button"
                  onClick={() => {
                    const names = ICE_STATIONS.filter(s => s.region === "Europa").map(s => s.name)
                    const allSelected = names.every(n => selectedDestinations.includes(n))
                    if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                    else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                  }}
                  className="text-[10px] text-purple-600 hover:text-purple-800 font-semibold"
                >
                  alle ±
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ICE_STATIONS.filter(s => s.region === "Europa").map(station => {
                  const checked = selectedDestinations.includes(station.name)
                  return (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                        else setSelectedDestinations(prev => [...prev, station.name])
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                        checked
                          ? "bg-purple-600 text-white border-purple-600"
                          : "bg-white text-gray-600 border-purple-200 hover:border-purple-400 hover:text-purple-600"
                      }`}
                    >
                      {station.displayName}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Weitere deutsche Städte – nach Region */}
            {germanRegionsSorted.map(region => {
              const stations = ICE_STATIONS.filter(s => !s.isDefault && s.region === region)
              if (stations.length === 0) return null
              return (
                <div key={region}>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{region}</h4>
                    <button
                      type="button"
                      onClick={() => {
                        const names = stations.map(s => s.name)
                        const allSelected = names.every(n => selectedDestinations.includes(n))
                        if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                        else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                      }}
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold"
                    >
                      alle ±
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stations.map(station => {
                      const checked = selectedDestinations.includes(station.name)
                      return (
                        <button
                          key={station.name}
                          type="button"
                          onClick={() => {
                            if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                            else setSelectedDestinations(prev => [...prev, station.name])
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                            checked
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                          }`}
                        >
                          {station.displayName.replace(" Hauptbahnhof", "")}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Daten & Zeiten */}
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            Reisedaten
          </h3>

          {/* Mit Rückfahrt toggle */}
          <div className="flex items-center gap-2 mb-3">
            <Checkbox
              id="includeReturn"
              checked={includeReturnDate}
              onCheckedChange={checked => setIncludeReturnDate(!!checked)}
            />
            <Label htmlFor="includeReturn" className="text-sm font-medium text-gray-600 cursor-pointer">
              Mit Rückfahrt berechnen
            </Label>
          </div>

          <div className={`grid grid-cols-1 gap-3 ${includeReturnDate ? "sm:grid-cols-2" : ""}`}>
            {/* Hinfahrt block */}
            <div className="min-w-0 overflow-hidden rounded-lg border border-blue-100 bg-blue-50/40 p-2 sm:p-3 space-y-2">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">📍 Hinfahrt</p>
              <div>
                <Label htmlFor="outwardDate" className="text-xs font-medium text-gray-600 mb-1 block">Datum</Label>
                <Input
                  id="outwardDate"
                  type="date"
                  value={outwardDate}
                  onChange={e => {
                    setOutwardDate(e.target.value)
                    if (e.target.value > returnDate) {
                      const newReturnDate = new Date(e.target.value)
                      newReturnDate.setDate(newReturnDate.getDate() + 2)
                      setReturnDate(newReturnDate.toISOString().split("T")[0])
                    }
                  }}
                  min={new Date().toISOString().split("T")[0]}
                  className={dateTimeCtrl}
                />
              </div>
              <TimeWindowControls
                departureFromId="outwardAbfahrtAb"
                departureFrom={outwardAbfahrtAb}
                onDepartureFromChange={setOutwardAbfahrtAb}
                departureToId="outwardAbfahrtBis"
                departureTo={outwardAbfahrtBis}
                onDepartureToChange={setOutwardAbfahrtBis}
                arrivalFromId="outwardAnkunftAb"
                arrivalFrom={outwardAnkunftAb}
                onArrivalFromChange={setOutwardAnkunftAb}
                arrivalToId="outwardAnkunftBis"
                arrivalTo={outwardAnkunftBis}
                onArrivalToChange={setOutwardAnkunftBis}
              />
            </div>

            {/* Rückfahrt block */}
            {includeReturnDate && (
              <div className="min-w-0 overflow-hidden rounded-lg border border-orange-100 bg-orange-50/40 p-2 sm:p-3 space-y-2">
                <p className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-1">↩️ Rückfahrt</p>
                <div>
                  <Label htmlFor="returnDate" className="text-xs font-medium text-gray-600 mb-1 block">Datum</Label>
                  <Input
                    id="returnDate"
                    type="date"
                    value={returnDate}
                    onChange={e => setReturnDate(e.target.value)}
                    min={outwardDate}
                    className={dateTimeCtrl}
                  />
                </div>
                <TimeWindowControls
                  departureFromId="returnAbfahrtAb"
                  departureFrom={returnAbfahrtAb}
                  onDepartureFromChange={setReturnAbfahrtAb}
                  departureToId="returnAbfahrtBis"
                  departureTo={returnAbfahrtBis}
                  onDepartureToChange={setReturnAbfahrtBis}
                  arrivalFromId="returnAnkunftAb"
                  arrivalFrom={returnAnkunftAb}
                  onArrivalFromChange={setReturnAnkunftAb}
                  arrivalToId="returnAnkunftBis"
                  arrivalTo={returnAnkunftBis}
                  onArrivalToChange={setReturnAnkunftBis}
                />
              </div>
            )}
          </div>
        </div>

        {/* Reisende & Ermäßigung */}
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600" />
            Reisende & Ermäßigung
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium text-gray-600 mb-1 block">
                <span className="inline-flex items-center gap-1">
                  <Baby className="w-4 h-4 text-blue-500" />
                  Alter
                </span>
              </Label>
              <Select key={`alter-${alter}`} value={alter} onValueChange={setAlter}>
                <SelectTrigger className={ctrl}>
                  <SelectValue placeholder="Alter wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KIND">Kind (6–14 Jahre)</SelectItem>
                  <SelectItem value="JUGENDLICHER">Jugendlicher (15–26 Jahre)</SelectItem>
                  <SelectItem value="ERWACHSENER">Erwachsener (27–64 Jahre)</SelectItem>
                  <SelectItem value="SENIOR">Senior (ab 65 Jahre)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-600 mb-1 block">
                <span className="inline-flex items-center gap-1">
                  <Percent className="w-4 h-4 text-blue-500" />
                  Ermäßigung
                </span>
              </Label>
              <Select
                value={JSON.stringify({ art: ermaessigungArt, klasse: ermaessigungKlasse })}
                onValueChange={val => {
                  try {
                    const parsed = JSON.parse(val)
                    setErmaessigungArt(parsed.art)
                    setErmaessigungKlasse(parsed.klasse)
                  } catch {}
                }}
              >
                <SelectTrigger className={ctrl}>
                  <SelectValue placeholder="Ermäßigung wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={JSON.stringify({ art: "KEINE_ERMAESSIGUNG", klasse: "KLASSENLOS" })}>
                    Keine Ermäßigung
                  </SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD25", klasse: "KLASSE_2" })}>
                    BahnCard 25, 2. Klasse
                  </SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD25", klasse: "KLASSE_1" })}>
                    BahnCard 25, 1. Klasse
                  </SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD50", klasse: "KLASSE_2" })}>
                    BahnCard 50, 2. Klasse
                  </SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD50", klasse: "KLASSE_1" })}>
                    BahnCard 50, 1. Klasse
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-sm font-medium text-gray-600 mb-2 block">
              <span className="inline-flex items-center gap-1">
                <Train className="w-4 h-4 text-blue-500" />
                Klasse
              </span>
            </Label>
            <div className="flex gap-3">
              <button
                type="button"
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border-2 ${
                  klasse === "KLASSE_1"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                }`}
                onClick={() => setKlasse("KLASSE_1")}
              >
                1. Klasse
              </button>
              <button
                type="button"
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border-2 ${
                  klasse === "KLASSE_2"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                }`}
                onClick={() => setKlasse("KLASSE_2")}
              >
                2. Klasse
              </button>
            </div>
          </div>
        </div>

        {/* Optionen */}
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-600" />
            Verbindungsoptionen
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-2 ${
                  schnelleVerbindungen
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                }`}
                onClick={() => setSchnelleVerbindungen(!schnelleVerbindungen)}
              >
                Schnelle Verbindungen
              </button>
              <button
                type="button"
                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-2 ${
                  umstiegsOption === "direkt"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                }`}
                onClick={() => setUmstiegsOption(umstiegsOption === "direkt" ? "alle" : "direkt")}
              >
                Nur Direktverbindungen
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maxUmstiege" className="text-sm font-medium text-gray-600 mb-1 block">Max. Umstiege</Label>
                <Input
                  id="maxUmstiege"
                  type="number"
                  min="0"
                  max="10"
                  placeholder="Unbegrenzt"
                  value={umstiegsOption === "direkt" ? "0" : umstiegsOption === "alle" ? "" : umstiegsOption}
                  onChange={e => {
                    const val = e.target.value
                    if (val === "" || val === "0") {
                      setUmstiegsOption("alle")
                    } else {
                      setUmstiegsOption(val)
                    }
                  }}
                  disabled={umstiegsOption === "direkt"}
                  className={`${ctrl} ${umstiegsOption === "direkt" ? "opacity-50 cursor-not-allowed" : ""}`}
                />
              </div>
              <div>
                <Label htmlFor="umstiegszeit" className="text-sm font-medium text-gray-600 mb-1 block">Mind. Umstiegszeit</Label>
                <Select value={umstiegszeit} onValueChange={setUmstiegszeit}>
                  <SelectTrigger className={ctrl}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="5">5 Min</SelectItem>
                    <SelectItem value="10">10 Min</SelectItem>
                    <SelectItem value="15">15 Min</SelectItem>
                    <SelectItem value="20">20 Min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isSearching}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSearching ? "Sucht..." : "Günstige Ziele finden"}
        </Button>
      </form>

      <AlertDialog open={showLargeRequestDialog} onOpenChange={setShowLargeRequestDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Umfangreiche Anfrage</AlertDialogTitle>
            <AlertDialogDescription>
              Du hast <strong>{selectedDestinations.length}</strong> Ziele ausgewählt. Das erzeugt viele API-Abfragen und kann deutlich länger dauern.
              <br /><br />
              Möchtest du die Suche wirklich starten?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSearchParams) {
                  submitSearch(pendingSearchParams)
                  setPendingSearchParams(null)
                }
                setShowLargeRequestDialog(false)
              }}
            >
              Trotzdem starten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
