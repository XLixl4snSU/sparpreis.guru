"use client"

import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MapPin, ArrowRight, Euro, Calendar, Train, TrendingUp, GraduationCap, User, Percent, Shuffle, Clock, Filter, Info, Star, ChevronLeft, ChevronRight, Timer } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { recommendOne } from "@/lib/recommendation-engine"
import { AnimatePresence, motion } from "framer-motion"
import {
  createBookingLink,
  getAlterLabel,
  calculateDuration,
  getDurationMinutes
} from "@/lib/day-details-utils"
import { RecommendationCards } from "@/components/day-recommendation-cards"
import { ConnectionsTable } from "@/components/day-connections-table"
import { PriceHistoryChart, type PriceHistoryEntry } from "@/components/price-history-chart"

interface Interval {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  priceHistory?: PriceHistoryEntry[]
}

interface IntervalData {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  isCheapestPerInterval?: boolean
  priceHistory?: PriceHistoryEntry[]
}

interface PriceData {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: IntervalData[]
}

interface DayDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  date: string | null
  data: PriceData | null
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams?: any
  onNavigateDay?: (direction: number) => void // Neue Prop
  dayKeys?: string[] // Alle verfügbaren Tage
}

const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]

export function DayDetailsModal({
  isOpen,
  onClose,
  date,
  data,
  startStation,
  zielStation,
  searchParams,
  onNavigateDay,
  dayKeys = [],
}: DayDetailsModalProps) {
  const [showOnlyCheapest, setShowOnlyCheapest] = useState(true)
  const [showAllJourneyDetails, setShowAllJourneyDetails] = useState<boolean>(false)
  const [sortKey, setSortKey] = useState<'preis' | 'abfahrt' | 'ankunft' | 'umstiege' | 'dauer'>('preis')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [animationDirection, setAnimationDirection] = useState<1 | -1>(1)
  
  // Swipe-Handling für Tag-Navigation im Modal
  const touchStartX = React.useRef<number | null>(null)
  const previousDate = React.useRef<string | null>(null)
  
  // Keyboard-Handling für Tag-Navigation im Modal
  React.useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onNavigateDay) {
        setAnimationDirection(-1)
        onNavigateDay(-1)
      } else if (e.key === 'ArrowRight' && onNavigateDay) {
        setAnimationDirection(1)
        onNavigateDay(1)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onNavigateDay])

  // Track animation direction based on date changes
  React.useEffect(() => {
    if (!date || !dayKeys.length || !previousDate.current) {
      previousDate.current = date
      return
    }

    const currentIdx = dayKeys.indexOf(date)
    const prevIdx = dayKeys.indexOf(previousDate.current)
    
    if (currentIdx !== -1 && prevIdx !== -1 && currentIdx !== prevIdx) {
      setAnimationDirection(currentIdx > prevIdx ? 1 : -1)
    }
    
    previousDate.current = date
  }, [date, dayKeys])

  // Define SortKey type for table sorting
  type SortKey = 'preis' | 'abfahrt' | 'ankunft' | 'umstiege' | 'dauer'

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || !onNavigateDay) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(deltaX) > 100) {
      if (deltaX < 0) {
        setAnimationDirection(1)
        onNavigateDay(1)
      } else {
        setAnimationDirection(-1)
        onNavigateDay(-1)
      }
    }
    touchStartX.current = null
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIntervals(list: IntervalData[]): IntervalData[] {
    return [...list].sort((a, b) => {
      let valA: number = 0
      let valB: number = 0
      switch (sortKey) {
        case 'abfahrt':
          valA = new Date(a.abfahrtsZeitpunkt).getTime(); valB = new Date(b.abfahrtsZeitpunkt).getTime(); break
        case 'ankunft':
          valA = new Date(a.ankunftsZeitpunkt).getTime(); valB = new Date(b.ankunftsZeitpunkt).getTime(); break
        case 'umstiege':
          valA = a.umstiegsAnzahl || 0; valB = b.umstiegsAnzahl || 0; break
        case 'dauer':
          valA = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime();
          valB = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime();
          break
        case 'preis':
        default:
          // Erst nach Preis, dann nach Reisedauer sortieren
          const priceDiff = sortDir === 'asc' ? a.preis - b.preis : b.preis - a.preis
          if (priceDiff !== 0) return priceDiff
          
          // Bei gleichem Preis: nach Reisedauer sortieren (kürzere Dauer zuerst)
          const durationA = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
          const durationB = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
          return durationA - durationB
      }
      return sortDir === 'asc' ? valA - valB : valB - valA
    })
  }

  if (!date || !data) return null

  const dateObj = new Date(date)
  const formattedDate = dateObj.toLocaleDateString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const shortDate = dateObj.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })

  const intervals = data.allIntervals || []
  
  // Filter intervals based on toggle state
  const displayedIntervals = showOnlyCheapest 
    ? (() => {
        // Filter by isCheapestPerInterval flag (günstigste pro Zeitfenster)
        const markedCheapest = intervals.filter(interval => interval.isCheapestPerInterval === true)
        // If no intervals are marked as cheapest, fall back to showing all intervals
        // (this maintains backward compatibility if the backend doesn't set the flag)
        if (markedCheapest.length === 0 && intervals.length > 0) {
          console.warn('No intervals marked as cheapest per time slot, showing all intervals')
          return sortIntervals(intervals)
        }
        return sortIntervals(markedCheapest)
      })()
    : sortIntervals(intervals)

  // Check if this is a weekend
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6
  
  // Check if there are multiple intervals
  const hasMultipleIntervals = intervals.length > 1
  const hasMultipleCheapestIntervals = intervals.filter(i => i.isCheapestPerInterval === true).length > 1

  // Kürzeste Reisedauer aller Verbindungen (in Minuten)
  const minDuration = intervals.length > 0 ? Math.min(...intervals.map(i => getDurationMinutes(i.abfahrtsZeitpunkt, i.ankunftsZeitpunkt))) : null

  // Empfehlungsalgorithmus - IMMER eine Empfehlung, auch bei nur einer Verbindung
  const recommendation = intervals.length > 0 ? recommendOne(intervals) : null
  const recommendedTrip = recommendation?.trip

  const getIntervalPriceColor = (price: number) => {
    const minIntervalPrice = Math.min(...intervals.map((i) => i.preis))
    const maxIntervalPrice = Math.max(...intervals.map((i) => i.preis))

    if (price === minIntervalPrice) return "text-green-600 bg-green-50"
    if (price === maxIntervalPrice) return "text-red-600 bg-red-50"
    return "text-orange-600 bg-orange-50"
  }

  const swipeDirection = animationDirection

  // Empfohlene Fahrt immer oben einfügen, falls nicht enthalten
  let displayedIntervalsWithRecommendation = displayedIntervals
  if (recommendedTrip) {
    const alreadyIncluded = displayedIntervals.some(
      i => i.abfahrtsZeitpunkt === recommendedTrip.abfahrtsZeitpunkt &&
           i.ankunftsZeitpunkt === recommendedTrip.ankunftsZeitpunkt &&
           i.preis === recommendedTrip.preis
    )
    if (!alreadyIncluded) {
      displayedIntervalsWithRecommendation = [recommendedTrip, ...displayedIntervals]
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-6xl max-h-[95vh] overflow-y-auto sm:px-4 px-3 sm:m-0 rounded-lg shadow-lg border bg-white"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Calendar className="h-5 w-5 text-blue-600" />
            <span className="hidden sm:inline">{formattedDate}</span>
            <span className="sm:hidden">{shortDate}</span>
            {isWeekend && <Badge variant="secondary">Wochenende</Badge>}
          </DialogTitle>
        </DialogHeader>
        {/* Desktop: Tag-Navigation Pfeile unterhalb des Headers */}
        {onNavigateDay && dayKeys.length > 1 && (
          <>
            {/* Desktop */}
            <div className="hidden md:flex items-center justify-center gap-2 pb-2 border-b">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setAnimationDirection(-1)
                  onNavigateDay(-1)
                }}
                disabled={!date || dayKeys.indexOf(date) <= 0
                }
                className="h-8 px-3"
                title="Vorheriger Tag (Pfeil links)"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Vorheriger Tag
              </Button>
              <span className="text-sm text-gray-500 mx-4 bg-gray-100 px-3 py-1 rounded">
                Tag {date && dayKeys.indexOf(date) + 1} von {dayKeys.length}
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setAnimationDirection(1)
                  onNavigateDay(1)
                }}
                disabled={!date || dayKeys.indexOf(date) >= dayKeys.length - 1}
                className="h-8 px-3"
                title="Nächster Tag (Pfeil rechts)"
              >
                Nächster Tag
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            {/* Mobile: Kompaktere, kleinere Pfeile unter dem Datum */}
            <div className="flex md:hidden items-center justify-center gap-2 py-0 mt-0 mb-0">
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => {
                  setAnimationDirection(-1)
                  onNavigateDay(-1)
                }}
                disabled={!date || dayKeys.indexOf(date) <= 0}
                className="h-8 w-8"
                title="Vorheriger Tag"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="text-sm text-gray-700 font-medium">
                {date && dayKeys.indexOf(date) + 1}/{dayKeys.length}
              </span>
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => {
                  setAnimationDirection(1)
                  onNavigateDay(1)
                }}
                disabled={!date || dayKeys.indexOf(date) >= dayKeys.length - 1}
                className="h-8 w-8"
                title="Nächster Tag"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </>
        )}

        {/* Swipe-Hinweis für Mobile */}
        {onNavigateDay && dayKeys.length > 1 && (
          <div className="md:hidden text-center text-xs text-gray-400 pb-0 pt-0">
            💡 Wische nach links/rechts um zwischen Tagen zu wechseln
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={date}
            initial={{ opacity: 0, x: animationDirection * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: animationDirection * -40 }}
            transition={{ duration: 0.25 }}
          >
            <div className="space-y-6">
              {/* Strecken-Info Header */}
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <div className="flex items-center gap-2 text-blue-700 text-lg font-semibold mb-3">
                  <MapPin className="h-5 w-5" />
                  <span>{startStation?.name}</span>
                  <ArrowRight className="h-5 w-5 text-gray-400" />
                  <span>{zielStation?.name}</span>
                </div>
                {/* Gruppe 1: Reisende & Ticket */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-700">
                  <div className="flex items-center gap-1">
                    <User className="w-4 h-4" />
                    {getAlterLabel(searchParams.alter)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Train className="w-4 h-4" />
                    {searchParams.klasse === "KLASSE_1" ? "1. Klasse" : "2. Klasse"}
                  </div>
                  <div className="flex items-center gap-1">
                    <Percent className="w-4 h-4" />
                    {searchParams.ermaessigungArt === "KEINE_ERMAESSIGUNG"
                      ? "Keine Ermäßigung"
                      : `${searchParams.ermaessigungArt === "BAHNCARD25" ? "BahnCard 25" : searchParams.ermaessigungArt === "BAHNCARD50" ? "BahnCard 50" : searchParams.ermaessigungArt}, ${searchParams.ermaessigungKlasse === "KLASSE_1" ? "1. Kl." : "2. Kl."}`}
                  </div>
                </div>
                {/* Gruppe 2: Reiseoptionen */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-700 mt-2 pt-2 border-t border-blue-100">
                  {searchParams.abfahrtAb && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      Abfahrt ab: {searchParams.abfahrtAb} Uhr
                    </div>
                  )}
                  {searchParams.ankunftBis && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      Ankunft bis: {searchParams.ankunftBis} Uhr
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Shuffle className="w-4 h-4" />
                    max. Umstiege: {searchParams.maximaleUmstiege || "Unbegrenzt"}
                  </div>
                  {searchParams.umstiegszeit && searchParams.umstiegszeit !== "normal" && (
                    <div className="flex items-center gap-1">
                      <Timer className="w-4 h-4" />
                      min. Umstiegszeit: {searchParams.umstiegszeit} min
                    </div>
                  )}
                </div>
              </div>

              {/* Preishistorie für den Tag */}
              {data.priceHistory && data.priceHistory.length > 1 && (
                <PriceHistoryChart history={data.priceHistory} title="Preisentwicklung für diesen Tag" />
              )}

              {/* Top-Optionen: Bestpreis vs. KI-Empfehlung */}
              <RecommendationCards
                data={data}
                intervals={intervals}
                recommendation={recommendation}
                recommendedTrip={recommendedTrip}
                startStation={startStation}
                zielStation={zielStation}
                searchParams={searchParams}
                calculateDuration={calculateDuration}
                createBookingLink={createBookingLink}
              />

              {/* Kompakte Preisstatistik über der Tabelle */}
              {hasMultipleIntervals && (
                <div className="bg-yellow-50 border border-yellow-200 rounded px-3 py-2 mb-2 text-xs flex flex-wrap gap-4 justify-center">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Günstigste:</span>
                    <span className="font-bold text-green-600">{Math.min(...intervals.map((i: any) => i.preis))}€</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Durchschnitt:</span>
                    <span className="font-bold text-blue-600">{Math.round(intervals.reduce((sum: number, i: any) => sum + i.preis, 0) / intervals.length)}€</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600">Teuerste:</span>
                    <span className="font-bold text-red-600">{Math.max(...intervals.map((i: any) => i.preis))}€</span>
                  </div>
                </div>
              )}

              {/* All Available Connections */}
              <ConnectionsTable
                intervals={intervals}
                displayedIntervals={displayedIntervalsWithRecommendation}
                hasMultipleIntervals={hasMultipleIntervals}
                minDuration={minDuration}
                data={data}
                recommendedTrip={recommendedTrip}
                startStation={startStation}
                zielStation={zielStation}
                searchParams={searchParams}
                sortKey={sortKey}
                sortDir={sortDir}
                handleSort={handleSort}
                getIntervalPriceColor={getIntervalPriceColor}
                calculateDuration={calculateDuration}
                getDurationMinutes={getDurationMinutes}
                recommendation={recommendation}
                createBookingLink={createBookingLink}
                showOnlyCheapest={showOnlyCheapest}
                setShowOnlyCheapest={setShowOnlyCheapest}
                showAllJourneyDetails={showAllJourneyDetails}
                setShowAllJourneyDetails={setShowAllJourneyDetails}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}