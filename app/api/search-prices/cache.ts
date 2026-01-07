import { metricsCollector } from '@/app/api/metrics/collector'
import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'
import { generateConnectionId } from './utils'
import crypto from 'crypto'

// Cache-Konfiguration
const CACHE_FRESHNESS_TTL = 60 * 60 * 1000
const DATA_RETENTION_DAYS = 90
const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000
const STATION_SEARCH_RETENTION_DAYS = 7
const STATION_SEARCH_RETENTION_MS = STATION_SEARCH_RETENTION_DAYS * 24 * 60 * 60 * 1000
const CLEANUP_PAST_CONNECTIONS = process.env.CLEANUP_PAST_CONNECTIONS !== 'false'

// Database version for migrations
const CURRENT_DB_VERSION = 2

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

// Schema Version Management
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`)

function getCurrentSchemaVersion(): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }
  return row?.version ?? 0
}

function setSchemaVersion(version: number) {
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, Date.now())
}

// Migration: Version 0 -> 1 (Legacy Schema)
function migrateToV1() {
  console.log('📦 Creating legacy schema (v1)...')
  
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
  
  setSchemaVersion(1)
}

// Helper: Generiere eindeutigen Hash für Verbindung
function generateRouteHash(
  startStationId: string,
  zielStationId: string,
  date: string,
  departureTime: string,
  arrivalTime: string
): string {
  const data = `${startStationId}|${zielStationId}|${date}|${departureTime}|${arrivalTime}`
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16)
}

// Helper: Extrahiere extId aus Station-String
function extractStationExtId(stationCode: string): string {
  // Format: A=1@O=AMSTERDAM@X=4881700@Y=52361653@U=81@L=8496058@i=U×008015588@
  // Wir wollen nur die L=XXXXXXX (Location ID)
  const match = stationCode.match(/@L=(\d+)@/)
  if (match) {
    return match[1] // z.B. "8496058"
  }
  // Fallback: ganzen String verwenden
  return stationCode
}

// Migration: Version 1 -> 2 (Normalized Schema) - OPTIMIERT v2
function migrateToV2() {
  console.log('🔄 Migrating to normalized schema (v2)...')
  console.log('⏳ This may take a while for large databases...')
  
  const startTime = Date.now()
  
  // Erstelle neue OPTIMIERTE normalisierte Tabellen
  db.exec(`
    -- Stations (NUR extId, keine langen Strings mehr!)
    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ext_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stations_ext_id ON stations(ext_id);

    -- Verbindungsstammdaten
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_station_id INTEGER NOT NULL,
      ziel_station_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      transfers INTEGER NOT NULL,
      route_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (start_station_id) REFERENCES stations(id),
      FOREIGN KEY (ziel_station_id) REFERENCES stations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_connections_stations ON connections(start_station_id, ziel_station_id, date);
    CREATE INDEX IF NOT EXISTS idx_connections_hash ON connections(route_hash);

    -- Preis-Snapshots
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      passenger_type TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_class TEXT NOT NULL,
      travel_class TEXT NOT NULL,
      price REAL NOT NULL,
      recorded_at INTEGER NOT NULL,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_connection ON price_snapshots(connection_id, passenger_type, discount_type, discount_class, travel_class);
    CREATE INDEX IF NOT EXISTS idx_snapshots_recorded ON price_snapshots(recorded_at);
  `)

  // Migriere Daten von alter Struktur (price_history) zur neuen
  const oldDataCount = (db.prepare('SELECT COUNT(*) as count FROM price_history').get() as { count: number }).count
  
  if (oldDataCount > 0) {
    console.log(`📊 Migrating ${oldDataCount} price history entries...`)
    
    db.transaction(() => {
      const uniqueConnections = db.prepare(`
        SELECT DISTINCT 
          start_station_id,
          ziel_station_id,
          date,
          abfahrts_zeitpunkt,
          ankunfts_zeitpunkt,
          connection_id
        FROM price_history
      `).all() as Array<{
        start_station_id: string
        ziel_station_id: string
        date: string
        abfahrts_zeitpunkt: string
        ankunfts_zeitpunkt: string
        connection_id: string
      }>

      console.log(`🔗 Found ${uniqueConnections.length} unique connections`)

      // Prepared Statements
      const insertStation = db.prepare(`
        INSERT OR IGNORE INTO stations (ext_id, created_at) VALUES (?, ?)
      `)
      const getStationId = db.prepare('SELECT id FROM stations WHERE ext_id = ?')
      
      const insertConnection = db.prepare(`
        INSERT OR IGNORE INTO connections (
          start_station_id, ziel_station_id, date, 
          departure_time, arrival_time, transfers,
          route_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const getConnectionId = db.prepare('SELECT id FROM connections WHERE route_hash = ?')
      
      const insertSnapshot = db.prepare(`
        INSERT INTO price_snapshots (
          connection_id, passenger_type, discount_type,
          discount_class, travel_class, price, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      // Sammle alle einzigartigen Station-extIds (VERKÜRZT!)
      const uniqueStationExtIds = new Set<string>()
      for (const conn of uniqueConnections) {
        uniqueStationExtIds.add(extractStationExtId(conn.start_station_id))
        uniqueStationExtIds.add(extractStationExtId(conn.ziel_station_id))
      }

      console.log(`🚉 Creating ${uniqueStationExtIds.size} unique station records (using extId only)...`)
      let stationCount = 0
      for (const extId of uniqueStationExtIds) {
        insertStation.run(extId, Date.now())
        stationCount++
        if (stationCount % 100 === 0) {
          console.log(`  ✓ Processed ${stationCount}/${uniqueStationExtIds.size} stations`)
        }
      }
      console.log(`✅ Created ${stationCount} station records (avg ~${Math.round(8)} bytes per station!)`)

      // Erstelle alle Verbindungen
      let processedConnections = 0
      for (const conn of uniqueConnections) {
        const transfers = parseInt(conn.connection_id.split('-').pop() || '0')
        
        const routeHash = generateRouteHash(
          conn.start_station_id,
          conn.ziel_station_id,
          conn.date,
          conn.abfahrts_zeitpunkt,
          conn.ankunfts_zeitpunkt
        )

        // Hole Station-IDs mit extId
        const startExtId = extractStationExtId(conn.start_station_id)
        const zielExtId = extractStationExtId(conn.ziel_station_id)
        
        const startStationRow = getStationId.get(startExtId) as { id: number } | undefined
        const zielStationRow = getStationId.get(zielExtId) as { id: number } | undefined

        if (!startStationRow || !zielStationRow) {
          console.warn(`⚠️ Station not found for connection: ${conn.connection_id}`)
          continue
        }

        insertConnection.run(
          startStationRow.id,
          zielStationRow.id,
          conn.date,
          conn.abfahrts_zeitpunkt,
          conn.ankunfts_zeitpunkt,
          transfers,
          routeHash,
          Date.now()
        )

        processedConnections++
        if (processedConnections % 1000 === 0) {
          console.log(`  ✓ Processed ${processedConnections}/${uniqueConnections.length} connections`)
        }
      }

      console.log(`✅ Created ${processedConnections} connection records`)

      // Migriere alle Preis-Einträge
      const allPrices = db.prepare('SELECT * FROM price_history').all() as Array<{
        connection_id: string
        start_station_id: string
        ziel_station_id: string
        date: string
        alter: string
        ermaessigung_art: string
        ermaessigung_klasse: string
        klasse: string
        abfahrts_zeitpunkt: string
        ankunfts_zeitpunkt: string
        preis: number
        recorded_at: number
      }>

      let processedSnapshots = 0
      for (const price of allPrices) {
        const routeHash = generateRouteHash(
          price.start_station_id,
          price.ziel_station_id,
          price.date,
          price.abfahrts_zeitpunkt,
          price.ankunfts_zeitpunkt
        )

        const connection = getConnectionId.get(routeHash) as { id: number } | undefined
        
        if (connection) {
          insertSnapshot.run(
            connection.id,
            price.alter,
            price.ermaessigung_art,
            price.ermaessigung_klasse,
            price.klasse,
            price.preis,
            price.recorded_at
          )
          processedSnapshots++
        }

        if (processedSnapshots % 5000 === 0) {
          console.log(`  ✓ Migrated ${processedSnapshots}/${allPrices.length} price snapshots`)
        }
      }

      console.log(`✅ Migrated ${processedSnapshots} price snapshots`)
    })()

    console.log('💾 Backing up old price_history table...')
    db.exec(`ALTER TABLE price_history RENAME TO price_history_backup_v1;`)
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✅ Migration completed in ${duration}s`)
    
    const stationsCount = (db.prepare('SELECT COUNT(*) as count FROM stations').get() as { count: number }).count
    const newConnectionsCount = (db.prepare('SELECT COUNT(*) as count FROM connections').get() as { count: number }).count
    const newSnapshotsCount = (db.prepare('SELECT COUNT(*) as count FROM price_snapshots').get() as { count: number }).count
    
    // Realistische Speicherschätzung
    const oldAvgRowSize = 1100 // ~1.1KB pro Zeile in alter Struktur
    const newAvgRowSize = 80 // Deutlich kleiner mit extIds!
    const oldSizeKB = (oldDataCount * oldAvgRowSize) / 1024
    const newSizeKB = (stationsCount * 12 + newConnectionsCount * 80 + newSnapshotsCount * 50) / 1024
    const savingsPercent = Math.round((1 - newSizeKB / oldSizeKB) * 100)
    
    console.log(`📊 New database stats:`)
    console.log(`   - Stations: ${stationsCount} (only extId stored!)`)
    console.log(`   - Connections: ${newConnectionsCount}`)
    console.log(`   - Price snapshots: ${newSnapshotsCount}`)
    console.log(`   - Estimated storage: ${Math.round(oldSizeKB)} KB → ${Math.round(newSizeKB)} KB`)
    console.log(`   - Estimated savings: ~${savingsPercent}% (${Math.round(oldSizeKB - newSizeKB)} KB)`)
  }
  
  setSchemaVersion(2)
  
  console.log('🔧 Optimizing database...')
  db.pragma('optimize')
  db.pragma('vacuum')
  console.log('✅ Database optimization complete')
}

// Führe Migrationen aus
const currentVersion = getCurrentSchemaVersion()
console.log(`📦 Current database version: ${currentVersion}`)

if (currentVersion < 1) {
  migrateToV1()
}

if (currentVersion < 2) {
  migrateToV2()
}

// Prepared Statements für alle Versionen
const stmtGetCache = db.prepare('SELECT data_compressed, last_fetched_at FROM connection_cache WHERE cache_key = ?')
const stmtSetCache = db.prepare(`
  INSERT OR REPLACE INTO connection_cache (cache_key, data_compressed, created_at, last_fetched_at)
  VALUES (?, ?, ?, ?)
`)
const stmtGetCacheCount = db.prepare('SELECT COUNT(*) as count FROM connection_cache')

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

// V2: Prepared Statements für OPTIMIERTE normalisierte Tabellen (mit extId)
const stmtInsertStation = db.prepare(`
  INSERT OR IGNORE INTO stations (ext_id, created_at) VALUES (?, ?)
`)
const stmtGetStationId = db.prepare('SELECT id FROM stations WHERE ext_id = ?')

const stmtInsertConnection = db.prepare(`
  INSERT OR IGNORE INTO connections (
    start_station_id, ziel_station_id, date,
    departure_time, arrival_time, transfers,
    route_hash, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const stmtGetConnectionByHash = db.prepare('SELECT id FROM connections WHERE route_hash = ?')

const stmtInsertPriceSnapshot = db.prepare(`
  INSERT INTO price_snapshots (
    connection_id, passenger_type, discount_type,
    discount_class, travel_class, price, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const stmtGetConnectionPriceHistory = db.prepare(`
  SELECT ps.price as preis, ps.recorded_at
  FROM price_snapshots ps
  JOIN connections c ON ps.connection_id = c.id
  WHERE c.route_hash = ?
    AND ps.passenger_type = ?
    AND ps.discount_type = ?
    AND ps.discount_class = ?
    AND ps.travel_class = ?
  ORDER BY ps.recorded_at ASC
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
    
    stmtSetCache.run(cacheKey, compressed, now, now)
    
    db.transaction(() => {
      for (const [dateKey, result] of Object.entries(data)) {
        if (result.abfahrtsZeitpunkt && result.ankunftsZeitpunkt) {
          const umstiegsAnzahl = result.allIntervals?.find(iv => 
            iv.abfahrtsZeitpunkt === result.abfahrtsZeitpunkt && 
            iv.ankunftsZeitpunkt === result.ankunftsZeitpunkt
          )?.umstiegsAnzahl || 0
          
          savePriceSnapshot(
            params.startStationId,
            params.zielStationId,
            params.date,
            result.abfahrtsZeitpunkt,
            result.ankunftsZeitpunkt,
            umstiegsAnzahl,
            result.info,
            params.alter,
            params.ermaessigungArt,
            params.ermaessigungKlasse,
            params.klasse,
            result.preis,
            now
          )
        }
        
        if (result.allIntervals) {
          for (const interval of result.allIntervals) {
            savePriceSnapshot(
              params.startStationId,
              params.zielStationId,
              params.date,
              interval.abfahrtsZeitpunkt,
              interval.ankunftsZeitpunkt,
              interval.umstiegsAnzahl,
              interval.info,
              params.alter,
              params.ermaessigungArt,
              params.ermaessigungKlasse,
              params.klasse,
              interval.preis,
              now
            )
          }
        }
      }
    })()
    
    const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
    const connectionsCount = (db.prepare('SELECT COUNT(*) as count FROM connections').get() as { count: number }).count
    const snapshotsCount = (db.prepare('SELECT COUNT(*) as count FROM price_snapshots').get() as { count: number }).count
    
    if (cacheCount % 50 === 0 || cacheCount < 10) {
      console.log(`💾 Cache: ${cacheCount} entries | Connections: ${connectionsCount} | Snapshots: ${snapshotsCount}`)
    }
    
    metricsCollector.updateCacheMetrics(0, cacheCount)
  } catch (error) {
    console.error('❌ Error writing to cache:', error)
  }
}

// V2: Helper zum Speichern von Preis-Snapshots (mit extId)
function savePriceSnapshot(
  startStationId: string,
  zielStationId: string,
  date: string,
  departureTime: string,
  arrivalTime: string,
  transfers: number,
  info: string,
  passengerType: string,
  discountType: string,
  discountClass: string,
  travelClass: string,
  price: number,
  recordedAt: number
): void {
  // Extrahiere extIds (verkürzt!)
  const startExtId = extractStationExtId(startStationId)
  const zielExtId = extractStationExtId(zielStationId)
  
  // Stelle sicher, dass Stations existieren
  stmtInsertStation.run(startExtId, recordedAt)
  stmtInsertStation.run(zielExtId, recordedAt)
  
  const startStationRow = stmtGetStationId.get(startExtId) as { id: number } | undefined
  const zielStationRow = stmtGetStationId.get(zielExtId) as { id: number } | undefined
  
  if (!startStationRow || !zielStationRow) {
    console.warn('⚠️ Could not find station IDs')
    return
  }
  
  const routeHash = generateRouteHash(startStationId, zielStationId, date, departureTime, arrivalTime)
  
  let connection = stmtGetConnectionByHash.get(routeHash) as { id: number } | undefined
  
  if (!connection) {
    stmtInsertConnection.run(
      startStationRow.id,
      zielStationRow.id,
      date,
      departureTime,
      arrivalTime,
      transfers,
      routeHash,
      recordedAt
    )
    connection = stmtGetConnectionByHash.get(routeHash) as { id: number }
  }
  
  if (connection) {
    stmtInsertPriceSnapshot.run(
      connection.id,
      passengerType,
      discountType,
      discountClass,
      travelClass,
      price,
      recordedAt
    )
  }
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
  connectionIds?: string[]
): PriceHistoryEntry[] {
  try {
    if (!connectionIds || connectionIds.length === 0) {
      return []
    }
    
    // V2: Konvertiere connection_ids zu route_hashes
    const routeHashes: string[] = []
    for (const connId of connectionIds) {
      const parts = connId.split('-')
      // Format: startStation-zielStation-departure-arrival-transfers
      if (parts.length >= 5) {
        // Rekonstruiere departure und arrival aus den Teilen
        // parts[0] = startStation, parts[1] = zielStation
        // Alles zwischen 2 und (length-2) ist departure
        // parts[length-2] ist arrival (aber Teil davon)
        // parts[length-1] ist transfers
        
        // Besser: Suche nach dem letzten "-" und nimm alles davor für departure/arrival
        const transfersStr = parts[parts.length - 1]
        const remainingParts = parts.slice(2, parts.length - 1)
        
        // Finde den Punkt wo arrival beginnt (nach dem letzten "T" timestamp)
        let departureEndIdx = -1
        for (let i = remainingParts.length - 1; i >= 0; i--) {
          if (remainingParts[i].includes('T') && i < remainingParts.length - 1) {
            departureEndIdx = i
            break
          }
        }
        
        if (departureEndIdx >= 0) {
          const departure = remainingParts.slice(0, departureEndIdx + 1).join('-')
          const arrival = remainingParts.slice(departureEndIdx + 1).join('-')
          const hash = generateRouteHash(parts[0], parts[1], params.date, departure, arrival)
          routeHashes.push(hash)
        }
      }
    }
    
    if (routeHashes.length === 0) {
      console.warn('⚠️ Could not convert any connection IDs to route hashes')
      return []
    }
    
    const placeholders = routeHashes.map(() => '?').join(',')
    const query = `
      SELECT MIN(ps.price) as min_preis, ps.recorded_at
      FROM price_snapshots ps
      JOIN connections c ON ps.connection_id = c.id
      WHERE c.start_station_id = ?
        AND c.ziel_station_id = ?
        AND c.date = ?
        AND ps.passenger_type = ?
        AND ps.discount_type = ?
        AND ps.discount_class = ?
        AND ps.travel_class = ?
        AND c.route_hash IN (${placeholders})
      GROUP BY ps.recorded_at
      ORDER BY ps.recorded_at ASC
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
      ...routeHashes
    ) as Array<{ min_preis: number; recorded_at: number }>
    
    return rows.map(row => ({ preis: row.min_preis, recorded_at: row.recorded_at }))
  } catch (error) {
    console.error('❌ Error reading day price history:', error)
    return []
  }
}

export function getConnectionPriceHistory(params: {
  connectionId: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
}): PriceHistoryEntry[] {
  try {
    const parts = params.connectionId.split('-')
    if (parts.length < 5) return []
    
    const startStation = parts[0]
    const zielStation = parts[1]
    const transfersStr = parts[parts.length - 1]
    const remainingParts = parts.slice(2, parts.length - 1)
    
    // Finde den Punkt wo arrival beginnt
    let departureEndIdx = -1
    for (let i = remainingParts.length - 1; i >= 0; i--) {
      if (remainingParts[i].includes('T') && i < remainingParts.length - 1) {
        departureEndIdx = i
        break
      }
    }
    
    if (departureEndIdx < 0) {
      console.warn('⚠️ Could not parse connection ID:', params.connectionId)
      return []
    }
    
    const departure = remainingParts.slice(0, departureEndIdx + 1).join('-')
    const arrival = remainingParts.slice(departureEndIdx + 1).join('-')
    const date = departure.split('T')[0]
    
    const routeHash = generateRouteHash(startStation, zielStation, date, departure, arrival)
    
    const rows = stmtGetConnectionPriceHistory.all(
      routeHash,
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
      // Skip stations ohne extId (erforderliches Feld)
      if (!result.extId || result.extId.trim() === '') {
        console.warn(`⚠️ Skipping station without extId: ${result.name}`)
        continue
      }
      
      stmtInsertStationSearch.run(
        normalizedTerm,
        result.extId,
        result.id || result.extId, // Fallback zu extId wenn id fehlt
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

// Cache-Bereinigung
function cleanupCache(): void {
  try {
    const now = Date.now()
    const cutoffTime = now - DATA_RETENTION_MS
    const stationSearchCutoff = now - STATION_SEARCH_RETENTION_MS
    
    const cacheRemoved = db.prepare('DELETE FROM connection_cache WHERE last_fetched_at < ?').run(cutoffTime).changes
    const snapshotsRemoved = db.prepare('DELETE FROM price_snapshots WHERE recorded_at < ?').run(cutoffTime).changes
    const connectionsRemoved = db.prepare('DELETE FROM connections WHERE id NOT IN (SELECT DISTINCT connection_id FROM price_snapshots)').run().changes
    const stationsRemoved = db.prepare('DELETE FROM stations WHERE id NOT IN (SELECT DISTINCT start_station_id FROM connections UNION SELECT DISTINCT ziel_station_id FROM connections)').run().changes
    const stationSearchRemoved = db.prepare('DELETE FROM station_search_cache WHERE created_at < ?').run(stationSearchCutoff).changes
    
    if (cacheRemoved > 0 || snapshotsRemoved > 0 || connectionsRemoved > 0 || stationsRemoved > 0 || stationSearchRemoved > 0) {
      console.log(`🧹 Cleaned up -> cache: ${cacheRemoved}, snapshots: ${snapshotsRemoved}, connections: ${connectionsRemoved}, stations: ${stationsRemoved}, station search: ${stationSearchRemoved}`)
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(0, cacheCount)
    }
    
    db.pragma('optimize')
  } catch (error) {
    console.error('❌ Error during cache cleanup:', error)
  }
}

// Neue Funktion: Bereinige vergangene Fahrten
function cleanupPastConnections(): void {
  if (!CLEANUP_PAST_CONNECTIONS) return
  
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    
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
    
    // Lösche Verbindungen für vergangene Daten (CASCADE löscht automatisch zugehörige Snapshots)
    const connectionsRemoved = db.prepare('DELETE FROM connections WHERE date < ?').run(todayStr).changes
    
    if (cacheRemoved > 0 || connectionsRemoved > 0) {
      console.log(`🧹 Cleaned up past connections -> cache: ${cacheRemoved}, connections: ${connectionsRemoved}`)
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(0, cacheCount)
    }
    
    if (cacheRemoved > 100 || connectionsRemoved > 1000) {
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