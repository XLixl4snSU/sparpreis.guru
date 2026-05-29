import { TrainSearchForm } from "@/components/bestpreissuche/train-search-form"
import { TrainResults } from "@/components/bestpreissuche/train-results"
import { Footer } from "@/components/layout/footer"
import { BrandLogo } from "@/components/layout/brand-logo"
import { MainNavigation } from "@/components/layout/main-navigation"
import { isFooterEnabled, isUrlaubsfinderEnabled } from "@/lib/shared/feature-flags"
import { redirect } from "next/navigation"

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  abfahrtAb?: string
  abfahrtBis?: string
  ankunftAb?: string
  ankunftBis?: string
  klasse?: string
  schnelleVerbindungen?: string
  nurDeutschlandTicketVerbindungen?: string
  maximaleUmstiege?: string
  umstiegszeit?: string
  wochentage?: string
}

// Helper function to get tomorrow's date in YYYY-MM-DD format
function getTomorrowISO() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().split("T")[0]
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  
  // Validate and correct dates if they're in the past
  if (params.start && params.ziel) {
    const tomorrow = getTomorrowISO()
    let needsRedirect = false
    const correctedParams = new URLSearchParams()
    
    // Copy all existing params
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        correctedParams.set(key, value)
      }
    })
    
    // Check and correct reisezeitraumAb
    if (params.reisezeitraumAb && params.reisezeitraumAb < tomorrow) {
      correctedParams.set('reisezeitraumAb', tomorrow)
      needsRedirect = true
    }
    
    // Check and correct reisezeitraumBis if it's before reisezeitraumAb
    const effectiveAb = params.reisezeitraumAb && params.reisezeitraumAb >= tomorrow 
      ? params.reisezeitraumAb 
      : tomorrow
    
    if (params.reisezeitraumBis && params.reisezeitraumBis < effectiveAb) {
      // Set reisezeitraumBis to 2 days after effectiveAb
      const abDate = new Date(effectiveAb)
      abDate.setDate(abDate.getDate() + 2)
      correctedParams.set('reisezeitraumBis', abDate.toISOString().split("T")[0])
      needsRedirect = true
    }
    
    // Redirect if any corrections were made
    if (needsRedirect) {
      redirect(`/?${correctedParams.toString()}`)
    }
  }
  
  const hasSearch = params.start && params.ziel
  const urlaubsfinderEnabled = isUrlaubsfinderEnabled()
  const footerEnabled = isFooterEnabled()

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MainNavigation active="bestpreissuche" showUrlaubsfinder={urlaubsfinderEnabled} variant="mobile" />
              <h1 className="min-w-0">
                <BrandLogo />
              </h1>
            </div>
            <div className="hidden sm:block">
              <MainNavigation active="bestpreissuche" showUrlaubsfinder={urlaubsfinderEnabled} />
            </div>
          </div>
        </header>

        <section className="mb-8">
          <TrainSearchForm searchParams={params} />
        </section>

          <section className="mb-8">
            {hasSearch ? (
                <TrainResults searchParams={params} />
            ) : <></>}
          </section>
        
        {/* Footer */}
        <Footer show={footerEnabled} />
      </div>
    </div>
  )
}
