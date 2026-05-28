'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { UrlauberfinderSearchForm, UrlauberfinderSearchParams } from '@/components/urlaubsfinder/urlaubsfinder-search-form'
import { UrlauberfinderResults } from '@/components/urlaubsfinder/urlaubsfinder-results'
import { AlertCircle } from 'lucide-react'
import { Footer } from '@/components/layout/footer'
import { BrandLogo } from '@/components/layout/brand-logo'
import { MainNavigation } from '@/components/layout/main-navigation'
import { ICE_STATIONS } from '@/lib/stations/ice-stations'
import { logError, logWarn } from '@/lib/shared/logger'

const LOG_SCOPE = "urlaubsfinder.client"

interface DestinationResult {
  destination: string
  destinationId: string
  homeStationId: string
  homeStationName: string
  outwardDate: string
  outwardPrice: number
  outwardDeparture: string
  outwardArrival: string
  outwardTransfers?: number
  outwardLegs?: any[]
  returnDate?: string
  returnPrice?: number
  returnDeparture?: string
  returnArrival?: string
  returnTransfers?: number
  returnLegs?: any[]
  totalPrice: number
  lat?: number
  lon?: number
}

interface UnavailableDestination {
  destination: string
  reason: string
  outwardPrice?: number
  returnPrice?: number
}

type QueryLike = Pick<URLSearchParams, 'get' | 'getAll'>

function buildUrlaubsfinderQuery(params: UrlauberfinderSearchParams): string {
  const query = new URLSearchParams()

  const homeStation = (params.homeStationLabel || params.homeStation || '').trim()
  if (homeStation) {
    query.set('homeStation', homeStation)
  }
  if (params.homeStationExtId) {
    query.set('homeStationExtId', params.homeStationExtId)
  }

  for (const destination of params.destinations) {
    query.append('destination', destination)
  }

  query.set('outwardDate', params.outwardDate)

  if (params.returnDate) query.set('returnDate', params.returnDate)
  if (params.alter) query.set('alter', params.alter)
  if (params.ermaessigungArt) query.set('ermaessigungArt', params.ermaessigungArt)
  if (params.ermaessigungKlasse) query.set('ermaessigungKlasse', params.ermaessigungKlasse)
  if (params.klasse) query.set('klasse', params.klasse)
  if (typeof params.schnelleVerbindungen === 'boolean') {
    query.set('schnelleVerbindungen', params.schnelleVerbindungen ? '1' : '0')
  }
  if (params.maximaleUmstiege) query.set('maximaleUmstiege', params.maximaleUmstiege)
  if (params.outwardAbfahrtAb) query.set('outwardAbfahrtAb', params.outwardAbfahrtAb)
  if (params.outwardAbfahrtBis) query.set('outwardAbfahrtBis', params.outwardAbfahrtBis)
  if (params.outwardAnkunftAb) query.set('outwardAnkunftAb', params.outwardAnkunftAb)
  if (params.outwardAnkunftBis) query.set('outwardAnkunftBis', params.outwardAnkunftBis)
  if (params.returnAbfahrtAb) query.set('returnAbfahrtAb', params.returnAbfahrtAb)
  if (params.returnAbfahrtBis) query.set('returnAbfahrtBis', params.returnAbfahrtBis)
  if (params.returnAnkunftAb) query.set('returnAnkunftAb', params.returnAnkunftAb)
  if (params.returnAnkunftBis) query.set('returnAnkunftBis', params.returnAnkunftBis)
  if (params.umstiegszeit) query.set('umstiegszeit', params.umstiegszeit)

  return query.toString()
}

function parseUrlaubsfinderQuery(searchParams: QueryLike): Partial<UrlauberfinderSearchParams> {
  const parsed: Partial<UrlauberfinderSearchParams> = {}

  const homeStation = searchParams.get('homeStation')?.trim()
  if (homeStation) parsed.homeStation = homeStation

  const homeStationExtId = searchParams.get('homeStationExtId')?.trim()
  if (homeStationExtId) parsed.homeStationExtId = homeStationExtId

  const destinations = searchParams.getAll('destination').map((item: string) => item.trim()).filter(Boolean)
  if (destinations.length > 0) parsed.destinations = destinations

  const outwardDate = searchParams.get('outwardDate')?.trim()
  if (outwardDate) parsed.outwardDate = outwardDate

  const returnDate = searchParams.get('returnDate')?.trim()
  if (returnDate) parsed.returnDate = returnDate

  const alter = searchParams.get('alter')?.trim()
  if (alter) parsed.alter = alter

  const ermaessigungArt = searchParams.get('ermaessigungArt')?.trim()
  if (ermaessigungArt) parsed.ermaessigungArt = ermaessigungArt

  const ermaessigungKlasse = searchParams.get('ermaessigungKlasse')?.trim()
  if (ermaessigungKlasse) parsed.ermaessigungKlasse = ermaessigungKlasse

  const klasse = searchParams.get('klasse')?.trim()
  if (klasse) parsed.klasse = klasse

  const schnelleVerbindungen = searchParams.get('schnelleVerbindungen')
  if (schnelleVerbindungen !== null) {
    parsed.schnelleVerbindungen = schnelleVerbindungen === '1' || schnelleVerbindungen.toLowerCase() === 'true'
  }

  const maximaleUmstiege = searchParams.get('maximaleUmstiege')?.trim()
  if (maximaleUmstiege) parsed.maximaleUmstiege = maximaleUmstiege

  const outwardAbfahrtAb = searchParams.get('outwardAbfahrtAb')?.trim()
  if (outwardAbfahrtAb) parsed.outwardAbfahrtAb = outwardAbfahrtAb

  const outwardAbfahrtBis = searchParams.get('outwardAbfahrtBis')?.trim()
  if (outwardAbfahrtBis) parsed.outwardAbfahrtBis = outwardAbfahrtBis

  const outwardAnkunftAb = searchParams.get('outwardAnkunftAb')?.trim()
  if (outwardAnkunftAb) parsed.outwardAnkunftAb = outwardAnkunftAb

  const outwardAnkunftBis = searchParams.get('outwardAnkunftBis')?.trim()
  if (outwardAnkunftBis) parsed.outwardAnkunftBis = outwardAnkunftBis

  const returnAbfahrtAb = searchParams.get('returnAbfahrtAb')?.trim()
  if (returnAbfahrtAb) parsed.returnAbfahrtAb = returnAbfahrtAb

  const returnAbfahrtBis = searchParams.get('returnAbfahrtBis')?.trim()
  if (returnAbfahrtBis) parsed.returnAbfahrtBis = returnAbfahrtBis

  const returnAnkunftAb = searchParams.get('returnAnkunftAb')?.trim()
  if (returnAnkunftAb) parsed.returnAnkunftAb = returnAnkunftAb

  const returnAnkunftBis = searchParams.get('returnAnkunftBis')?.trim()
  if (returnAnkunftBis) parsed.returnAnkunftBis = returnAnkunftBis

  const umstiegszeit = searchParams.get('umstiegszeit')?.trim()
  if (umstiegszeit) parsed.umstiegszeit = umstiegszeit

  return parsed
}

interface UrlauberfinderPageProps {
  showFooter?: boolean
}

export default function UrlauberfinderPage({ showFooter = false }: UrlauberfinderPageProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [results, setResults] = useState<DestinationResult[]>([])
  const [unavailableResults, setUnavailableResults] = useState<UnavailableDestination[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [homeStation, setHomeStation] = useState('')
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [showAbortModal, setShowAbortModal] = useState(false)
  const [abortModalMessage, setAbortModalMessage] = useState<string>('')
  const [progress, setProgress] = useState<{ processed: number; total: number; destination: string } | null>(null)
  const [bookingSearchParams, setBookingSearchParams] = useState<{
    klasse: string
    alter: string
    ermaessigungArt: string
    ermaessigungKlasse: string
    maximaleUmstiege?: string
  } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const abortReasonRef = useRef<'manual' | 'auto' | null>(null)
  const [initialFormParams, setInitialFormParams] = useState<Partial<UrlauberfinderSearchParams>>({})

  useEffect(() => {
    const parsed = parseUrlaubsfinderQuery(new URLSearchParams(window.location.search))
    setInitialFormParams(parsed)
  }, [])

  const handleSearch = async (params: UrlauberfinderSearchParams) => {
    try {
      setError(null)
      setShowAbortModal(false)
      setAbortModalMessage('')
      setResults([])
  setUnavailableResults([])
      setProgress(null)
      setIsLoading(true)
      const homeStationName = params.homeStationLabel || params.homeStation
      setHomeStation(homeStationName)
      abortReasonRef.current = null

      const queryString = buildUrlaubsfinderQuery(params)
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
      
      // Store search params for booking links
      setBookingSearchParams({
        klasse: params.klasse || 'KLASSE_2',
        alter: params.alter || 'ERWACHSENER',
        ermaessigungArt: params.ermaessigungArt || 'KEINE_ERMAESSIGUNG',
        ermaessigungKlasse: params.ermaessigungKlasse || 'KLASSENLOS',
        maximaleUmstiege: params.maximaleUmstiege,
      })
      
      // Get home station coordinates
      const homeStationData = ICE_STATIONS.find(station => station.name === homeStationName)
      if (homeStationData) {
        setHomeCoords({ lat: homeStationData.lat, lon: homeStationData.lon })
      } else {
        setHomeCoords(undefined)
      }

      abortControllerRef.current = new AbortController()

      const response = await fetch('/api/urlaubsfinder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      // Parse streaming response
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines[lines.length - 1] // Keep incomplete line in buffer

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim()

          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6))

              if (eventData.type === 'progress') {
                setProgress(eventData.data)
              } else if (eventData.type === 'result') {
                // Merge individual result immediately, keep sorted by totalPrice
                setResults(prev => {
                  const updated = [...prev, eventData.data]
                  updated.sort((a, b) => a.totalPrice - b.totalPrice)
                  return updated
                })
              } else if (eventData.type === 'results') {
                // Final sorted batch (overwrite)
                setResults(eventData.data)
              } else if (eventData.type === 'unavailable') {
                setUnavailableResults(prev => {
                  if (prev.some(item => item.destination === eventData.data.destination)) {
                    return prev
                  }
                  return [...prev, eventData.data]
                })
              } else if (eventData.type === 'unavailables') {
                setUnavailableResults(eventData.data)
              } else if (eventData.type === 'error') {
                logWarn(LOG_SCOPE, "Urlaubsfinder stream returned an error event", {
                  message: eventData.message,
                })
              }
            } catch (e) {
              logError(LOG_SCOPE, "Could not parse Urlaubsfinder stream event", e, {
                line,
              })
            }
          }
        }
      }

      setIsLoading(false)
      abortControllerRef.current = null
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (abortReasonRef.current === 'auto') {
          setAbortModalMessage('Die Suche wurde automatisch abgebrochen, weil der Tab gewechselt oder die Seite verlassen wurde. Bitte lasse das Fenster aktiv, bis die Suche abgeschlossen ist.')
          setShowAbortModal(true)
        } else {
          setAbortModalMessage('Die Suche wurde abgebrochen.')
          setShowAbortModal(true)
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten'
        setError(errorMsg)
        logError(LOG_SCOPE, "Urlaubsfinder client search failed", err)
      }
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortReasonRef.current = 'manual'
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      setAbortModalMessage('Die Suche wurde abgebrochen.')
      setShowAbortModal(true)
    }
  }

  useEffect(() => {
    if (!isLoading) return

    const abortActiveSearch = () => {
      if (abortControllerRef.current) {
        abortReasonRef.current = 'auto'
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      setIsLoading(false)
      setAbortModalMessage('Die Suche wurde automatisch abgebrochen, weil der Tab gewechselt oder die Seite verlassen wurde. Bitte lasse das Fenster aktiv, bis die Suche abgeschlossen ist.')
      setShowAbortModal(true)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        abortActiveSearch()
      }
    }

    const handlePageHide = () => {
      abortActiveSearch()
    }

    const handleBeforeUnload = () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handleBeforeUnload)

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [isLoading])

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MainNavigation active="urlaubsfinder" variant="mobile" />
              <h1 className="min-w-0">
                <BrandLogo />
              </h1>
            </div>
            <div className="hidden sm:block">
              <MainNavigation active="urlaubsfinder" />
            </div>
          </div>
        </header>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Fehler</h3>
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Search Form */}
        <section className="mb-8">
          <UrlauberfinderSearchForm
            onSearch={handleSearch}
            isSearching={isLoading}
            initialParams={initialFormParams}
          />
        </section>

        {/* Results */}
        {(results.length > 0 || unavailableResults.length > 0 || isLoading) && (
          <section className="mb-8">
            <UrlauberfinderResults
              results={results}
              unavailableResults={unavailableResults}
              isLoading={isLoading}
              homeStation={homeStation}
              homeCoords={homeCoords}
              progress={progress}
              searchParams={bookingSearchParams}
              onCancel={handleCancel}
            />
          </section>
        )}

        {showAbortModal && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[2000] p-4">
            <div className="bg-white rounded-lg shadow-lg p-5 max-w-md w-full text-center border border-gray-200">
              <div className="text-lg font-semibold mb-2 text-gray-900">Suche abgebrochen</div>
              <div className="text-sm text-gray-600 mb-4">{abortModalMessage}</div>
              <button
                onClick={() => setShowAbortModal(false)}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        )}

        <Footer show={showFooter} />
      </div>
    </div>
  )
}
