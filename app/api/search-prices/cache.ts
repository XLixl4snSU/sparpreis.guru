import { metricsCollector } from '@/app/api/metrics/collector'
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'

// Cache-Konfiguration
const CACHE_FRESHNESS_TTL = 60 * 60 * 1000 // 60 Minuten - nach dieser Zeit werden Daten neu abgefragt
const DATA_RETENTION_DAYS = 90 // Daten werden 90 Tage aufbewahrt
const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
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

export function getCachedResult(cacheKey: string): { data: TrainResults | null; needsRefresh: boolean } {
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
    
    return { data, needsRefresh }
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
      // Hauptverbindung (falls vorhanden, aber meist allIntervals)
      if (result.abfahrtsZeitpunkt && result.ankunftsZeitpunkt) {
        const umstiegsAnzahl = result.allIntervals?.find(iv => iv.abfahrtsZeitpunkt === result.abfahrtsZeitpunkt && iv.ankunftsZeitpunkt === result.ankunftsZeitpunkt)?.umstiegsAnzahl || 0
        // WICHTIG: Verwende vollständige Timestamps (mit Datum), nicht nur Uhrzeit!
        const connectionId = `${params.startStationId}-${params.zielStationId}-${result.abfahrtsZeitpunkt}-${result.ankunftsZeitpunkt}-${umstiegsAnzahl}`
        
        stmtInsertPriceHistory.run(
          connectionId,
          params.startStationId,
          params.zielStationId,
          params.date,
          params.alter,
          params.ermaessigungArt,
          params.ermaessigungKlasse,
          params.klasse,
          result.abfahrtsZeitpunkt, // Voller ISO Timestamp: 2025-11-10T21:00:00
          result.ankunftsZeitpunkt, // Voller ISO Timestamp: 2025-11-11T06:00:00
          result.preis,
          result.info,
          now
        )
      }
      
      // Alle Intervalle speichern
      if (result.allIntervals) {
        for (const interval of result.allIntervals) {
          // WICHTIG: Verwende vollständige Timestamps (mit Datum), nicht nur Uhrzeit!
          const connectionId = `${params.startStationId}-${params.zielStationId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`
          
          stmtInsertPriceHistory.run(
            connectionId,
            params.startStationId,
            params.zielStationId,
            params.date,
            params.alter,
            params.ermaessigungArt,
            params.ermaessigungKlasse,
            params.klasse,
            interval.abfahrtsZeitpunkt, // Voller ISO Timestamp: 2025-11-10T21:00:00
            interval.ankunftsZeitpunkt, // Voller ISO Timestamp: 2025-11-11T06:00:00
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
    
    const cacheRemoved = stmtCleanupCache.run(cutoffTime).changes
    const historyRemoved = stmtCleanupHistory.run(cutoffTime).changes
    
    if (cacheRemoved > 0 || historyRemoved > 0) {
      console.log(`🧹 Cleaned up ${cacheRemoved} cache entries and ${historyRemoved} history records older than ${DATA_RETENTION_DAYS} days`)
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(0, cacheCount)
    }
    
    // Optimiere Datenbank
    db.pragma('optimize')
  } catch (error) {
    console.error('❌ Error during cache cleanup:', error)
  }
}

// Cache-Bereinigung alle 6 Stunden
setInterval(cleanupCache, 6 * 60 * 60 * 1000)

export function getCacheSize(): number {
  try {
    return (stmtGetCacheCount.get() as { count: number }).count
  } catch {
    return 0
  }
}

// Station Cache bleibt wie bisher (in-memory)
interface StationCacheEntry {
  data: { id: string; normalizedId: string; name: string }
  timestamp: number
  ttl: number
}

const stationCache = new Map<string, StationCacheEntry>()
const STATION_CACHE_TTL = 72 * 60 * 60 * 1000
const MAX_STATION_CACHE_ENTRIES = 10000

function getStationCacheKey(search: string): string {
  return `station_${search.toLowerCase().trim()}`
}

export function getCachedStation(search: string): { id: string; normalizedId: string; name: string } | null {
  const cacheKey = getStationCacheKey(search)
  const entry = stationCache.get(cacheKey)
  
  if (!entry) {
    metricsCollector.recordCacheMiss('station')
    return null
  }
  
  const now = Date.now()
  const age = now - entry.timestamp
  
  if (age > entry.ttl) {
    stationCache.delete(cacheKey)
    metricsCollector.recordCacheMiss('station')
    return null
  }
  
  console.log(`🚉 Station cache hit for: ${search}`)
  metricsCollector.recordCacheHit('station')
  return entry.data
}

export function setCachedStation(search: string, data: { id: string; normalizedId: string; name: string }): void {
  const cacheKey = getStationCacheKey(search)
  
  if (stationCache.size >= MAX_STATION_CACHE_ENTRIES) {
    const oldestKey = stationCache.keys().next().value
    if (typeof oldestKey === 'string') {
      stationCache.delete(oldestKey)
    }
  }
  
  stationCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl: STATION_CACHE_TTL
  })
  
  if (stationCache.size % 100 === 0) {
    console.log(`💾 Station cache: ${stationCache.size} entries`)
  }
}

function cleanupStationCache(): void {
  const now = Date.now()
  let removed = 0
  
  for (const [key, entry] of stationCache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      stationCache.delete(key)
      removed++
    }
  }
  
  if (removed > 0) {
    console.log(`🧹 Cleaned up ${removed} expired station cache entries. Cache size: ${stationCache.size}`)
  }
}

setInterval(cleanupStationCache, 2 * 60 * 60 * 1000)

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