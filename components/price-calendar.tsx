"use client"

import React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"

interface IntervalData {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  isCheapestPerInterval?: boolean
}

interface PriceData {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  allIntervals?: IntervalData[]
}

interface PriceResults {
  [date: string]: PriceData
}

interface PriceCalendarProps {
  results: PriceResults
  onDayClick: (date: string, data: PriceData) => void
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams?: any
  isStreaming?: boolean
  expectedDays?: number
  sessionId?: string | null
  onCancelSearch?: () => void
  onNavigateDay?: (direction: number) => void // Neue Prop für Tag-Navigation
  selectedDay?: string // Neu: Ausgewählter Tag (YYYY-MM-DD)
}

// Wochentage so anpassen, dass Montag links steht
const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const months = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
]

export function PriceCalendar({ results, onDayClick, startStation, zielStation, searchParams, isStreaming, expectedDays, sessionId, onCancelSearch, onNavigateDay, selectedDay }: PriceCalendarProps) {
  const today = new Date()
  const resultDates = Object.keys(results).filter(key => key !== '_meta').sort()
  
  // Hilfsfunktion: Date zu YYYY-MM-DD (lokal, nicht UTC!)
  const formatDateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  
  if (resultDates.length === 0 && !isStreaming) {
    return (
      <div className="text-center py-8 text-gray-500">
        Keine Suchergebnisse verfügbar. Bitte starte eine neue Suche.
      </div>
    )
  }

  // Get the date range from results or expected range
  const dates = Object.keys(results).filter(key => key !== '_meta').sort()
  
  // Generate expected date range if streaming
  const getExpectedDateRange = () => {
    // Wenn nicht streamend, verwende die bereits vorhandenen Daten
    if (!isStreaming) {
      return dates
    }
    
    // Berechne erwartete Daten aus Wochentagen und Datumsbereich
    if (searchParams?.reisezeitraumAb && searchParams?.reisezeitraumBis) {
      try {
        // Parse weekdays from readable format or default to all days
        let weekdays: number[]
        if (searchParams.wochentage) {
          const decoded = decodeURIComponent(searchParams.wochentage)
          if (decoded.startsWith('[')) {
            // Old JSON format
            weekdays = JSON.parse(decoded)
          } else {
            // New readable format: "1,2,3,4,5"
            weekdays = decoded.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 6)
          }
        } else {
          // No weekdays param = all days
          weekdays = [1, 2, 3, 4, 5, 6, 0]
        }
        
        const startDate = new Date(searchParams.reisezeitraumAb)
        const endDate = new Date(searchParams.reisezeitraumBis)
        const expectedDates: string[] = []
        
        for (let d = new Date(startDate); d <= endDate && expectedDates.length < 30; d.setDate(d.getDate() + 1)) {
          if (weekdays.includes(d.getDay())) {
            expectedDates.push(formatDateKey(d))
          }
        }
        
        return expectedDates.sort()
      } catch (error) {
        console.warn('Could not calculate expected dates from weekdays:', error)
      }
    }
    
    return dates
  }
  
  const expectedDateRange = getExpectedDateRange()
  const firstExpectedDate = expectedDateRange.length > 0 ? new Date(expectedDateRange[0]) : (dates.length > 0 ? new Date(dates[0]) : new Date())
  const lastExpectedDate = expectedDateRange.length > 0 ? new Date(expectedDateRange[expectedDateRange.length - 1]) : (dates.length > 0 ? new Date(dates[dates.length - 1]) : new Date())

  if (dates.length === 0 && expectedDateRange.length === 0) return null

  const firstDate = dates.length > 0 ? new Date(dates[0]) : firstExpectedDate
  const lastDate = dates.length > 0 ? new Date(dates[dates.length - 1]) : lastExpectedDate

  // State for calendar navigation
  const [currentMonth, setCurrentMonth] = useState(() => new Date())

  useEffect(() => {
    if (firstDate) {
      setCurrentMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1))
    }
  }, [firstDate.getFullYear(), firstDate.getMonth()])

  // Find min and max prices for color coding
  const prices = Object.values(results)
    .map((r) => r.preis)
    .filter((p) => p > 0)

  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0

  // Generate calendar days for current month
  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    // First day of the month
    const firstDayOfMonth = new Date(year, month, 1)
    // Last day of the month
    const lastDayOfMonth = new Date(year, month + 1, 0)

    // Start from the first Monday of the week containing the first day
    const startDate = new Date(firstDayOfMonth)
    const dayOfWeek = (startDate.getDay() + 6) % 7 // Montag=0, Sonntag=6
    startDate.setDate(startDate.getDate() - dayOfWeek)

    // End at the last Sunday of the week containing the last day
    const endDate = new Date(lastDayOfMonth)
    const endDayOfWeek = (endDate.getDay() + 6) % 7
    endDate.setDate(endDate.getDate() + (6 - endDayOfWeek))

    const days = []
    const current = new Date(startDate)

    while (current <= endDate) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }

    return days
  }

  const calendarDays = generateCalendarDays()

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const getPriceColor = (price: number) => {
    if (price === 0) return "text-gray-400"
    if (price === minPrice) return "text-green-600"
    if (price === maxPrice) return "text-red-600"
    return "text-orange-600"
  }

  const getPriceBg = (price: number) => {
    if (price === 0) return "bg-gray-50"
    if (price === minPrice) return "bg-green-50 border-green-200 rounded"
    if (price === maxPrice) return "bg-red-50 border-red-200 rounded"
    return "bg-orange-50 border-orange-200 rounded"
  }

  const handleDayClick = (dateKey: string, priceData: PriceData | undefined) => {
    if (priceData && priceData.preis > 0) {
      onDayClick(dateKey, priceData)
    }
  }

  // --- Tag-Navigation (Pfeile, Keyboard, Swipe) ---
  // Hole alle Tage mit Preis
  const dayKeys = dates.filter(dateKey => results[dateKey]?.preis > 0)

  // Ermittle den aktuell ausgewählten Tag (aus Parent)
  // (Parent-Komponente muss selectedDay und onNavigateDay bereitstellen)

  // Swipe-Handling
  const touchStartX = React.useRef<number | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(deltaX) > 50) {
      if (deltaX < 0) {
        // Swipe nach links → nächster Tag
        onNavigateDay && onNavigateDay(1)
      } else {
        // Swipe nach rechts → vorheriger Tag
        onNavigateDay && onNavigateDay(-1)
      }
    }
    touchStartX.current = null
  }

  // Keyboard-Handling
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onNavigateDay && onNavigateDay(-1)
      } else if (e.key === 'ArrowRight') {
        onNavigateDay && onNavigateDay(1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNavigateDay])

  // Fortschritt und Zeitmessung mit Progress-API
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(Date.now())
  const [progressData, setProgressData] = useState<{
    queueSize?: number
    estimatedTimeRemaining?: number
    totalUsers?: number
  }>({})

  // Ref to control polling state
  const pollingRef = React.useRef<boolean>(false)

  // Popup bei Tab-Wechsel/-Schließen während Suche
  const [showAbortModal, setShowAbortModal] = useState(false)
  const [cancelNotificationSent, setCancelNotificationSent] = useState(false)
  const [userCancelled, setUserCancelled] = useState(false)
  
  useEffect(() => {
    if (!isStreaming || !sessionId) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      // Sofort Backend informieren (nur einmal)
      if (!cancelNotificationSent) {
        setCancelNotificationSent(true)
        navigator.sendBeacon(`/api/search-prices/cancel-search`, JSON.stringify({ 
          sessionId, 
          reason: 'page_unload' 
        }))
      }
      setShowAbortModal(true)
      return ''
    }

    const handleVisibilityChange = () => {
      if (document.hidden && isStreaming && sessionId && !cancelNotificationSent) {
        // Sofort Backend informieren (nur einmal)
        setCancelNotificationSent(true)
        fetch(`/api/search-prices/cancel-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, reason: 'page_hidden' }),
          keepalive: true
        }).catch(() => {})
        setShowAbortModal(true)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isStreaming, sessionId])

  // Wenn das Abbruch-Popup angezeigt wird, Suche abbrechen (wie bei manuellem Abbruch)
  useEffect(() => {
    if (showAbortModal && onCancelSearch) {
      onCancelSearch()
    }
  }, [showAbortModal, onCancelSearch])

  // Timer für vergangene Zeit
  useEffect(() => {
    if (!isStreaming) return
    setElapsed(0)
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isStreaming, startTime])

  
  useEffect(() => {
    if (!sessionId || !isStreaming) {
      pollingRef.current = false
      return
    }

    pollingRef.current = true

    const pollProgress = async () => {
      if (!pollingRef.current) return

      try {
        const response = await fetch(`/api/search-progress?sessionId=${sessionId}`)
        if (response.ok) {
          const data = await response.json()
          setProgressData({
            queueSize: data.queueSize,
            estimatedTimeRemaining: data.estimatedTimeRemaining,
            totalUsers: data.totalUsers
          })
        }
      } catch (error) {
        console.warn('Could not fetch progress data:', error)
      }

      // Schedule next poll only if still polling
      if (pollingRef.current) {
        setTimeout(pollProgress, 1000)
      }
    }

    // Start initial poll
    pollProgress()

    return () => {
      pollingRef.current = false
    }
  }, [sessionId, isStreaming, startTime])

  const totalDays = expectedDateRange.length > 0 ? expectedDateRange.length : (expectedDays || (searchParams?.dayLimit ? parseInt(searchParams.dayLimit) : resultDates.length))
  const completedDays = Object.values(results).filter(r => r && r.preis !== undefined).length
  const isCompleteNow = totalDays > 0 && completedDays >= totalDays
  const progressPercentage = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0
  const displayProgress = (!isStreaming || isCompleteNow) ? 100 : progressPercentage

  // Stoppe Polling sofort, wenn alle Tage fertig sind (auch wenn isStreaming noch true ist)
  useEffect(() => {
    if (isStreaming && isCompleteNow) {
      pollingRef.current = false
    }
  }, [isStreaming, isCompleteNow])

  // Verwende echte ETA von Progress-API oder realistischen Fallback
  const estimatedTimeRemaining = isStreaming ? (
    progressData.estimatedTimeRemaining || 
    // Fallback: Realistische Schätzung basierend auf verbleibenden Tagen
    Math.max(1, Math.min((totalDays - completedDays) * 1.5, 60)) // Max 1 Minute als Fallback
  ) : 0

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return (
    <>
      {/* Fortschritt und Zeit */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 pb-0">
        <div className="flex items-center gap-2 text-sm text-blue-800">
          {/* <span className="text-2xl">🚂</span> */}
          <span className="font-semibold">Suche Bestpreise</span>
          {startStation && zielStation && (
            <span className="text-blue-600">{startStation.name} → {zielStation.name}</span>
          )}
        </div>
        <div className="flex flex-row items-center justify-between text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span>Vergangene Zeit: {formatTime(elapsed)}</span>
            {isStreaming && !isCompleteNow && estimatedTimeRemaining > 0 && (
              <span className="text-blue-600">noch ca. {formatTime(estimatedTimeRemaining)}</span>
            )}
            {(!isStreaming || isCompleteNow) && (
              <span className="text-green-600">✓ Abgeschlossen</span>
            )}
            {userCancelled && isStreaming && !isCompleteNow && (
              <span className="text-orange-600">🛑 Wird abgebrochen...</span>
            )}
          </div>
          {isStreaming && !isCompleteNow && onCancelSearch && (
            <button
              onClick={() => {
                setUserCancelled(true)
                onCancelSearch()
              }}
              className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors ml-2"
            >
              🛑 Abbrechen
            </button>
          )}
        </div>
      </div>

      {/* Fortschrittsbalken */}
      <div className="px-2 pt-0">
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>Tag {completedDays} von {totalDays}</span>
          <span>{displayProgress}%</span>
        </div>
        <div className="w-full h-2 bg-blue-100 rounded">
          <div
            className={`h-2 rounded transition-all ${(!isStreaming || isCompleteNow) ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{width: `${displayProgress}%`}}
          />
        </div>
      </div>
      
      {/* Rate Limiting Info */}
      {isStreaming && typeof progressData.totalUsers === 'number' && progressData.totalUsers > 1 && (
        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm mx-2 mb-2 mt-3">
          <div className="flex items-center gap-2">
            <div className="text-yellow-600">⏳</div>
            <div className="text-yellow-800">
              <span className="font-medium">Mehrere Nutzer suchen gerade</span>
              <br />
              <span className="text-yellow-700">{progressData.totalUsers} aktive Suchanfragen laufen parallel</span>
            </div>
          </div>
          <div className="text-xs text-yellow-700 mt-1">
            Um die DB-API zu schonen, werden viele gleichzeitige Anfragen nacheinander abgearbeitet.
            Deine Suche kann daher etwas länger dauern. Ergebnisse werden gecacht, eine Wiederholung der Suche ist dadurch schneller.
          </div>
        </div>
      )}

      {/* Calendar Header und Legende */}
      <div className="bg-white rounded-lg border mt-4">
        {/* Calendar Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousMonth}
            disabled={currentMonth <= new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">
              {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h3>
            {/* Tag-Navigation für ausgewählten Tag (Parent muss selectedDay und onNavigateDay bereitstellen) */}
            {typeof selectedDay === 'string' && (
              <>
                <Button variant="ghost" size="icon" onClick={() => onNavigateDay && onNavigateDay(-1)} disabled={dayKeys.indexOf(selectedDay) <= 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onNavigateDay && onNavigateDay(1)} disabled={dayKeys.indexOf(selectedDay) === dayKeys.length - 1}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={goToNextMonth}
            disabled={currentMonth >= new Date(lastDate.getFullYear(), lastDate.getMonth(), 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Price Legend immer anzeigen */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center justify-center gap-4 sm:gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-100 border border-green-200 rounded"></div>
              <span className="text-green-600 font-medium">Günstigster: {minPrice > 0 ? minPrice + '€' : '– €'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-100 border border-orange-200 rounded"></div>
              <span className="text-orange-600 font-medium">Durchschnitt: {prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) + '€' : '– €'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-100 border border-red-200 rounded"></div>
              <span className="text-red-600 font-medium">Teuerster: {maxPrice > 0 ? maxPrice + '€' : '– €'}</span>
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-4"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekdays.map((day) => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dateKey = formatDateKey(day)
              const priceData = results[dateKey]
              const isCurrentMonth = day.getMonth() === currentMonth.getMonth()
              const isToday = dateKey === new Date().toISOString().split("T")[0]
              const hasPrice = priceData && priceData.preis > 0
              const hasResult = !!priceData
              const hasMultipleOptions = priceData?.allIntervals && priceData.allIntervals.length > 1
              
              // Check if this day is expected but not yet loaded (pending)
              const isExpectedDay = expectedDateRange.includes(dateKey)
              const isPendingDay = isStreaming && isExpectedDay && !hasResult

              return (
                <div
                  key={dateKey}
                  className={`
                    relative min-h-[90px] sm:min-h-[100px] p-1 sm:p-3 border rounded-lg transition-all hover:shadow-sm flex flex-col justify-between
                    ${!isCurrentMonth ? "opacity-30" : ""}
                    ${isToday ? "ring-2 ring-blue-500" : ""}
                    ${hasPrice ? getPriceBg(priceData.preis) : 
                      hasResult ? "bg-gray-50" : 
                      isPendingDay ? "bg-blue-50 border-blue-200" : "bg-white"}
                    ${hasPrice ? "cursor-pointer hover:shadow-md hover:scale-105" : ""}
                  `}
                  onClick={() => hasPrice && handleDayClick(dateKey, priceData)}
                >
                  {/* Day Number und Multiple options indicator */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs sm:text-sm font-medium text-gray-900">{day.getDate()}</div>
                    {hasMultipleOptions && (
                      <span className="text-[10px] sm:text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">{priceData.allIntervals!.length}</span>
                    )}
                    {isPendingDay && (
                      <span className="text-[10px] sm:text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </span>
                    )}
                  </div>

                  {/* Price nur anzeigen, wenn Ergebnis vorhanden */}
                  {hasResult && (
                    <div className="space-y-1 flex flex-col h-full justify-between pb-5">
                      <div>
                        <div className={`text-xs sm:text-sm font-bold ${getPriceColor(priceData.preis)}`}> 
                          {priceData.preis > 0 && (
                            <>
                              <span className="block sm:hidden">{Math.round(priceData.preis)}€</span>
                              <span className="hidden sm:block">{priceData.preis}€</span>
                            </>
                          )}
                        </div>
                        {/* Price indicators */}
                        {priceData.preis > 0 && (
                          <div className="text-[10px] sm:text-xs">
                            {priceData.preis === minPrice && <span>🏆</span>}
                            {priceData.preis === maxPrice && <span>💸</span>}
                          </div>
                        )}
                      </div>
                      {/* Departure time immer unten, absolut positioniert */}
                      {priceData.preis > 0 && priceData.abfahrtsZeitpunkt && priceData.ankunftsZeitpunkt && (
                        <div className="absolute left-1 right-1 bottom-1 text-[10px] sm:text-xs text-gray-500 text-right pointer-events-none max-w-full flex flex-col items-end">
                          {/* Mobil: Zwei Zeilen */}
                          <span className="block sm:hidden truncate">
                            {new Date(priceData.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="block sm:hidden truncate">
                            <span className="mx-1">→</span>
                            {new Date(priceData.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {/* Desktop: Eine Zeile */}
                          <span className="hidden sm:inline truncate whitespace-nowrap">
                            {new Date(priceData.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            <span className="mx-1">→</span>
                            {new Date(priceData.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Pending indicator for days being searched */}
                  {isPendingDay && (
                    <div className="flex flex-col items-center justify-center h-full text-blue-600">
                      <div className="text-[9px] sm:text-xs font-medium text-center max-w-full sm:max-w-none truncate whitespace-pre-line">
                        <span className="block sm:hidden">Wird<br/>geladen...</span>
                        <span className="hidden sm:inline">Wird geladen...</span>
                      </div>
                    </div>
                  )}

                  {/* Click indicator for bookable days entfernt */}
                  {/* Indikator für Tage ohne Fahrten: nur für geprüfte Tage */}
                  {hasResult && priceData?.preis === 0 && (
                    <div className="absolute bottom-1 right-1">
                      <span className="text-gray-400 text-xs select-none">❌</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Route Info */}
        {startStation && zielStation && (
          <div className="p-4 border-t bg-gray-50 text-center text-sm text-gray-600">
            <div className="font-medium">
              {startStation.name} → {zielStation.name}
            </div>
            <div className="text-xs mt-1">
              Klicke auf einen Tag mit Preis für alle Verbindungen • {resultDates.length} Tage durchsucht
              {isStreaming && (
                <span className="text-blue-600 ml-2">
                  (Weitere Ergebnisse werden geladen...)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Popup bei Tab-Wechsel/-Schließen während Suche */}
      {showAbortModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-lg shadow-lg p-4 max-w-sm w-full text-center">
            <div className="text-lg font-semibold mb-2">
              Suche abgebrochen
            </div>
            <div className="text-sm text-gray-600 mb-4">
              Die Suche wurde abgebrochen, weil der Tab geschlossen oder gewechselt wurde.<br/>
              Bitte lasse das Fenster aktiv, bis die Suche abgeschlossen ist.
            </div>
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAbortModal(false)}
                className="flex-1"
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
