import { metricsCollector } from '@/app/api/metrics/collector'
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'
import { generateConnectionId } from './utils'

// Cache-Konfiguration
const CACHE_FRESHNESS_TTL = 60 * 60 * 1000 // 60 Minuten - nach dieser Zeit werden Daten neu abgefragt
const DATA_RETENTION_DAYS = 90 // Daten werden 90 Tage aufbewahrt
const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000
const STATION_SEARCH_RETENTION_DAYS = 7 // Station-Suche Cache wird nach 7 Tagen gelöscht
const STATION_SEARCH_RETENTION_MS = STATION_SEARCH_RETENTION_DAYS * 24 * 60 * 60 * 1000

// ENV-Variable für das Löschen vergangener Fahrten (standardmäßig aktiviert)
const CLEANUP_PAST_CONNECTIONS = process.env.CLEANUP_PAST_CONNECTIONS !== 'false'

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  recordedAt?: number
  allIntervals?: Array<{
    preis: number
    abschnitte?: Array<{
      abfahrtsZeitpunkt: string
      ankunftsZeitpunkt: string
      abfahrtsOrt: string
      ankunftsOrt: string
    }>
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt: string
    ankunftsOrt: string
    info: string
    umstiegsAnzahl: number
    isCheapestPerInterval?: boolean
  }>
}

interface TrainResults {
  [date: string]: TrainResult
}

// Initialisiere SQLite Datenbank
const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

const dbPath = join(dataDir, 'connection-cache.db')
const db = new Database(dbPath)

// Aktiviere WAL-Modus für bessere Performance
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

// Erstelle Tabellen
db.exec(`
  CREATE TABLE IF NOT EXISTS connection_cache (
    cache_key TEXT NOT NULL,
    data_compressed BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_fetched_at INTEGER NOT NULL,
    PRIMARY KEY (cache_key)
  );

  CREATE INDEX IF NOT EXISTS idx_last_fetched ON connection_cache(last_fetched_at);

  /* Legacy price_history (belassen für Abwärtskompatibilität, standardmäßig nicht mehr beschrieben) */
  CREATE TABLE IF NOT EXISTS price_history (
    connection_id TEXT NOT NULL,
    start_station_id TEXT NOT NULL,
    ziel_station_id TEXT NOT NULL,
    date TEXT NOT NULL,
    "alter" TEXT NOT NULL,
    ermaessigung_art TEXT NOT NULL,
    ermaessigung_klasse TEXT NOT NULL,
    klasse TEXT NOT NULL,
    abfahrts_zeitpunkt TEXT NOT NULL,
    ankunfts_zeitpunkt TEXT NOT NULL,
    preis REAL NOT NULL,
    info TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY (connection_id, "alter", ermaessigung_art, ermaessigung_klasse, klasse, recorded_at)
  );

  CREATE INDEX IF NOT EXISTS idx_price_history_connection ON price_history(
    start_station_id, ziel_station_id, date, "alter", ermaessigung_art, ermaessigung_klasse, klasse
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);

  /* Station search cache */
  CREATE TABLE IF NOT EXISTS station_search_cache (
    search_term TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL,
    lon REAL,
    station_type TEXT,
    products TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (search_term, ext_id)
  );

  CREATE INDEX IF NOT EXISTS idx_station_search_term ON station_search_cache(search_term);
  CREATE INDEX IF NOT EXISTS idx_station_created ON station_search_cache(created_at);
`)

// Prepared Statements
const stmtGetCache = db.prepare('SELECT data_compressed, last_fetched_at FROM connection_cache WHERE cache_key = ?')
const stmtSetCache = db.prepare(`
  INSERT OR REPLACE INTO connection_cache (cache_key, data_compressed, created_at, last_fetched_at)
  VALUES (?, ?, ?, ?)
`)
const stmtInsertPriceHistory = db.prepare(`
  INSERT OR IGNORE INTO price_history (
    connection_id, start_station_id, ziel_station_id, date, "alter", ermaessigung_art,
    ermaessigung_klasse, klasse, abfahrts_zeitpunkt, ankunfts_zeitpunkt, preis, info, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const stmtCleanupCache = db.prepare('DELETE FROM connection_cache WHERE last_fetched_at < ?')
const stmtCleanupHistory = db.prepare('DELETE FROM price_history WHERE recorded_at < ?')
const stmtGetCacheCount = db.prepare('SELECT COUNT(*) as count FROM connection_cache')
const stmtGetHistoryCount = db.prepare('SELECT COUNT(*) as count FROM price_history')

// Station search prepared statements
const stmtGetStationSearch = db.prepare(`
  SELECT ext_id, station_id, name, lat, lon, station_type, products
  FROM station_search_cache
  WHERE search_term = ?
  ORDER BY name ASC
  LIMIT 10
`)

const stmtInsertStationSearch = db.prepare(`
  INSERT OR REPLACE INTO station_search_cache 
  (search_term, ext_id, station_id, name, lat, lon, station_type, products, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const stmtCleanupStationSearch = db.prepare('DELETE FROM station_search_cache WHERE created_at < ?')

// Neue Prepared Statements für Cleanup vergangener Fahrten
const stmtCleanupPastConnectionCache = db.prepare(`
  DELETE FROM connection_cache 
  WHERE cache_key LIKE '%"date":"' || ? || '"%'
`)

const stmtCleanupPastPriceHistory = db.prepare(`
  DELETE FROM price_history 
  WHERE date < ?
`)

// Historie-Abfragen - OHNE Gruppierung nach Tag, um alle Zeitstempel zu behalten
const stmtGetDayPriceHistory = db.prepare(`
  SELECT MIN(preis) as min_preis, recorded_at
  FROM price_history
  WHERE start_station_id = ? 
    AND ziel_station_id = ? 
    AND date = ? 
    AND "alter" = ? 
    AND ermaessigung_art = ? 
    AND ermaessigung_klasse = ? 
    AND klasse = ?
  GROUP BY recorded_at
  ORDER BY recorded_at ASC
`)

const stmtGetConnectionPriceHistory = db.prepare(`
  SELECT preis, recorded_at
  FROM price_history
  WHERE connection_id = ?
    AND "alter" = ?
    AND ermaessigung_art = ?
    AND ermaessigung_klasse = ?
    AND klasse = ?
  ORDER BY recorded_at ASC
`)

// Neue Version: Hole nur Preise für Verbindungen die den Filterkriterien entsprechen
const stmtGetFilteredDayPriceHistory = db.prepare(`
  SELECT MIN(preis) as min_preis, recorded_at
  FROM price_history
  WHERE start_station_id = ? 
    AND ziel_station_id = ? 
    AND date = ? 
    AND "alter" = ? 
    AND ermaessigung_art = ? 
    AND ermaessigung_klasse = ? 
    AND klasse = ?
    AND connection_id IN (
      SELECT DISTINCT connection_id FROM price_history ph2
      WHERE ph2.start_station_id = ? 
        AND ph2.ziel_station_id = ? 
        AND ph2.date = ? 
        AND ph2."alter" = ? 
        AND ph2.ermaessigung_art = ? 
        AND ph2.ermaessigung_klasse = ? 
        AND ph2.klasse = ?
        AND ph2.recorded_at = price_history.recorded_at
    )
  GROUP BY DATE(recorded_at / 1000, 'unixepoch')
  ORDER BY recorded_at ASC
`)

// Cache-Hilfsfunktionen
export function generateCacheKey(params: {
  startStationId: string
  zielStationId: string
  date: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
  schnelleVerbindungen: boolean
  abfahrtAb?: string
  ankunftBis?: string
  umstiegszeit?: string
}): string {
  const cleanedParams = {
    startStationId: params.startStationId,
    zielStationId: params.zielStationId,
    date: params.date,
    alter: params.alter,
    ermaessigungArt: params.ermaessigungArt,
    ermaessigungKlasse: params.ermaessigungKlasse,
    klasse: params.klasse,
    schnelleVerbindungen: params.schnelleVerbindungen,
    ...(params.umstiegszeit && params.umstiegszeit !== "undefined" && { umstiegszeit: params.umstiegszeit }),
  }
  
  return JSON.stringify(cleanedParams)
}

function compressData(data: TrainResults): Buffer {
  const jsonString = JSON.stringify(data)
  return gzipSync(Buffer.from(jsonString, 'utf-8'))
}

function decompressData(compressed: Buffer): TrainResults {
  const decompressed = gunzipSync(compressed)
  return JSON.parse(decompressed.toString('utf-8'))
}

export function getCachedResult(cacheKey: string): { data: TrainResults | null; needsRefresh: boolean; recordedAt?: number } {
  try {
    const row = stmtGetCache.get(cacheKey) as { data_compressed: Buffer; last_fetched_at: number } | undefined
    
    if (!row) {
      return { data: null, needsRefresh: true }
    }
    
    const now = Date.now()
    const age = now - row.last_fetched_at
    const needsRefresh = age > CACHE_FRESHNESS_TTL
    
    const data = decompressData(row.data_compressed)
    
    if (needsRefresh) {
      console.log(`🔄 Cache entry found but stale (age: ${Math.round(age / 60000)} min)`)
    }
    
    return { data, needsRefresh, recordedAt: row.last_fetched_at }
  } catch (error) {
    console.error('❌ Error reading from cache:', error)
    return { data: null, needsRefresh: true }
  }
}

export function setCachedResult(
  cacheKey: string,
  data: TrainResults | null,
  params: {
    startStationId: string
    zielStationId: string
    date: string
    alter: string
    ermaessigungArt: string
    ermaessigungKlasse: string
    klasse: string
    schnelleVerbindungen: boolean
    umstiegszeit?: string
  }
): void {
  if (!data) return

  try {
    const now = Date.now()
    const compressed = compressData(data)
    
    // Cache-Eintrag speichern
    stmtSetCache.run(cacheKey, compressed, now, now)
    
    // Preishistorie für alle Verbindungen speichern
    for (const [dateKey, result] of Object.entries(data)) {
      // Hauptverbindung
      if (result.abfahrtsZeitpunkt && result.ankunftsZeitpunkt) {
        const umstiegsAnzahl = result.allIntervals?.find(iv => iv.abfahrtsZeitpunkt === result.abfahrtsZeitpunkt && iv.ankunftsZeitpunkt === result.ankunftsZeitpunkt)?.umstiegsAnzahl || 0
        const connectionId = generateConnectionId(
          params.startStationId,
          params.zielStationId,
          result.abfahrtsZeitpunkt,
          result.ankunftsZeitpunkt,
          umstiegsAnzahl
        )
        
        stmtInsertPriceHistory.run(
          connectionId,
          params.startStationId,
          params.zielStationId,
          params.date,
          params.alter,
          params.ermaessigungArt,
          params.ermaessigungKlasse,
          params.klasse,
          result.abfahrtsZeitpunkt,
          result.ankunftsZeitpunkt,
          result.preis,
          result.info,
          now
        )
      }
      
      // Alle Intervalle speichern
      if (result.allIntervals) {
        for (const interval of result.allIntervals) {
          const connectionId = generateConnectionId(
            params.startStationId,
            params.zielStationId,
            interval.abfahrtsZeitpunkt,
            interval.ankunftsZeitpunkt,
            interval.umstiegsAnzahl
          )
          
          stmtInsertPriceHistory.run(
            connectionId,
            params.startStationId,
            params.zielStationId,
            params.date,
            params.alter,
            params.ermaessigungArt,
            params.ermaessigungKlasse,
            params.klasse,
            interval.abfahrtsZeitpunkt,
            interval.ankunftsZeitpunkt,
            interval.preis,
            interval.info,
            now
          )
        }
      }
    }
    
    // Logging
    const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
    const historyCount = (stmtGetHistoryCount.get() as { count: number }).count
    
    if (cacheCount % 50 === 0 || cacheCount < 10) {
      console.log(`💾 Cache: ${cacheCount} entries, Price history: ${historyCount} records`)
    }
    
    metricsCollector.updateCacheMetrics(0, cacheCount)
  } catch (error) {
    console.error('❌ Error writing to cache:', error)
  }
}

// Cache-Bereinigung
function cleanupCache(): void {
  try {
    const now = Date.now()
    const cutoffTime = now - DATA_RETENTION_MS
    const stationSearchCutoff = now - STATION_SEARCH_RETENTION_MS
    
    const cacheRemoved = stmtCleanupCache.run(cutoffTime).changes
    const historyRemoved = stmtCleanupHistory.run(cutoffTime).changes
    const stationSearchRemoved = stmtCleanupStationSearch.run(stationSearchCutoff).changes
    
    if (cacheRemoved > 0 || historyRemoved > 0 || stationSearchRemoved > 0) {
      console.log(`🧹 Cleaned up -> cache: ${cacheRemoved}, history: ${historyRemoved}, station search: ${stationSearchRemoved}`)
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(0, cacheCount)
    }
    
    // Optimiere Datenbank
    db.pragma('optimize')
  } catch (error) {
    console.error('❌ Error during cache cleanup:', error)
  }
}

// Neue Funktion: Bereinige vergangene Fahrten
function cleanupPastConnections(): void {
  if (!CLEANUP_PAST_CONNECTIONS) {
    return
  }
  
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0] // Format: YYYY-MM-DD
    
    // Lösche Cache-Einträge mit Datum in der Vergangenheit
    let cacheRemoved = 0
    const allCacheKeys = db.prepare('SELECT cache_key FROM connection_cache').all() as Array<{ cache_key: string }>
    
    for (const row of allCacheKeys) {
      try {
        const parsed = JSON.parse(row.cache_key)
        if (parsed.date && parsed.date < todayStr) {
          db.prepare('DELETE FROM connection_cache WHERE cache_key = ?').run(row.cache_key)
          cacheRemoved++
        }
      } catch {
        // Ignoriere ungültige Cache-Keys
      }
    }
    
    // Lösche Preishistorie für vergangene Daten
    const historyRemoved = stmtCleanupPastPriceHistory.run(todayStr).changes
    
    if (cacheRemoved > 0 || historyRemoved > 0) {
      console.log(`🧹 Cleaned up past connections -> cache: ${cacheRemoved}, history: ${historyRemoved}`)
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(0, cacheCount)
    }
    
    // Optimiere Datenbank nach größerem Cleanup
    if (cacheRemoved > 100 || historyRemoved > 1000) {
      db.pragma('optimize')
      db.pragma('vacuum')
    }
  } catch (error) {
    console.error('❌ Error during past connections cleanup:', error)
  }
}

// Cache-Bereinigung alle 6 Stunden
// Nur in Runtime ausführen, nicht beim Build
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' || typeof window === 'undefined') {
  const isRuntime = !process.env.NEXT_PHASE || process.env.NEXT_PHASE === 'phase-production-server'
  
  if (isRuntime) {
    setInterval(cleanupCache, 6 * 60 * 60 * 1000)
    
    // Cleanup vergangener Fahrten einmal täglich (zur Mitternacht + 1 Stunde)
    const scheduleNextPastConnectionsCleanup = () => {
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(1, 0, 0, 0) // 01:00 Uhr
      
      const msUntilNextCleanup = tomorrow.getTime() - now.getTime()
      
      setTimeout(() => {
        cleanupPastConnections()
        // Plane nächsten Cleanup
        setInterval(cleanupPastConnections, 24 * 60 * 60 * 1000)
      }, msUntilNextCleanup)
      
      console.log(`⏰ Next past connections cleanup scheduled for ${tomorrow.toISOString()}`)
    }
    
    // Starte initialen Cleanup vergangener Fahrten
    if (CLEANUP_PAST_CONNECTIONS) {
      console.log('♻️ Past connections cleanup is ENABLED (set CLEANUP_PAST_CONNECTIONS=false to disable)')
      scheduleNextPastConnectionsCleanup()
      // Führe sofort einen Cleanup durch beim Start
      setTimeout(cleanupPastConnections, 5000)
    } else {
      console.log('⚠️ Past connections cleanup is DISABLED')
    }
  }
}

// Graceful Shutdown
process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  db.close()
  process.exit(0)
})

// Neue Funktion: Hole Preishistorie für einen bestimmten Tag (günstigster Preis pro Abfragezeitpunkt)
export interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

export function getDayPriceHistory(
  params: {
    startStationId: string
    zielStationId: string
    date: string
    alter: string
    ermaessigungArt: string
    ermaessigungKlasse: string
    klasse: string
  },
  connectionIds?: string[],
  timeFilters?: {
    abfahrtAb?: string
    ankunftBis?: string
  }
): PriceHistoryEntry[] {
  try {
    // Wenn keine Connection-IDs übergeben wurden, leere Liste zurückgeben
    if (!connectionIds || connectionIds.length === 0) {
      return []
    }
    
    // Filtere Connection-IDs VOR dem MIN() Aggregat
    const placeholders = connectionIds.map(() => '?').join(',')
    const query = `
      SELECT MIN(filtered.preis) as min_preis, filtered.recorded_at
      FROM (
        SELECT preis, recorded_at
        FROM price_history
        WHERE start_station_id = ? 
          AND ziel_station_id = ? 
          AND date = ? 
          AND "alter" = ? 
          AND ermaessigung_art = ? 
          AND ermaessigung_klasse = ? 
          AND klasse = ?
          AND connection_id IN (${placeholders})
      ) AS filtered
      GROUP BY filtered.recorded_at
      ORDER BY filtered.recorded_at ASC
    `
    
    const stmt = db.prepare(query)
    const rows = stmt.all(
      params.startStationId,
      params.zielStationId,
      params.date,
      params.alter,
      params.ermaessigungArt,
      params.ermaessigungKlasse,
      params.klasse,
      ...connectionIds
    ) as Array<{ min_preis: number; recorded_at: number }>
    
    return rows.map(row => ({ preis: row.min_preis, recorded_at: row.recorded_at }))
  } catch (error) {
    console.error('❌ Error reading filtered day price history:', error)
    return []
  }
}

// Neue Funktion: Hole Preishistorie für eine spezifische Verbindung
export function getConnectionPriceHistory(params: {
  connectionId: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
}): PriceHistoryEntry[] {
  try {
    const rows = stmtGetConnectionPriceHistory.all(
      params.connectionId,
      params.alter,
      params.ermaessigungArt,
      params.ermaessigungKlasse,
      params.klasse
    ) as Array<{ preis: number; recorded_at: number }>
    return rows.map(row => ({ preis: row.preis, recorded_at: row.recorded_at }))
  } catch (error) {
    console.error('❌ Error reading connection price history:', error)
    return []
  }
}

// Station Cache - NUR SQLite, kein in-memory mehr
// getCachedStation ist jetzt ein Wrapper für getCachedStationSearch
export function getCachedStation(search: string): { id: string; normalizedId: string; name: string } | null {
  const results = getCachedStationSearch(search)
  
  if (!results || results.length === 0) {
    metricsCollector.recordCacheMiss('station')
    return null
  }
  
  const station = results[0]
  console.log(`🚉 Station cache hit for: ${search}`)
  metricsCollector.recordCacheHit('station')
  
  // Normalisiere die Station-ID: Entferne den Timestamp-Parameter @p=
  const normalizedId = station.id.replace(/@p=\d+@/g, '@')
  
  return {
    id: station.id,
    normalizedId: normalizedId,
    name: station.name
  }
}

// setCachedStation ist jetzt ein Wrapper für setCachedStationSearch
export function setCachedStation(search: string, data: { id: string; normalizedId: string; name: string }): void {
  const result: StationSearchResult = {
    extId: data.id, // extId und id sind bei Einzelstation-Lookup gleich
    id: data.id,
    name: data.name
  }
  
  setCachedStationSearch(search, [result])
  
  console.log(`💾 Station cached: ${data.name}`)
}

// Neue Functions für Stationensuche mit Cache
export interface StationSearchResult {
  extId: string
  id: string
  name: string
  lat?: number
  lon?: number
  type?: string
  products?: string[]
}

export function getCachedStationSearch(searchTerm: string): StationSearchResult[] | null {
  try {
    const normalizedTerm = searchTerm.toLowerCase().trim()
    const rows = stmtGetStationSearch.all(normalizedTerm) as Array<{
      ext_id: string
      station_id: string
      name: string
      lat: number | null
      lon: number | null
      station_type: string | null
      products: string | null
    }>
    
    if (rows.length === 0) {
      return null
    }
    
    return rows.map(row => ({
      extId: row.ext_id,
      id: row.station_id,
      name: row.name,
      lat: row.lat ?? undefined,
      lon: row.lon ?? undefined,
      type: row.station_type ?? undefined,
      products: row.products ? JSON.parse(row.products) : undefined
    }))
  } catch (error) {
    console.error('❌ Error reading station search cache:', error)
    return null
  }
}

export function setCachedStationSearch(searchTerm: string, results: StationSearchResult[]): void {
  try {
    const normalizedTerm = searchTerm.toLowerCase().trim()
    const now = Date.now()
    
    for (const result of results) {
      // Skip stations without extId (required field)
      if (!result.extId || result.extId.trim() === '') {
        console.warn(`⚠️ Skipping station without extId: ${result.name}`)
        continue
      }
      
      stmtInsertStationSearch.run(
        normalizedTerm,
        result.extId,
        result.id || result.extId, // Fallback to extId if id is missing
        result.name,
        result.lat ?? null,
        result.lon ?? null,
        result.type ?? null,
        result.products ? JSON.stringify(result.products) : null,
        now
      )
    }
  } catch (error) {
    console.error('❌ Error writing station search cache:', error)
  }
}

export function getCacheSize(): number {
  try {
    return (stmtGetCacheCount.get() as { count: number }).count
  } catch {
    return 0
  }
}