import { globalRateLimiter } from './rate-limiter'
import {
  generateCacheKey,
  getCachedResult,
  setCachedResult,
  getCachedStation,
  setCachedStation,
  getDayPriceHistory,
  getConnectionPriceHistory,
  type PriceHistoryEntry
} from './cache'
import { metricsCollector } from '@/app/api/metrics/collector'
import { formatDateKey } from './utils';




// Station search function
export async function searchBahnhof(search: string): Promise<{ id: string; normalizedId: string; name: string } | null> {
  if (!search) return null

  // Prüfe Cache zuerst
  const cachedResult = getCachedStation(search)
  if (cachedResult) {
    return cachedResult
  }

  try {
    const encodedSearch = encodeURIComponent(search)
    const url = `https://www.bahn.de/web/api/reiseloesung/orte?suchbegriff=${encodedSearch}&typ=ALL&limit=10`

    console.log(`🌐 Station API call: "${search}"`)

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
        Accept: "application/json",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        Referer: "https://www.bahn.de/",
      },
    })

    if (!response.ok) return null

    const data = await response.json()
    if (!data || data.length === 0) return null

    const station = data[0]
    const originalId = station.id

    // Normalisiere die Station-ID: Entferne den Timestamp-Parameter @p=
    const normalizedId = originalId.replace(/@p=\d+@/g, '@')

    console.log(`✅ Found station: ${station.name}`)

    const result = { 
      id: originalId,           // Für API-Aufrufe
      normalizedId: normalizedId, // Für Cache-Keys
      name: station.name 
    }

    // Cache das Ergebnis für 24 Stunden
    setCachedStation(search, result)

    return result
  } catch (error) {
    console.error("Error in searchBahnhof:", error)
    return null
  }
}

interface IntervalAbschnitt {
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  abfahrtsOrtExtId?: string
  ankunftsOrtExtId?: string
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

interface IntervalDetails {
  preis: number
  abschnitte: IntervalAbschnitt[]
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl: number
  isCheapestPerInterval?: boolean
  priceHistory?: PriceHistoryEntry[]
}

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  allIntervals?: IntervalDetails[]
  priceHistory?: PriceHistoryEntry[]
}

interface TrainResults {
  [date: string]: TrainResult
}

// Main API call function for best price search
export async function getBestPrice(config: any): Promise<{ result: TrainResults | null; wasApiCall: boolean; recordedAt: number }> {
  const dateObj = config.anfrageDatum as Date
  const sessionId = config.sessionId // Session ID von der Hauptanfrage
  // Format date like the working curl: "2025-07-26T08:00:00"
  const datum = formatDateKey(dateObj) + "T08:00:00"
  const tag = formatDateKey(dateObj)


  // Cache-Key generieren (ohne maximaleUmstiege, da wir alle Verbindungen cachen)
  const cacheKey = generateCacheKey({
    startStationId: config.startStationNormalizedId, // Verwende normalisierte ID
    zielStationId: config.zielStationNormalizedId,   // Verwende normalisierte ID
    date: tag,
    alter: config.alter,
    ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
    klasse: config.klasse,
    schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
    umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
  })

  // Prüfe Cache
  const cachedResult = getCachedResult(cacheKey)
  if (cachedResult.data && !cachedResult.needsRefresh) {
    console.log(`📦 Cache HIT for ${tag}`)
    metricsCollector.recordCacheHit('connection')
    
    const cachedData = cachedResult.data[tag]
    if (cachedData && cachedData.allIntervals) {
      // Zeitfilterung auf gecachte Daten anwenden - KORRIGIERT mit Datum-Check!
      const filteredIntervals = cachedData.allIntervals.filter((interval: any) => {
        if (!config.abfahrtAb && !config.ankunftBis) return true
        
        const depDate = new Date(interval.abfahrtsZeitpunkt)
        const arrDate = new Date(interval.ankunftsZeitpunkt)
        const depMinutes = depDate.getHours() * 60 + depDate.getMinutes()
        const arrMinutes = arrDate.getHours() * 60 + arrDate.getMinutes()
        
        // Parse Filterzeiten
        const abfahrtAbMinutes = config.abfahrtAb ? (() => { const [h, m] = config.abfahrtAb.split(":").map(Number); return h * 60 + (m || 0) })() : null
        const ankunftBisMinutes = config.ankunftBis ? (() => { const [h, m] = config.ankunftBis.split(":").map(Number); return h * 60 + (m || 0) })() : null

        // Helper: Check if dates are same day
        const isSameDay = (date1: Date, date2: Date) => (
          date1.getFullYear() === date2.getFullYear() &&
          date1.getMonth() === date2.getMonth() &&
          date1.getDate() === date2.getDate()
        )

        // Helper: Check if arrival is next day
        const isNextDay = (depDate: Date, arrDate: Date) => {
          const nextDay = new Date(depDate)
          nextDay.setDate(depDate.getDate() + 1)
          return isSameDay(arrDate, nextDay)
        }

        // Beide Filter gesetzt
        if (abfahrtAbMinutes !== null && ankunftBisMinutes !== null) {
          if (abfahrtAbMinutes < ankunftBisMinutes) {
            // Zeitfenster innerhalb eines Tages (z.B. 05:00–20:00 Uhr): Nur Tagesverbindungen
            return isSameDay(depDate, arrDate) && 
                   depMinutes >= abfahrtAbMinutes && 
                   arrMinutes <= ankunftBisMinutes
          } else {
            // Zeitfenster über Mitternacht (z.B. 22–06 Uhr): Nachtverbindungen erlauben
            if (isSameDay(depDate, arrDate)) {
              // Abfahrt und Ankunft am selben Tag
              return depMinutes >= abfahrtAbMinutes
            } else if (isNextDay(depDate, arrDate)) {
              // Ankunft am Folgetag
              return depMinutes >= abfahrtAbMinutes && arrMinutes <= ankunftBisMinutes
            }
            return false
          }
        }
        
        // Nur abfahrtAb gesetzt
        if (abfahrtAbMinutes !== null) {
          return depMinutes >= abfahrtAbMinutes
        }
        
        // Nur ankunftBis gesetzt
        if (ankunftBisMinutes !== null) {
          if (isSameDay(depDate, arrDate)) {
            return arrMinutes <= ankunftBisMinutes
          } else if (isNextDay(depDate, arrDate)) {
            // Nachtverbindungen: nur wenn Abfahrt nach Ankunftszeit liegt
            return arrMinutes <= ankunftBisMinutes && depMinutes > arrMinutes
          }
          return false
        }
        
        // Kein Filter: alles erlauben
        return true
      })
      
      // Umstiegs-Filterung auf gecachte Daten anwenden
      const umstiegsFilteredIntervals = filteredIntervals.filter((interval: any) => {
        // Wenn kein Filter gesetzt ist (undefined, null, "alle"), alle Verbindungen erlauben
        if (config.maximaleUmstiege === undefined || 
            config.maximaleUmstiege === null || 
            config.maximaleUmstiege === "") {
          return true // Alle Verbindungen
        }
        // Nur Direktverbindungen
        if (config.maximaleUmstiege === 0 || config.maximaleUmstiege === "0") {
          return interval.umstiegsAnzahl === 0
        }
        // Maximal X Umstiege
        return interval.umstiegsAnzahl <= Number(config.maximaleUmstiege)
      })
      
      console.log(`🔍 Cache: filtered ${filteredIntervals.length} -> ${umstiegsFilteredIntervals.length} intervals`)
      
      if (umstiegsFilteredIntervals.length === 0) {
        return {
          result: { [tag]: { preis: 0, info: "Keine Verbindungen im gewählten Zeitraum/mit gewählten Umstiegs-Optionen!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "", allIntervals: [] } },
          wasApiCall: false,
          recordedAt: cachedResult.recordedAt ?? Date.now()
        }
      }
      
      // Finde günstigste Verbindung
      const minPreis = Math.min(...umstiegsFilteredIntervals.map((iv: any) => iv.preis))
      const bestInterval = umstiegsFilteredIntervals.find((interval: any) => interval.preis === minPreis)
      
      // Erstelle Connection-IDs für gefilterte Verbindungen
      const filteredConnectionIds = umstiegsFilteredIntervals.map((interval: any) => 
        `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`
      )
      
      // Lade Preishistorie nur für die gefilterten Connection-IDs
      const dayPriceHistory = getDayPriceHistory({
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse
      }, filteredConnectionIds)
      
      const intervalsWithHistory = umstiegsFilteredIntervals.map((interval: any) => ({
        ...interval,
        priceHistory: getConnectionPriceHistory({
          connectionId: `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        })
      }))
      const filteredResult = {
        [tag]: {
          preis: minPreis,
          info: bestInterval?.info || "",
          abfahrtsZeitpunkt: bestInterval?.abfahrtsZeitpunkt || "",
          ankunftsZeitpunkt: bestInterval?.ankunftsZeitpunkt || "",
          allIntervals: intervalsWithHistory.sort((a: any, b: any) => a.preis - b.preis) as IntervalDetails[],
          priceHistory: dayPriceHistory
        }
      }
      return { result: filteredResult, wasApiCall: false, recordedAt: cachedResult.recordedAt ?? Date.now() }
    }
    // Fallback für alte Cache-Einträge ohne allIntervals
    if (cachedData) {
      // Für alte Cache-Einträge ohne Filter-Info
      const allConnectionIds = Array.isArray(cachedData.allIntervals)
        ? cachedData.allIntervals.map((iv: any) => 
            `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${iv.abfahrtsZeitpunkt}-${iv.ankunftsZeitpunkt}-${iv.umstiegsAnzahl ?? 0}`
          )
        : []
      
      const normalizedCachedData: TrainResult = {
        ...cachedData,
        priceHistory: getDayPriceHistory({
          startStationId: config.startStationNormalizedId,
          zielStationId: config.zielStationNormalizedId,
          date: tag,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        }, allConnectionIds), // KEINE timeFilters
        allIntervals: Array.isArray(cachedData.allIntervals)
          ? cachedData.allIntervals.map((iv: any) => ({
              ...iv,
              priceHistory: getConnectionPriceHistory({
                connectionId: `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${iv.abfahrtsZeitpunkt}-${iv.ankunftsZeitpunkt}-${iv.umstiegsAnzahl ?? 0}`,
                alter: config.alter,
                ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
                klasse: config.klasse
              }),
              abschnitte: Array.isArray(iv.abschnitte)
                ? iv.abschnitte.map((a: any) => ({
                    abfahrtsZeitpunkt: a.abfahrtsZeitpunkt,
                    ankunftsZeitpunkt: a.ankunftsZeitpunkt,
                    abfahrtsOrt: a.abfahrtsOrt,
                    ankunftsOrt: a.ankunftsOrt,
                  }))
                : [],
            }))
          : [],
      }
      return { result: { [tag]: normalizedCachedData }, wasApiCall: false, recordedAt: cachedResult.recordedAt ?? Date.now() }
    }
  }

  // Wenn Cache veraltet oder nicht vorhanden, fahre mit API-Call fort
  if (cachedResult.needsRefresh) {
    console.log(`🔄 Cache HIT but stale for ${tag}, refreshing`)
  } else {
    console.log(`❌ Cache MISS for ${tag}`)
    metricsCollector.recordCacheMiss('connection')
  }

  // Match the EXACT working curl request structure
  const requestBody: any = {
    abfahrtsHalt: config.abfahrtsHalt,
    anfrageZeitpunkt: datum,
    ankunftsHalt: config.ankunftsHalt,
    ankunftSuche: "ABFAHRT",
    klasse: config.klasse,
    produktgattungen: ["ICE", "EC_IC", "IR", "REGIONAL", "SBAHN", "BUS", "SCHIFF", "UBAHN", "TRAM", "ANRUFPFLICHTIG"],
    reisende: [
      {
        typ: config.alter, 
        ermaessigungen: [
          {
            art: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
            klasse: config.ermaessigungKlasse || "KLASSENLOS",
          },
        ],
        alter: [],
        anzahl: 1,
      },
    ],
    schnelleVerbindungen: config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true",
    sitzplatzOnly: false,
    bikeCarriage: false,
    reservierungsKontingenteVorhanden: false,
    nurDeutschlandTicketVerbindungen: false,
    deutschlandTicketVorhanden: false,
  }

  // Add minUmstiegszeit only if provided
  if (config.umstiegszeit && config.umstiegszeit !== "" && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined" && typeof config.umstiegszeit !== 'undefined') {
    requestBody.minUmstiegszeit = parseInt(config.umstiegszeit)
  }

  try {
    // API-Call über globalen Rate Limiter
    const requestId = `${tag}-${config.startStationNormalizedId}-${config.zielStationNormalizedId}`
    const apiCallResult = await globalRateLimiter.addToQueue(requestId, async () => {
      // Prüfe Session-Abbruch direkt vor API-Call
      if (sessionId && globalRateLimiter.isSessionCancelledSync(sessionId)) {
        throw new Error(`Session ${sessionId} was cancelled`)
      }
      
      console.log(`🌐 API call for ${tag}`)
      // Match the working curl headers exactly
      const response = await fetch("https://www.bahn.de/web/api/angebote/tagesbestpreis", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "Accept-Encoding": "gzip",
          Origin: "https://www.bahn.de",
          Referer: "https://www.bahn.de/buchung/fahrplan/suche",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
          Connection: "close",
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        let errorText = ""
        try {
          errorText = await response.text()
          if (response.status === 429) {
            console.log(`HTTP 429 received for ${requestId}`)
          } else {
            console.error(`HTTP ${response.status} error:`, errorText)
          }
        } catch (e) {
          // keep logs quiet for 429
          if (response.status !== 429) {
            console.error("Could not read error response")
          }
        }
        // Return sentinel instead of throwing to keep logs clean; rate limiter interprets this
        return { __httpStatus: response.status, __errorText: errorText.slice(0, 100) }
      }

      return await response.text()
    }, sessionId) // SessionId übergeben für Abbruch-Prüfung

    const responseText = apiCallResult

    // Handle sentinel results quietly (should be retried by rate limiter)
    if (typeof responseText !== 'string') {
      const status = (responseText as any)?.__httpStatus
      const errText = (responseText as any)?.__errorText || ''
      if (status === 429) {
        console.log(`ℹ️ HTTP 429 sentinel for ${tag} (will be retried by rate limiter)`) 
        const result = { [tag]: { preis: 0, info: 'Rate limited, retrying', abfahrtsZeitpunkt: '', ankunftsZeitpunkt: '' } }
        return { result, wasApiCall: true, recordedAt: Date.now() }
      }
      const result = { [tag]: { preis: 0, info: `API Error: HTTP ${status}: ${errText}`, abfahrtsZeitpunkt: '', ankunftsZeitpunkt: '' } }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    // Check if response contains error message
    if (responseText.includes("Preisauskunft nicht möglich")) {
      console.log("Price info not available for this date")
      const result = { [tag]: { preis: 0, info: "Kein Bestpreis verfügbar!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "" } }
      setCachedResult(cacheKey, result, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      console.error("Failed to parse JSON:", parseError)
      const errorResult = {
        [tag]: {
          preis: 0,
          info: "JSON Parse Error",
          abfahrtsZeitpunkt: "",
          ankunftsZeitpunkt: "",
        },
      }
      return { result: errorResult, wasApiCall: true, recordedAt: Date.now() }
    }

    if (!data || !data.intervalle) {
      console.log("No intervals found in response")
      const result = { [tag]: { preis: 0, info: "Keine Intervalle gefunden!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "" } }
      setCachedResult(cacheKey, result, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    console.log(`Found ${data.intervalle.length} intervals`)

    // Sammle alle Intervalle
    const finalAllIntervals: IntervalDetails[] = []
    
    for (const iv of data.intervalle) {
      if (iv.preis && typeof iv.preis === "object" && "betrag" in iv.preis && Array.isArray(iv.verbindungen)) {
        for (const verbindung of iv.verbindungen) {
          // Skip connections without price information
          if (!verbindung.abPreis || typeof verbindung.abPreis !== "object" || !("betrag" in verbindung.abPreis)) {
            continue
          }
          
          const newPreis = verbindung.abPreis.betrag
          
          if (verbindung.verbindung && verbindung.verbindung.verbindungsAbschnitte && verbindung.verbindung.verbindungsAbschnitte.length > 0) {
            const abschnitte = verbindung.verbindung.verbindungsAbschnitte.map((abschnitt: any) => ({
              abfahrtsZeitpunkt: abschnitt.abfahrtsZeitpunkt,
              ankunftsZeitpunkt: abschnitt.ankunftsZeitpunkt,
              abfahrtsOrt: abschnitt.abfahrtsOrt,
              ankunftsOrt: abschnitt.ankunftsOrt,
              abfahrtsOrtExtId: abschnitt.abfahrtsOrtExtId,
              ankunftsOrtExtId: abschnitt.ankunftsOrtExtId,
              verkehrsmittel: abschnitt.verkehrsmittel ? {
                produktGattung: abschnitt.verkehrsmittel.produktGattung,
                kategorie: abschnitt.verkehrsmittel.kategorie,
                name: abschnitt.verkehrsmittel.name,
                mittelText: abschnitt.verkehrsmittel.mittelText
              } : undefined
            }))
            const info = abschnitte.map((a: IntervalAbschnitt) => `${a.abfahrtsOrt} → ${a.ankunftsOrt}`).join(' | ')
            finalAllIntervals.push({
              preis: newPreis,
              abschnitte,
              abfahrtsZeitpunkt: abschnitte[0].abfahrtsZeitpunkt,
              ankunftsZeitpunkt: abschnitte[abschnitte.length-1].ankunftsZeitpunkt,
              abfahrtsOrt: abschnitte[0].abfahrtsOrt,
              ankunftsOrt: abschnitte[abschnitte.length-1].ankunftsOrt,
              info,
              umstiegsAnzahl: verbindung.verbindung.umstiegsAnzahl || 0,
              // Keine isCheapestPerInterval-Markierung hier - wird in route.ts gemacht
            })
          }
        }
      }
    }

    // Erstelle vollständigen Cache-Eintrag mit ALLEN Verbindungen (ohne Markierung)
    const fullResult = {
      [tag]: {
        preis: 0, // Wird später in route.ts gesetzt
        info: "",
        abfahrtsZeitpunkt: "",
        ankunftsZeitpunkt: "",
        allIntervals: finalAllIntervals.sort((a, b) => a.preis - b.preis), // Sort by price
      },
    }

    // Cache ALLE Daten (ohne Zeitfilter)
    setCachedResult(cacheKey, fullResult, {
      startStationId: config.startStationNormalizedId,
      zielStationId: config.zielStationNormalizedId,
      date: tag,
      alter: config.alter,
      ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
      ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
      klasse: config.klasse,
      schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
      umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
    })

    // Jetzt Zeitfilter für aktuelle Anfrage anwenden
    const timeFilteredIntervals = finalAllIntervals.filter(interval => {
      if (!config.abfahrtAb && !config.ankunftBis) return true
      
      const ersteAbfahrt = interval.abfahrtsZeitpunkt
      const letzteAnkunft = interval.ankunftsZeitpunkt
      
      let abfahrtOk = true
      let ankunftOk = true
      
      if (config.abfahrtAb) {
        const abfahrtTime = new Date(`1970-01-01T${ersteAbfahrt.split('T')[1]}`)
        const filterTime = new Date(`1970-01-01T${config.abfahrtAb}:00`)
        abfahrtOk = abfahrtTime >= filterTime
      }
      
      if (config.ankunftBis) {
        const ankunftTime = new Date(`1970-01-01T${letzteAnkunft.split('T')[1]}`)
        const filterTime = new Date(`1970-01-01T${config.ankunftBis}:00`)
        ankunftOk = ankunftTime <= filterTime
      }
      
      return abfahrtOk && ankunftOk
    })

    // Umstiegs-Filterung anwenden
    const umstiegsFilteredIntervals = timeFilteredIntervals.filter(interval => {
      if (config.maximaleUmstiege === undefined || 
          config.maximaleUmstiege === null || 
          config.maximaleUmstiege === "alle" || 
          config.maximaleUmstiege === "") {
        return true
      }
      if (config.maximaleUmstiege === 0 || config.maximaleUmstiege === "0") {
        return interval.umstiegsAnzahl === 0
      }
      return interval.umstiegsAnzahl <= Number(config.maximaleUmstiege)
    })

    console.log(`🔍 API: filtered ${timeFilteredIntervals.length} -> ${umstiegsFilteredIntervals.length} intervals`)

    if (umstiegsFilteredIntervals.length === 0) {
      console.log("No intervals remaining after transfer filtering")
      // Auch für leere Ergebnisse die Historie mit Zeitfiltern
      const emptyDayHistory = getDayPriceHistory({
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse
      }, []) // Leere Liste
      
      const result = { 
        [tag]: { 
          preis: 0, 
          info: "Keine Verbindungen mit den gewählten Umstiegs-Optionen!", 
          abfahrtsZeitpunkt: "", 
          ankunftsZeitpunkt: "", 
          allIntervals: [],
          priceHistory: emptyDayHistory
        } 
      }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    // Lade Preishistorie für diesen Tag - NUR für die gefilterten Verbindungen
    const filteredConnectionIds = umstiegsFilteredIntervals.map(interval => 
      `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`
    )
    
    const dayPriceHistory = getDayPriceHistory({
      startStationId: config.startStationNormalizedId,
      zielStationId: config.zielStationNormalizedId,
      date: tag,
      alter: config.alter,
      ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
      ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
      klasse: config.klasse
    }, filteredConnectionIds) // KEINE timeFilters mehr - IDs sind bereits gefiltert

    // Finde günstigste Verbindung für Bestpreis-Anzeige
    const bestPrice = Math.min(...umstiegsFilteredIntervals.map(iv => iv.preis))
    const bestInterval = umstiegsFilteredIntervals.find(interval => interval.preis === bestPrice)

    // Lade Preishistorie für jede Verbindung
    const sortedFilteredIntervalsWithHistory = umstiegsFilteredIntervals
      .map(interval => ({
        ...interval,
        priceHistory: getConnectionPriceHistory({
          connectionId: `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        })
      }))
      .sort((a, b) => a.preis - b.preis)

    const result = {
      [tag]: {
        preis: bestPrice,
        info: bestInterval?.info || "",
        abfahrtsZeitpunkt: bestInterval?.abfahrtsZeitpunkt || "",
        ankunftsZeitpunkt: bestInterval?.ankunftsZeitpunkt || "",
        allIntervals: sortedFilteredIntervalsWithHistory,
        priceHistory: dayPriceHistory
      },
    }

    return { result, wasApiCall: true, recordedAt: Date.now() }
    } catch (error) {
      // Spezielle Behandlung für cancelled sessions
      if (error instanceof Error && error.message.includes('was cancelled')) {
        // Kein zusätzliches Logging - wird bereits in route.ts gehandelt
        const result = {
          [tag]: {
            preis: 0,
            info: "Search cancelled",
            abfahrtsZeitpunkt: "",
            ankunftsZeitpunkt: "",
          },
        }
        return { result, wasApiCall: true, recordedAt: Date.now() }
      }
      // 429 nur informativ loggen, nicht als Fehler
      if (error instanceof Error && (error.message.includes('429') || error.message.includes('Too Many Requests'))) {
        console.log(`ℹ️ API rate limited for ${tag}: ${error.message}`)
      } else {
        console.error(`❌ API error for ${tag}:`, error instanceof Error ? error.message : error)
      }
      const result = {
        [tag]: {
          preis: 0,
          info: `API Error: ${error instanceof Error ? error.message : "Unknown"}`,
          abfahrtsZeitpunkt: "",
          ankunftsZeitpunkt: "",
        },
      }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }
}