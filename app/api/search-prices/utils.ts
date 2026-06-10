import { logError } from "@/lib/shared/logger"

const LOG_SCOPE = "bestpreissuche.progress"

// Durchschnittswerte für Response-Zeiten (ms) - global für alle Sessions
let averageUncachedResponseTime = 2000 // Startwert 2s
let averageCachedResponseTime = 100 // Startwert 0.1s
const alpha = 0.2 // Glättungsfaktor für gleitenden Mittelwert

// Progress-Update-Funktion
export async function updateProgress(
  sessionId: string,
  currentDay: number,
  totalDays: number,
  currentDate: string,
  isComplete = false,
  uncachedDays?: number,
  cachedDays?: number,
  avgUncachedTime?: number,
  avgCachedTime?: number,
  queueSize?: number,
  activeRequests?: number
) {
  try {
    // Use absolute URL for server-side fetch
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    await fetch(`${baseUrl}/api/search-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        currentDay,
        totalDays,
        currentDate,
        isComplete,
        uncachedDays,
        cachedDays,
        averageUncachedResponseTime: avgUncachedTime,
        averageCachedResponseTime: avgCachedTime,
        queueSize,
        activeRequests,
      }),
    })
  } catch (error) {
    logError(LOG_SCOPE, "Could not send progress update", error, {
      sessionId,
      currentDay,
      totalDays,
      currentDate,
      isComplete,
    })
  }
}

// Update average response times
export function updateAverageResponseTimes(duration: number, isCached: boolean) {
  if (isCached) {
    averageCachedResponseTime = alpha * duration + (1 - alpha) * averageCachedResponseTime
  } else {
    averageUncachedResponseTime = alpha * duration + (1 - alpha) * averageUncachedResponseTime
  }
}

export function getAverageResponseTimes() {
  return {
    uncached: averageUncachedResponseTime,
    cached: averageCachedResponseTime
  }
}

// Hilfsfunktion für lokales Datum im Format YYYY-MM-DD
export function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, "0")
  const day = date.getDate().toString().padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Connection-ID Generierung
export function generateConnectionId(
  startStationId: string,
  zielStationId: string,
  abfahrtsZeitpunkt: string,
  ankunftsZeitpunkt: string,
  umstiegsAnzahl: number
): string {
  return `${startStationId}-${zielStationId}-${abfahrtsZeitpunkt}-${ankunftsZeitpunkt}-${umstiegsAnzahl}`
}

interface TimeFilterConfig {
  abfahrtAb?: string
  abfahrtBis?: string
  ankunftAb?: string
  ankunftBis?: string
}

function parseTimeToMinutes(timeStr: string): number | null {
  const [h, m] = timeStr.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + (m || 0)
}

function passesClockWindow(minutes: number, lower?: string, upper?: string): boolean {
  const lowerMinutes = lower ? parseTimeToMinutes(lower) : null
  const upperMinutes = upper ? parseTimeToMinutes(upper) : null

  if (lowerMinutes !== null && upperMinutes !== null) {
    if (lowerMinutes <= upperMinutes) {
      return minutes >= lowerMinutes && minutes <= upperMinutes
    }
    return minutes >= lowerMinutes || minutes <= upperMinutes
  }

  if (lowerMinutes !== null) return minutes >= lowerMinutes
  if (upperMinutes !== null) return minutes <= upperMinutes
  return true
}

export function passesTimeFilter(
  abfahrtsZeitpunkt: string,
  ankunftsZeitpunkt: string,
  filters: TimeFilterConfig
): boolean {
  if (!filters.abfahrtAb && !filters.abfahrtBis && !filters.ankunftAb && !filters.ankunftBis) return true

  const depDate = new Date(abfahrtsZeitpunkt)
  const arrDate = new Date(ankunftsZeitpunkt)
  const depMinutes = depDate.getHours() * 60 + depDate.getMinutes()
  const arrMinutes = arrDate.getHours() * 60 + arrDate.getMinutes()

  const abfahrtAbMinutes = filters.abfahrtAb ? parseTimeToMinutes(filters.abfahrtAb) : null
  const ankunftBisMinutes = filters.ankunftBis ? parseTimeToMinutes(filters.ankunftBis) : null
  const hasArrivalFilter = Boolean(filters.ankunftAb || filters.ankunftBis)

  const isSameDay = (date1: Date, date2: Date) => (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )

  const isNextDay = (depDate: Date, arrDate: Date) => {
    const nextDay = new Date(depDate)
    nextDay.setDate(depDate.getDate() + 1)
    return isSameDay(arrDate, nextDay)
  }

  // Legacy semantics for the original cross-journey window:
  // "Abfahrt ab" + "Ankunft bis" within a day excludes overnight arrivals.
  if (
    abfahrtAbMinutes !== null &&
    ankunftBisMinutes !== null &&
    !filters.abfahrtBis &&
    !filters.ankunftAb
  ) {
    if (abfahrtAbMinutes < ankunftBisMinutes) {
      return isSameDay(depDate, arrDate) && 
             depMinutes >= abfahrtAbMinutes && 
             arrMinutes <= ankunftBisMinutes
    } else {
      if (isSameDay(depDate, arrDate)) {
        return depMinutes >= abfahrtAbMinutes
      } else if (isNextDay(depDate, arrDate)) {
        return depMinutes >= abfahrtAbMinutes && arrMinutes <= ankunftBisMinutes
      }
      return false
    }
  }

  if (!passesClockWindow(depMinutes, filters.abfahrtAb, filters.abfahrtBis)) {
    return false
  }

  // Result days are departure days. Arrival-only filters such as "Ankunft bis 12:00"
  // must not match trips arriving after midnight on the following calendar day.
  if (hasArrivalFilter && !isSameDay(depDate, arrDate)) {
    return false
  }

  if (!passesClockWindow(arrMinutes, filters.ankunftAb, filters.ankunftBis)) {
    return false
  }

  // Preserve the original same-day guard when a daytime journey window is expressed
  // across departure lower bound and arrival upper bound, even with extra bounds.
  if (abfahrtAbMinutes !== null && ankunftBisMinutes !== null && abfahrtAbMinutes < ankunftBisMinutes) {
    return isSameDay(depDate, arrDate)
  }

  return true
}
