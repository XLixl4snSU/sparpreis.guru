import { NextRequest, NextResponse } from 'next/server'
import { getCachedStationSearch, setCachedStationSearch, type StationSearchResult } from '@/app/api/search-prices/cache'
import { globalRateLimiter } from '@/app/api/search-prices/rate-limiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
      console.log(`🚉 Station search cache hit for: "${normalizedQuery}"`)
      return NextResponse.json({ results: cachedResults, cached: true })
    }
    
    // Use global rate limiter instead of separate token bucket
    console.log(`🔍 Fetching station search from API: "${normalizedQuery}"`)
    
    try {
      const data = await globalRateLimiter.addToQueue<Array<{
        extId: string
        id: string
        name: string
        lat?: number
        lon?: number
        type?: string
        products?: string[]
      }>>(
        `station-search-${normalizedQuery}`,
        async () => {
          const encodedQuery = encodeURIComponent(normalizedQuery)
          const url = `https://www.bahn.de/web/api/reiseloesung/orte?suchbegriff=${encodedQuery}&typ=ALL&limit=10`
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
          })
          
          if (!response.ok) {
            // Return sentinel object for rate limit handling
            if (response.status === 429) {
              return { __httpStatus: 429, __errorText: 'Rate limit exceeded' }
            }
            throw new Error(`API error: ${response.status}`)
          }
          
          return await response.json()
        },
        'station-search' // Use a specific session ID for station searches
      )
      
      // Handle sentinel object (rate limit or error)
      if (data && typeof data === 'object' && '__httpStatus' in data) {
        const status = Number((data as any).__httpStatus)
        console.error(`❌ Station search API error: ${status}`)
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
            console.warn(`⚠️ Filtering out station without extId/name: ${JSON.stringify(station)}`)
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
      
      // Cache results (only valid ones)
      if (results.length > 0) {
        setCachedStationSearch(normalizedQuery, results)
      }
      
      return NextResponse.json({ results, cached: false })
    } catch (error) {
      // Handle rate limit errors from the global rate limiter
      if (error instanceof Error && error.message.includes('429')) {
        console.log(`⏱️ Station search rate limited`)
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
    console.error('❌ Station search error:', error)
    return NextResponse.json({ results: [], error: 'Internal error' }, { status: 500 })
  }
}
