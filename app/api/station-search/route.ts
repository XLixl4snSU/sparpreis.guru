import { NextRequest, NextResponse } from 'next/server'
import {
  getCachedStationSearch,
  rankStationSearchResults,
  recordStationSearchClick,
  setCachedStationSearch,
  type StationSearchResult,
} from '@/app/api/search-prices/cache'
import { globalRateLimiter } from '@/app/api/search-prices/rate-limiter'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logError, logWarn } from '@/lib/shared/logger'
import { fetchBahn } from '@/app/api/search-prices/bahn-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LOG_SCOPE = "station-search"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    
    if (!query || query.trim().length < 2) {
      return NextResponse.json({ results: [] })
    }
    
    const normalizedQuery = query.trim()
    
    // Check cache first
    const cachedResults = getCachedStationSearch(normalizedQuery)
    if (cachedResults) {
      metricsCollector.recordCacheHit('station')
      logDebug(LOG_SCOPE, "🚉 Station search cache hit", {
        query: normalizedQuery,
        resultCount: cachedResults.length,
        topResult: cachedResults[0]?.name,
      })
      return NextResponse.json({ results: cachedResults, cached: true })
    }
    
    // Use global rate limiter instead of separate token bucket
    metricsCollector.recordCacheMiss('station')
    logDebug(LOG_SCOPE, "🔍 Station search cache miss; fetching from Bahn API", {
      query: normalizedQuery,
    })
    
    try {
      const data = await globalRateLimiter.addToQueue<Array<{
        extId: string
        id: string
        name: string
        lat?: number
        lon?: number
        type?: string
        products?: string[]
      }> | { __httpStatus: number; __errorText: string }>(
        `station-search-${normalizedQuery}`,
        async () => {
          const encodedQuery = encodeURIComponent(normalizedQuery)
          const url = `https://www.bahn.de/web/api/reiseloesung/orte?suchbegriff=${encodedQuery}&typ=ALL&limit=10`
          const apiStartTime = Date.now()
          
          let response: Awaited<ReturnType<typeof fetchBahn>>
          try {
            response = await fetchBahn(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
              },
            })
          } catch (error) {
            metricsCollector.recordStationSearchApiRequest(Date.now() - apiStartTime, 500)
            throw error
          }

          metricsCollector.recordStationSearchApiRequest(Date.now() - apiStartTime, response.status)
          
          if (!response.ok) {
            // Return sentinel object for rate limit handling
            if (response.status === 429) {
              return { __httpStatus: 429, __errorText: 'Rate limit exceeded' }
            }
            throw new Error(`API error: ${response.status}`)
          }
          
          return await response.json<Array<{
            extId: string
            id: string
            name: string
            lat?: number
            lon?: number
            type?: string
            products?: string[]
          }>>()
        },
        'station-search' // Use a specific session ID for station searches
      )
      
      // Handle sentinel object (rate limit or error)
      if (data && typeof data === 'object' && '__httpStatus' in data) {
        const status = Number((data as any).__httpStatus)
        logWarn(LOG_SCOPE, "Station search API returned sentinel status", {
          query: normalizedQuery,
          status,
        })
        return NextResponse.json(
          { results: [], error: 'API error' },
          { status }
        )
      }
      
      // Filter out invalid stations and map to results
      const results: StationSearchResult[] = data
        .filter(station => {
          // Must have extId and name
          if (!station.extId || !station.name) {
            logWarn(LOG_SCOPE, "Ignored station search result without extId or name", {
              query: normalizedQuery,
              station,
            })
            return false
          }
          return true
        })
        .map(station => ({
          extId: station.extId,
          id: station.id || station.extId, // Fallback to extId if id is missing
          name: station.name,
          lat: station.lat,
          lon: station.lon,
          type: station.type,
          products: station.products
        }))
      const rankedResults = rankStationSearchResults(normalizedQuery, results)
      
      // Cache results (only valid ones)
      if (rankedResults.length > 0) {
        setCachedStationSearch(normalizedQuery, rankedResults)
      }
      
      return NextResponse.json({ results: rankedResults, cached: false })
    } catch (error) {
      // Handle rate limit errors from the global rate limiter
      if (error instanceof Error && error.message.includes('429')) {
        logWarn(LOG_SCOPE, "Station search was rate limited", {
          query: normalizedQuery,
        })
        return NextResponse.json(
          { results: [], error: 'Rate limit exceeded', retryAfter: 2000 },
          { 
            status: 429,
            headers: { 'Retry-After': '2' }
          }
        )
      }
      throw error
    }
  } catch (error) {
    logError(LOG_SCOPE, "Station search failed", error)
    return NextResponse.json({ results: [], error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      q?: string
      station?: Partial<StationSearchResult>
    }
    const query = body.q?.trim()
    const station = body.station

    if (!query || query.length < 2 || !station?.extId || !station.name) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    recordStationSearchClick(query, {
      extId: station.extId,
      name: station.name,
    })
    metricsCollector.recordStationSearchClick()

    logDebug(LOG_SCOPE, "👆 Station search click recorded", {
      query,
      stationName: station.name,
      stationId: station.extId,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError(LOG_SCOPE, "Station search click tracking failed", error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
