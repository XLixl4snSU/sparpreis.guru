"use client"

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue} from "@/components/ui/select"
import { ArrowLeftRight, Train, User, Percent, Shuffle, ArrowRight, Ticket, Settings, MapPin, Calendar, Baby, Clock, Zap, AlertTriangle, Lightbulb, CheckCircle, Map } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * \u26a0\ufe0f WHY inputs looked huge on mobile (esp. iOS Safari)
 * - Native <input type="date"|"time"> impose their own minimum height and UI.
 * - iOS zooms inputs whose font-size < 16px.
 * - Radix SelectTrigger / shadcn Input had differing default heights.
 *
 * FIX STRATEGY
 * - Use a unified control class ("ctrl"): consistent height (h-11), padding, text-base (>=16px), leading-tight.
 * - Neutralize native date/time chrome via appearance-none; normalize internal value box height.
 * - Apply the same height to SelectTrigger.
 * - Avoid container min-heights that force extra space.
 */

// 1) Reusable class names for uniform sizing
const ctrl = "h-11 w-full px-3 text-base leading-tight rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const ctrlGhost = "bg-gray-100 text-gray-500";

// 2) Global tweaks for date/time controls (Tailwind JIT via arbitrary variants)
//    Put this <style> once in your app (e.g., here or in globals.css under @layer components)
const DateTimeStyle = () => (
  <style jsx global>{`
    /* Normalize native date/time fields across mobile browsers */
    input[type="date"], input[type="time"] { 
      -webkit-appearance: none; appearance: none; 
      font-size: 16px; /* prevent iOS zoom */
      line-height: 1.2;
    }
    /* Remove extra inner box height in WebKit */
    input[type="date"]::-webkit-date-and-time-value,
    input[type="time"]::-webkit-date-and-time-value { 
      min-height: 0; 
      height: auto; 
    }
    /* Keep picker icon but don't let it inflate the field */
    input[type="date"]::-webkit-calendar-picker-indicator,
    input[type="time"]::-webkit-clear-button {
      margin: 0; padding: 0;
    }
  `}</style>
);

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: string
  nurDeutschlandTicketVerbindungen?: string
  maximaleUmstiege?: string
  reisezeitraumBis?: string
  abfahrtAb?: string
  ankunftBis?: string
  tage?: string
  umstiegszeit?: string
  wochentage?: string
}

interface TrainSearchFormProps {
  searchParams: SearchParams
}

interface StationSuggestion {
  extId: string
  id: string
  name: string
}

export function TrainSearchForm({ searchParams }: TrainSearchFormProps) {
  // Helper function to check if a string is a station ID (numeric)
  const isStationId = (value: string): boolean => {
    return /^\d+$/.test(value)
  }

  const [start, setStart] = useState(() => {
    // If the start param is an ID, don't show it, we'll resolve it later
    if (searchParams.start && isStationId(searchParams.start)) {
      return ""
    }
    return searchParams.start || ""
  })
  
  const [startId, setStartId] = useState(() => {
    // If the start param looks like an ID, store it as ID
    return searchParams.start && isStationId(searchParams.start) ? searchParams.start : ""
  })
  
  const [ziel, setZiel] = useState(() => {
    // If the ziel param is an ID, don't show it, we'll resolve it later
    if (searchParams.ziel && isStationId(searchParams.ziel)) {
      return ""
    }
    return searchParams.ziel || ""
  })
  
  const [zielId, setZielId] = useState(() => {
    // If the ziel param looks like an ID, store it as ID
    return searchParams.ziel && isStationId(searchParams.ziel) ? searchParams.ziel : ""
  })
  
  const [startSuggestions, setStartSuggestions] = useState<StationSuggestion[]>([])
  const [zielSuggestions, setZielSuggestions] = useState<StationSuggestion[]>([])
  const [showStartSuggestions, setShowStartSuggestions] = useState(false)
  const [showZielSuggestions, setShowZielSuggestions] = useState(false)
  const [loadingStart, setLoadingStart] = useState(false)
  const [loadingZiel, setLoadingZiel] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [zielError, setZielError] = useState<string | null>(null)
  
  const startInputRef = useRef<HTMLInputElement>(null)
  const zielInputRef = useRef<HTMLInputElement>(null)
  const startSuggestionsRef = useRef<HTMLDivElement>(null)
  const zielSuggestionsRef = useRef<HTMLDivElement>(null)
  
  // Debounce timer refs - use undefined as initial value
  const startDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const zielDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  
  function getTomorrowISO() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split("T")[0]
  }

  const [reisezeitraumAb, setReisezeitraumAb] = useState(
    searchParams.reisezeitraumAb || getTomorrowISO()
  )
  const [alter, setAlter] = useState(searchParams.alter || "ERWACHSENER")
  const [ermaessigungArt, setErmaessigungArt] = useState(searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG")
  const [ermaessigungKlasse, setErmaessigungKlasse] = useState(searchParams.ermaessigungKlasse || "KLASSENLOS")
  const [klasse, setKlasse] = useState(searchParams.klasse || "KLASSE_2")
  const [schnelleVerbindungen, setSchnelleVerbindungen] = useState(
    searchParams.schnelleVerbindungen === undefined || searchParams.schnelleVerbindungen === "1"
  )
  const [abfahrtAb, setAbfahrtAb] = useState(searchParams.abfahrtAb || "")
  const [ankunftBis, setAnkunftBis] = useState(searchParams.ankunftBis || "")
  
  const [umstiegsOption, setUmstiegsOption] = useState<string>(() => {
    if (searchParams.maximaleUmstiege === "0") return "direkt"
    if (!searchParams.maximaleUmstiege || searchParams.maximaleUmstiege === "alle") return "alle"
    return searchParams.maximaleUmstiege
  })
  
  const [nurDirektverbindungen, setNurDirektverbindungen] = useState(false) // Wird nicht mehr verwendet, nur für Backward-Compatibility
  const [reisezeitraumBis, setReisezeitraumBis] = useState(() => {
    if (searchParams.reisezeitraumBis) return searchParams.reisezeitraumBis
    const ab = new Date(reisezeitraumAb)
    ab.setDate(ab.getDate() + 2)
    return ab.toISOString().split("T")[0]
  })

  const switchStations = () => {
    const tempName = start
    const tempId = startId
    setStart(ziel)
    setStartId(zielId)
    setZiel(tempName)
    setZielId(tempId)
  }

  const weekdayLabels = [
    { label: "Mo", value: 1 },
    { label: "Di", value: 2 },
    { label: "Mi", value: 3 },
    { label: "Do", value: 4 },
    { label: "Fr", value: 5 },
    { label: "Sa", value: 6 },
    { label: "So", value: 0 },
  ]

  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(() => {
    if (searchParams.wochentage) {
      try {
        const arr = JSON.parse(searchParams.wochentage)
        if (Array.isArray(arr) && arr.every(v => typeof v === 'number')) {
          return arr
        }
      } catch {}
    }
    return [1,2,3,4,5,6,0]
  })

  const selectedDates = useMemo(() => {
    const dates: string[] = []
    const start = new Date(reisezeitraumAb)
    const end = new Date(reisezeitraumBis)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (selectedWeekdays.includes(d.getDay())) {
        dates.push(d.toISOString().split("T")[0])
        if (dates.length >= 30) break
      }
    }
    return dates
  }, [reisezeitraumAb, reisezeitraumBis, selectedWeekdays])

  // Fetch station suggestions with retry logic
  const fetchStationSuggestions = useCallback(async (query: string, type: 'start' | 'ziel', retryCount = 0) => {
    const maxRetries = 3
    
    if (query.trim().length < 2) {
      if (type === 'start') {
        setStartSuggestions([])
        setShowStartSuggestions(false)
        setStartError(null)
      } else {
        setZielSuggestions([])
        setShowZielSuggestions(false)
        setZielError(null)
      }
      return
    }
    
    try {
      if (type === 'start') {
        setLoadingStart(true)
        setStartError(null)
      } else {
        setLoadingZiel(true)
        setZielError(null)
      }
      
      const response = await fetch(`/api/station-search?q=${encodeURIComponent(query)}`)
      
      // Handle rate limiting
      if (response.status === 429) {
        const data = await response.json()
        const retryAfter = data.retryAfter || 1000
        
        if (retryCount < maxRetries) {
          // Show retry message
          const errorMsg = `Zu viele Anfragen, versuche erneut in ${Math.ceil(retryAfter / 1000)}s...`
          if (type === 'start') {
            setStartError(errorMsg)
          } else {
            setZielError(errorMsg)
          }
          
          // Retry after delay
          await new Promise(resolve => setTimeout(resolve, retryAfter))
          return fetchStationSuggestions(query, type, retryCount + 1)
        } else {
          throw new Error('Rate limit exceeded. Bitte versuche es in einigen Sekunden erneut.')
        }
      }
      
      if (!response.ok) {
        throw new Error('Fehler beim Laden der Bahnhöfe')
      }
      
      const data = await response.json()
      
      if (data.results) {
        if (type === 'start') {
          setStartSuggestions(data.results)
          setShowStartSuggestions(true)
        } else {
          setZielSuggestions(data.results)
          setShowZielSuggestions(true)
        }
      }
    } catch (error) {
      console.error('Error fetching station suggestions:', error)
      const errorMsg = error instanceof Error ? error.message : 'Fehler beim Laden der Bahnhöfe'
      if (type === 'start') {
        setStartError(errorMsg)
      } else {
        setZielError(errorMsg)
      }
    } finally {
      if (type === 'start') {
        setLoadingStart(false)
      } else {
        setLoadingZiel(false)
      }
    }
  }, [])
  
  // Handle input changes with debounce
  const handleStartInput = useCallback((value: string) => {
    setStart(value)
    setStartId("") // Clear ID when manually typing
    
    if (startDebounceRef.current) {
      clearTimeout(startDebounceRef.current)
    }
    
    startDebounceRef.current = setTimeout(() => {
      fetchStationSuggestions(value, 'start')
    }, 300)
  }, [fetchStationSuggestions])
  
  const handleZielInput = useCallback((value: string) => {
    setZiel(value)
    setZielId("") // Clear ID when manually typing
    
    if (zielDebounceRef.current) {
      clearTimeout(zielDebounceRef.current)
    }
    
    zielDebounceRef.current = setTimeout(() => {
      fetchStationSuggestions(value, 'ziel')
    }, 300)
  }, [fetchStationSuggestions])
  
  // Handle suggestion selection
  const selectStartSuggestion = useCallback((suggestion: StationSuggestion) => {
    setStart(suggestion.name)
    setStartId(suggestion.extId)
    setShowStartSuggestions(false)
  }, [])
  
  const selectZielSuggestion = useCallback((suggestion: StationSuggestion) => {
    setZiel(suggestion.name)
    setZielId(suggestion.extId)
    setShowZielSuggestions(false)
  }, [])
  
  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (startInputRef.current && !startInputRef.current.contains(event.target as Node) &&
          startSuggestionsRef.current && !startSuggestionsRef.current.contains(event.target as Node)) {
        setShowStartSuggestions(false)
      }
      if (zielInputRef.current && !zielInputRef.current.contains(event.target as Node) &&
          zielSuggestionsRef.current && !zielSuggestionsRef.current.contains(event.target as Node)) {
        setShowZielSuggestions(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      if (startDebounceRef.current) clearTimeout(startDebounceRef.current)
      if (zielDebounceRef.current) clearTimeout(zielDebounceRef.current)
    }
  }, [])

  // Resolve station IDs to names on mount
  useEffect(() => {
    const resolveStationId = async (id: string, type: 'start' | 'ziel') => {
      try {
        // Search for the station by ID - the API will return the station details
        const response = await fetch(`/api/station-search?q=${encodeURIComponent(id)}`)
        const data = await response.json()
        
        if (data.results && data.results.length > 0) {
          // Find exact match by extId
          const station = data.results.find((s: StationSuggestion) => s.extId === id) || data.results[0]
          if (type === 'start') {
            setStart(station.name)
          } else {
            setZiel(station.name)
          }
        }
      } catch (error) {
        console.error(`Error resolving station ID ${id}:`, error)
        // Fallback: show the ID if resolution fails
        if (type === 'start') {
          setStart(id)
        } else {
          setZiel(id)
        }
      }
    }
    
    // Resolve start station if it's an ID
    if (startId) {
      resolveStationId(startId, 'start')
    }
    
    // Resolve destination station if it's an ID
    if (zielId) {
      resolveStationId(zielId, 'ziel')
    }
  }, [startId, zielId]) // Run when IDs are available
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    
    // Use station ID if available, otherwise fallback to name
    if (startId) {
      params.set("start", startId)
    } else if (start) {
      params.set("start", start)
    }
    
    if (zielId) {
      params.set("ziel", zielId)
    } else if (ziel) {
      params.set("ziel", ziel)
    }
    
    if (reisezeitraumAb) params.set("reisezeitraumAb", reisezeitraumAb)
    if (reisezeitraumBis) params.set("reisezeitraumBis", reisezeitraumBis)
    if (alter) params.set("alter", alter)
    params.set("ermaessigungArt", ermaessigungArt)
    params.set("ermaessigungKlasse", ermaessigungKlasse)
    params.set("klasse", klasse)
    if (schnelleVerbindungen) params.set("schnelleVerbindungen", "1")
    if (abfahrtAb) params.set("abfahrtAb", abfahrtAb)
    if (ankunftBis) params.set("ankunftBis", ankunftBis)
    if (umstiegszeit && umstiegszeit !== "normal") {
      params.set("umstiegszeit", umstiegszeit)
    }
    
    // Umstiegs-Logik basierend auf umstiegsOption
    if (umstiegsOption === "direkt") {
      params.set("maximaleUmstiege", "0")
    } else if (umstiegsOption === "alle") {
      // Kein maximaleUmstiege Parameter setzen = alle Verbindungen
    } else {
      // umstiegsOption ist "1", "2", "3", "4", oder "5"
      params.set("maximaleUmstiege", umstiegsOption)
    }
    
    params.set("tage", JSON.stringify(selectedDates))
    params.set("wochentage", JSON.stringify(selectedWeekdays))
    window.location.href = `/?${params.toString()}`
  }

  const handleReset = () => {
    setStart("")
    setStartId("")
    setZiel("")
    setZielId("")
    setReisezeitraumAb(new Date().toISOString().split("T")[0])
    setAlter("ERWACHSENER")
    setErmaessigungArt("KEINE_ERMAESSIGUNG")
    setErmaessigungKlasse("KLASSENLOS")
    setKlasse("KLASSE_2")
    setSchnelleVerbindungen(true)
    setUmstiegsOption("alle")
    setAbfahrtAb("")
    setAnkunftBis("")
    setUmstiegszeit("normal")
    setSelectedWeekdays([1,2,3,4,5,6,0])
    window.history.replaceState({}, document.title, window.location.pathname)
  }

  const handleReisezeitraumAbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReisezeitraumAb(e.target.value)
    const ab = new Date(e.target.value)
    const bis = new Date(reisezeitraumBis)
    if (bis < ab) {
      setReisezeitraumBis(e.target.value)
    }
  }

  const [umstiegszeit, setUmstiegszeit] = useState(searchParams.umstiegszeit || "normal")

  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-2 sm:p-4 rounded-xl shadow-lg border border-gray-200">
      <DateTimeStyle />
      <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 text-gray-800 flex items-center gap-2">
        <Train className="w-5 h-5 text-blue-600" />
        Bestpreissuche
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-6">
        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-blue-600" />
            Reisedaten
          </h3>
          <div className="flex flex-row gap-2 items-end flex-nowrap mb-3">
            <div className="flex-1 min-w-0 relative">
              <Label htmlFor="start" className="text-sm font-medium text-gray-600 mb-2 block">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-blue-500" />
                  Von (Startbahnhof)
                </span>
              </Label>
              <Input
                ref={startInputRef}
                id="start"
                type="text"
                placeholder="München"
                value={start}
                onChange={(e) => handleStartInput(e.target.value)}
                onFocus={() => start.length >= 2 && setShowStartSuggestions(true)}
                required
                className={ctrl}
                autoComplete="off"
              />
              {startError && (
                <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                  <p className="text-xs text-amber-800 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {startError}
                  </p>
                </div>
              )}
              {showStartSuggestions && startSuggestions.length > 0 && (
                <div 
                  ref={startSuggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                >
                  {loadingStart && (
                    <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Lädt...
                    </div>
                  )}
                  {startSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.extId}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-b-0"
                      onClick={() => selectStartSuggestion(suggestion)}
                    >
                      <div className="font-medium text-gray-900">{suggestion.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end flex-shrink-0" style={{height: '44px'}}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={switchStations}
                className="bg-white hover:bg-gray-50 border-gray-300 h-11 w-11 flex items-center justify-center p-0"
                tabIndex={-1}
                aria-label="Bahnhöfe tauschen"
                style={{height: '44px', width: '44px'}}
              >
                <ArrowLeftRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 min-w-0 relative">
              <Label htmlFor="ziel" className="text-sm font-medium text-gray-600 mb-2 block">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-blue-500" />
                  Nach (Zielbahnhof)
                </span>
              </Label>
              <Input
                ref={zielInputRef}
                id="ziel"
                type="text"
                placeholder="Berlin"
                value={ziel}
                onChange={(e) => handleZielInput(e.target.value)}
                onFocus={() => ziel.length >= 2 && setShowZielSuggestions(true)}
                required
                className={ctrl}
                autoComplete="off"
              />
              {zielError && (
                <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                  <p className="text-xs text-amber-800 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {zielError}
                  </p>
                </div>
              )}
              {showZielSuggestions && zielSuggestions.length > 0 && (
                <div 
                  ref={zielSuggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                >
                  {loadingZiel && (
                    <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Lädt...
                    </div>
                  )}
                  {zielSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.extId}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-b-0"
                      onClick={() => selectZielSuggestion(suggestion)}
                    >
                      <div className="font-medium text-gray-900">{suggestion.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Restliche Felder im grid */}
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-sm font-medium text-gray-600 mb-2 block">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-blue-500" />
                  Reisezeitraum
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <Input 
                  id="reisezeitraumAb" 
                  type="date" 
                  value={reisezeitraumAb} 
                  onChange={handleReisezeitraumAbChange} 
                  min={getTomorrowISO()} // Verhindert Eingabe von Daten in der Vergangenheit
                  className={ctrl}
                />
                <span className="text-gray-500 text-sm">bis</span>
                <Input
                  id="reisezeitraumBis"
                  type="date"
                  min={reisezeitraumAb}
                  value={reisezeitraumBis}
                  onChange={e => setReisezeitraumBis(e.target.value)}
                  className={ctrl}
                />
              </div>
            </div>
            {/* Zeitfilter - Optional */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-4">
              <div>
                <Label htmlFor="abfahrtAb" className="text-sm font-medium text-gray-600 mb-2 block">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span className="truncate">Abfahrt ab</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="ml-1 cursor-pointer text-blue-600 p-0 bg-transparent border-0 focus:outline-none flex-shrink-0" tabIndex={0} aria-label="Info zu Zeitfenster">
                          <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs text-sm text-gray-700">
                        <div className="font-semibold mb-1 text-blue-800">Zeitfenster für Abfahrt/Ankunft</div>
                        <div>
                          Hier kannst du ein Zeitfenster für die Ankunft festlegen (z.B. <b>15:00</b> wenn du am Abend noch etwas vorhast).<br/>
                          <b>Tipp:</b> Um Nachtfahrten zu filtern, setze <b>Abfahrt ab</b> z.B. auf <b>22:00</b> und <b>Ankunft bis</b> auf z.B. <b>07:00</b>.   
                        </div>
                      </PopoverContent>
                    </Popover>
                  </span>
                </Label>
                <div className="relative">
                  <Input 
                    id="abfahrtAb" 
                    type="time" 
                    value={abfahrtAb} 
                    onChange={(e) => setAbfahrtAb(e.target.value)} 
                    className={ctrl}
                  />
                  {abfahrtAb && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                      onClick={() => setAbfahrtAb("")}
                      tabIndex={-1}
                      aria-label="Abfahrt ab zurücksetzen"
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style={{display: 'block'}}><path d="M6 6l8 8M6 14L14 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor="ankunftBis" className="text-sm font-medium text-gray-600 mb-2 block">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span className="truncate">Ankunft bis</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="ml-1 cursor-pointer text-blue-600 p-0 bg-transparent border-0 focus:outline-none flex-shrink-0" tabIndex={0} aria-label="Info zu Zeitfenster">
                          <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs text-sm text-gray-700">
                        <div className="font-semibold mb-1 text-blue-800">Zeitfenster für Abfahrt/Ankunft</div>
                        <div>
                          Hier kannst du ein Zeitfenster für die Ankunft festlegen (z.B. <b>15:00</b> wenn du am Abend noch etwas vorhast).<br/>
                          <b>Tipp:</b> Um Nachtfahrten zu filtern, setze <b>Abfahrt ab</b> z.B. auf <b>22:00</b> und <b>Ankunft bis</b> auf z.B. <b>07:00</b>.                    
                        </div>
                      </PopoverContent>
                    </Popover>
                  </span>
                </Label>
                <div className="relative">
                  <Input 
                    id="ankunftBis" 
                    type="time" 
                    value={ankunftBis} 
                    onChange={(e) => setAnkunftBis(e.target.value)} 
                    className={ctrl}
                  />
                  {ankunftBis && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                      onClick={() => setAnkunftBis("")}
                      tabIndex={-1}
                      aria-label="Ankunft bis zurücksetzen"
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style={{display: 'block'}}><path d="M6 6l8 8M6 14L14 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Wochentagsauswahl */}
          <div className="mt-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1">
                <Label className="text-sm font-medium text-gray-600 mb-2 block">Nur diese Wochentage:</Label>
                <div className="flex flex-wrap gap-2">
                  {weekdayLabels.map(wd => (
                    <button
                      key={wd.value}
                      type="button"
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        selectedWeekdays.includes(wd.value)
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => {
                        setSelectedWeekdays(prev =>
                          prev.includes(wd.value)
                            ? prev.filter(v => v !== wd.value)
                            : [...prev, wd.value]
                        )
                      }}
                    >
                      {wd.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Kompakte Info-Box neben den Wochentagen */}
              <div className={`flex-shrink-0 text-xs p-2 rounded-lg border ${
                selectedDates.length >= 30
                  ? 'text-orange-800 bg-orange-50 border-orange-200'
                  : selectedDates.length > 10
                    ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-green-800 bg-green-50 border-green-200'
              }`}>
                <div className="flex items-center gap-1 mb-1">
                  <div className="flex-shrink-0">
                    {selectedDates.length >= 30 ? (
                      <AlertTriangle className="w-3 h-3 text-orange-600" />
                    ) : selectedDates.length > 10 ? (
                      <Lightbulb className="w-3 h-3 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-3 h-3 text-green-600" />
                    )}
                  </div>
                  <div className="font-semibold text-gray-900">
                    {selectedDates.length >= 30 ? 'Maximum' : selectedDates.length > 10 ? 'Hinweis' : 'Optimal'} ({selectedDates.length} von max. 30 Tagen)
                  </div>
                </div>
                <div className="text-gray-700 leading-tight">
                  {selectedDates.length >= 30 ? (
                    'Es werden nur die ersten 30 Tage gesucht.'
                  ) : selectedDates.length > 10 ? (
                    'Je weniger Tage, desto schneller die Suche.'
                  ) : (
                    'Optimale Auswahl für schnelle Ergebnisse!'
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

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
              <Select value={alter} onValueChange={setAlter}>
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
                onValueChange={(val: string) => {
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
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all border-2 ${
                  klasse === "KLASSE_1"
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                }`}
                onClick={() => setKlasse("KLASSE_1")}
              >
                <div className="flex items-center justify-center gap-2">
                  <Train className="w-4 h-4" />
                  1. Klasse
                </div>
              </button>
              <button
                type="button"
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all border-2 ${
                  klasse === "KLASSE_2"
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                }`}
                onClick={() => setKlasse("KLASSE_2")}
              >
                <div className="flex items-center justify-center gap-2">
                  <Train className="w-4 h-4" />
                  2. Klasse
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-600" />
            Optionen
          </h3>
          <div className="space-y-3">
            {/* Schnellste Verbindungen und Direktverbindungen nebeneinander */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium text-gray-600 mb-2 block">
                  <span className="inline-flex items-center gap-1">
                    <Zap className="w-4 h-4 text-blue-500" />
                    Schnellste Verbindungen bevorzugen
                  </span>
                </Label>
                <button
                  type="button"
                  className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-all border-2 ${
                    schnelleVerbindungen
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                  onClick={() => setSchnelleVerbindungen(!schnelleVerbindungen)}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Zap className="w-4 h-4" />
                    {schnelleVerbindungen ? 'Aktiviert' : 'Deaktiviert'}
                  </div>
                </button>
              </div>
              
              <div>
                <Label className="text-sm font-medium text-gray-600 mb-2 block">
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight className="w-4 h-4 text-blue-500" />
                    Nur Direktverbindungen
                  </span>
                </Label>
                <button
                  type="button"
                  className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-all border-2 ${
                    umstiegsOption === "direkt"
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                  onClick={() => setUmstiegsOption(umstiegsOption === "direkt" ? "alle" : "direkt")}
                >
                  <div className="flex items-center justify-center gap-2">
                    <ArrowRight className="w-4 h-4" />
                    {umstiegsOption === "direkt" ? 'Aktiviert' : 'Deaktiviert'}
                  </div>
                </button>
              </div>
            </div>
            
            {/* Maximale Umstiege und Mindest-Umstiegszeit nebeneinander */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div className="flex flex-col h-full">
                <Label htmlFor="maxUmstiege" className="text-sm font-medium text-gray-600 mb-2 block min-h-[22px]">
                  <span className="inline-flex items-center gap-1">
                    <Shuffle className="w-4 h-4 text-blue-500" />
                    Maximale Umstiege
                  </span>
                </Label>
                <div className="flex-1 flex flex-col">
                  <Input
                    id="maxUmstiege"
                    type="number"
                    min="0"
                    max="10"
                    placeholder="Unbegrenzt"
                    value={umstiegsOption === "direkt" ? "0" : (umstiegsOption === "alle" ? "" : umstiegsOption)}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "" || value === "unbegrenzt") {
                        setUmstiegsOption("alle");
                      } else if (value === "0") {
                        setUmstiegsOption("direkt");
                      } else {
                        setUmstiegsOption(value);
                      }
                    }}
                    disabled={umstiegsOption === "direkt"}
                    className={`${ctrl} ${umstiegsOption === "direkt" ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                </div>
              </div>
              
              <div className="flex flex-col h-full">
                <Label htmlFor="umstiegszeit" className="text-sm font-medium text-gray-600 mb-2 block min-h-[22px]">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-4 h-4 text-blue-500" />
                    Mindest-Umstiegszeit
                  </span>
                </Label>
                <div className="flex-1 flex flex-col">
                  <Select 
                    value={umstiegszeit} 
                    onValueChange={setUmstiegszeit}
                    disabled={umstiegsOption === "direkt"}
                  >
                    <SelectTrigger className={`${ctrl} ${umstiegsOption === "direkt" ? "opacity-50 cursor-not-allowed" : ""}`}>
                      <SelectValue placeholder="Normal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="10">10 Minuten</SelectItem>
                      <SelectItem value="15">15 Minuten</SelectItem>
                      <SelectItem value="20">20 Minuten</SelectItem>
                      <SelectItem value="25">25 Minuten</SelectItem>
                      <SelectItem value="30">30 Minuten</SelectItem>
                      <SelectItem value="35">35 Minuten</SelectItem>
                      <SelectItem value="40">40 Minuten</SelectItem>
                      <SelectItem value="45">45 Minuten</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg shadow-sm">
            <Ticket className="w-4 h-4 mr-2" />
            Bestpreise suchen
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} className="border-gray-300 hover:bg-gray-50 px-6 py-3 rounded-lg">
            Zurücksetzen
          </Button>
        </div>
      </form>
    </div>
  )
}