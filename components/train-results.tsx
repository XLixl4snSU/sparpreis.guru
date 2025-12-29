"use client"

import { useState, useEffect, useRef } from "react"
import { PriceCalendar } from "./price-calendar"
import { DayDetailsModal } from "./day-details-modal"

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: string
  nurDeutschlandTicketVerbindungen?: string
  maximaleUmstiege?: string
  abfahrtAb?: string
  ankunftBis?: string
  tage?: string // JSON-String mit Array der gewünschten Tage
  umstiegszeit?: string
}

interface TrainResultsProps {
  searchParams: SearchParams
}

interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

interface PriceData {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  recordedAt?: number
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: Array<{
    preis: number
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt: string
    ankunftsOrt: string
    info: string
    umstiegsAnzahl?: number
    isCheapestPerInterval?: boolean
    priceHistory?: PriceHistoryEntry[]
  }>
}

interface MetaData {
  startStation: { name: string; id: string }
  zielStation: { name: string; id: string }
  sessionId?: string
  searchParams?: {
    klasse?: string
    maximaleUmstiege?: string
    schnelleVerbindungen?: string | boolean
    nurDeutschlandTicketVerbindungen?: string | boolean
    abfahrtAb?: string
    ankunftBis?: string
    umstiegszeit?: string
  }
}

interface PriceResults {
  [date: string]: PriceData
}

export function TrainResults({ searchParams }: TrainResultsProps) {
  const [priceResults, setPriceResults] = useState<PriceResults>({})
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<PriceData | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const [hasScrolledToCalendar, setHasScrolledToCalendar] = useState(false)

  // Anzahl erwarteter Tage aus den Suchparametern berechnen (falls vorhanden)
  const expectedDays = (() => {
    try {
      return searchParams.tage ? (JSON.parse(searchParams.tage) as string[]).length : undefined
    } catch {
      return undefined
    }
  })()

  // Track der bereits eingetroffenen dayResults
  const processedDaysRef = useRef<Set<string>>(new Set())

  // Generate sessionId when search starts
  const generateSessionId = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID()
    }
    // Fallback für ältere Browser
    return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  const validPriceResults = Object.entries(priceResults).filter(([key]) => key !== "_meta") as [string, PriceData][]
  const _meta = (priceResults as any)._meta as MetaData | undefined
  const startStation = _meta?.startStation
  const zielStation = _meta?.zielStation

  // Funktion zum Abbrechen der Suche
  const cancelSearch = async () => {
    console.log("🛑 User requested search cancellation")
    
    // Backend ZUERST über Abbruch informieren (bevor AbortController)
    if (sessionId) {
      try {
        await fetch(`/api/search-prices/cancel-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, reason: 'user_request' })
        })
        console.log("✅ Backend notified about cancellation")
      } catch (error) {
        console.warn("⚠️ Could not notify backend about cancellation:", error)
      }
    }
    
    // AbortController abbrechen
    if (abortController) {
      abortController.abort()
      setAbortController(null)
    }
    
    // Frontend-State SPÄTER zurücksetzen (damit sessionId noch verfügbar ist)
    setLoading(false)
    setIsStreaming(false)
    // sessionId NICHT sofort null setzen - wird durch useEffect cleanup gemacht
  }

  // Cleanup bei Component Unmount oder Navigation
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (sessionId && isStreaming) {
        // Versuche Backend über Seitenabbruch zu informieren
        try {
          await fetch(`/api/search-prices/cancel-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, reason: 'page_unload' })
          })
        } catch (error) {
          console.warn("Could not notify backend about page unload")
        }
      }
    }

    const handleVisibilityChange = async () => {
      if (document.hidden && sessionId && isStreaming) {
        // Seite ist nicht mehr sichtbar - informiere Backend
        try {
          await fetch(`/api/search-prices/cancel-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, reason: 'page_hidden' })
          })
        } catch (error) {
          console.warn("Could not notify backend about page visibility change")
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      // Cleanup bei Component Unmount
      if (sessionId && isStreaming) {
        handleBeforeUnload()
      }
    }
  }, [sessionId, isStreaming])

  // Create a unique key for the current search to prevent duplicate requests
  const currentSearchKey = JSON.stringify({
    start: searchParams.start,
    ziel: searchParams.ziel,
    reisezeitraumAb: searchParams.reisezeitraumAb,
    reisezeitraumBis: searchParams.reisezeitraumBis,
    ermaessigungArt: searchParams.ermaessigungArt,
    ermaessigungKlasse: searchParams.ermaessigungKlasse,
    alter: searchParams.alter,
    klasse: searchParams.klasse,
    schnelleVerbindungen: searchParams.schnelleVerbindungen,
    nurDeutschlandTicketVerbindungen: searchParams.nurDeutschlandTicketVerbindungen,
    maximaleUmstiege: searchParams.maximaleUmstiege,
    abfahrtAb: searchParams.abfahrtAb,
    ankunftBis: searchParams.ankunftBis,
    tage: searchParams.tage,
    umstiegszeit: searchParams.umstiegszeit,
  })

  useEffect(() => {
    // Only search if we have required params and this is a new search
    if (!searchParams.start || !searchParams.ziel || currentSearchKey === "") {
      return
    }

    const searchPrices = async () => {
      setLoading(true)
      setPriceResults({})
      setIsStreaming(true)
      processedDaysRef.current = new Set() // Reset für neue Suche
      
      // Generiere sessionId sofort im Frontend
      const newSessionId = generateSessionId()
      setSessionId(newSessionId)

      // Erstelle AbortController für diese Anfrage
      const controller = new AbortController()
      setAbortController(controller)

      try {
        const response = await fetch("/api/search-prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal, // AbortController hinzufügen
          body: JSON.stringify({
            sessionId: newSessionId,
            start: searchParams.start,
            ziel: searchParams.ziel,
            tage: searchParams.tage ? JSON.parse(searchParams.tage) : undefined,
            reisezeitraumAb: searchParams.reisezeitraumAb || new Date().toISOString().split("T")[0],
            reisezeitraumBis: searchParams.reisezeitraumBis,
            alter: searchParams.alter || "ERWACHSENER",
            ermaessigungArt: searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
            ermaessigungKlasse: searchParams.ermaessigungKlasse || "KLASSENLOS",
            klasse: searchParams.klasse || "KLASSE_2",
            schnelleVerbindungen: searchParams.schnelleVerbindungen === "1",
            nurDeutschlandTicketVerbindungen: searchParams.nurDeutschlandTicketVerbindungen === "1",
            ...(searchParams.maximaleUmstiege !== undefined && searchParams.maximaleUmstiege !== "" && { maximaleUmstiege: Number.parseInt(searchParams.maximaleUmstiege) }),
            abfahrtAb: searchParams.abfahrtAb,
            ankunftBis: searchParams.ankunftBis,
            umstiegszeit: searchParams.umstiegszeit,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
          throw new Error(errorData.error || `HTTP ${response.status}: Bestpreissuche fehlgeschlagen`)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        
        if (reader) {
          // Streaming response verarbeiten
          let buffer = ""
          
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ""
              
              for (const line of lines) {
                if (line.trim()) {
                  try {
                    const data = JSON.parse(line)
                    
                    if (data.type === 'dayResult') {
                      // Einzelnes Tagesergebnis hinzufügen
                      setPriceResults(prev => ({
                        ...prev,
                        [data.date]: data.result,
                        _meta: data.meta || prev._meta
                      }))
                      // Client-seitig als abgeschlossen markieren, wenn letzter Tag eingetroffenen ist
                      processedDaysRef.current.add(data.date)
                      if (expectedDays && processedDaysRef.current.size >= expectedDays) {
                        setIsStreaming(false)
                        setTimeout(() => setSessionId(null), 500)
                      }
                    } else if (data.type === 'complete') {
                      // Vollständige Ergebnisse bei Abschluss
                      setPriceResults(data.results)
                      setLoading(false)
                      setIsStreaming(false)
                      setSessionId(null)
                      return
                    }
                  } catch {
                    console.warn("Could not parse streaming response line:", line)
                  }
                }
              }
            }
            // Set status to completed after streaming ends
            setLoading(false)
            setIsStreaming(false)
          } finally {
            reader.releaseLock()
          }
          
          // Fallback: Versuche finalen Buffer als JSON zu parsen
          if (buffer.trim()) {
            try {
              const finalData = JSON.parse(buffer)
              setPriceResults(finalData)
            } catch (e) {
              console.warn("Could not parse final buffer:", buffer)
            }
          }
        } else {
          // Fallback für non-streaming response
          const data = await response.json()
          setPriceResults(data)
        }
        
        // Cleanup nach 1 Sekunde um sicherzustellen dass alle Backend-Operationen abgeschlossen sind
        setTimeout(() => {
          setSessionId(null)
        }, 1000)
        setAbortController(null)
      } catch (err) {
         // Check if error was due to abort
        if (err instanceof Error && err.name === 'AbortError') {
          console.log("🛑 Request was aborted by user")
        } else {
          console.error("Error in bestpreissuche:", err)
        }
      } finally {
        setLoading(false)
        setIsStreaming(false)
        // Cleanup nach 1 Sekunde um sicherzustellen dass alle Backend-Operationen abgeschlossen sind
        setTimeout(() => {
          setSessionId(null)
        }, 1000)
        setAbortController(null)
      }
    }

    searchPrices()
  }, [
    currentSearchKey,
    searchParams.start,
    searchParams.ziel,
    searchParams.reisezeitraumAb,
    searchParams.reisezeitraumBis,
    searchParams.alter,
    searchParams.klasse,
    searchParams.schnelleVerbindungen,
    searchParams.nurDeutschlandTicketVerbindungen,
    searchParams.maximaleUmstiege,
    searchParams.ermaessigungArt,
    searchParams.ermaessigungKlasse,
    searchParams.abfahrtAb,
    searchParams.ankunftBis,
    searchParams.tage,
    searchParams.umstiegszeit,
  ])

  // --- Tag-Navigation für Modal und Kalender ---
  const dayKeys = validPriceResults.map(([date]) => date).sort()
  const handleNavigateDay = (direction: number) => {
    if (!selectedDay) return
    const idx = dayKeys.indexOf(selectedDay)
    const newIdx = idx + direction
    if (newIdx >= 0 && newIdx < dayKeys.length) {
      const newDay = dayKeys[newIdx]
      setSelectedDay(newDay)
      setSelectedData(priceResults[newDay])
    }
  }

  const prices = validPriceResults
    .map(([, r]) => r.preis)
    .filter((p) => p > 0)

  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const avgPrice = Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length)

  useEffect(() => {
    // Sobald der Kalender sichtbar ist (auch beim Laden), einmalig scrollen
    if (!hasScrolledToCalendar && calendarRef.current && (loading || isStreaming || validPriceResults.length > 0)) {
      calendarRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
      setHasScrolledToCalendar(true)
    }
  }, [loading, isStreaming, hasScrolledToCalendar, validPriceResults.length])

  // Show nothing if no search params
  if (!searchParams.start || !searchParams.ziel) {
    return null
  }

  // Reset scroll-Flag, wenn neue Suche gestartet wird
  useEffect(() => {
    setHasScrolledToCalendar(false)
  }, [currentSearchKey])

  // Always show calendar when search is active or has results
  if (!loading && !isStreaming && (!validPriceResults || validPriceResults.length === 0)) {
    return (
        <div className="text-center py-8">
          <p className="text-red-600 font-medium">Keine Bestpreise gefunden</p>
          <p className="text-gray-600 text-sm mt-2">
            Bitte überprüfe die Bahnhofsnamen und versuche es erneut.
          </p>
        </div>
    )
  }

  // Only show "no prices" message if search is completely done and no valid prices found
  if (!loading && !isStreaming && prices.length === 0) {
    return (
        <div className="text-center py-8">
          <p className="text-orange-600 font-medium">Keine Preise verfügbar</p>
          <p className="text-gray-600 text-sm mt-2">Für den gewählten Zeitraum sind keine Bestpreise verfügbar.</p>
        </div>
    )
  }

  return (
      <div className="space-y-6">
        {/* Calendar View */}
        <div ref={calendarRef}>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            📅 Preiskalender
            <span className="text-sm font-normal text-gray-500">(Klicken zum Buchen)</span>
          </h3>
          <PriceCalendar
              results={priceResults}
              onDayClick={(date, data) => {
                setSelectedDay(date)
                setSelectedData(data)
              }}
              startStation={startStation}
              zielStation={zielStation}
              searchParams={searchParams}
              isStreaming={isStreaming}
              sessionId={sessionId}
              onCancelSearch={cancelSearch}
              selectedDay={selectedDay || undefined}
              onNavigateDay={handleNavigateDay}
              expectedDays={expectedDays}
          />
        </div>

        {/* Day Details Modal */}
        <DayDetailsModal
            isOpen={!!selectedDay}
            onClose={() => {
              setSelectedDay(null)
              setSelectedData(null)
            }}
            date={selectedDay}
            data={selectedData}
            startStation={startStation}
            zielStation={zielStation}
            searchParams={searchParams}
            onNavigateDay={handleNavigateDay}
            dayKeys={dayKeys}
        />
      </div>
  )
}