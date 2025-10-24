import { NextRequest, NextResponse } from "next/server"
import { globalRateLimiter } from "../rate-limiter"

// GET - Prüfe ob Session abgebrochen wurde
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const isCancelled = globalRateLimiter.isSessionCancelledSync(sessionId)
    
    return NextResponse.json({
      isCancelled,
      sessionId
    })
  } catch (error) {
    console.error("Error checking cancel status:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST - Session als abgebrochen markieren
export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { sessionId, reason = 'user_request' } = data
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    // Prüfe ob Session bereits als abgebrochen markiert ist
    if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
      return NextResponse.json({ 
        success: true, 
        sessionId,
        message: "Session already marked as cancelled",
        wasAlreadyCancelled: true
      })
    }

    // Informiere Rate-Limiter über Cancel
    globalRateLimiter.cancelSession(sessionId, reason)
    
    console.log(`🛑 Session ${sessionId} cancelled (reason: ${reason})`)

    // Markiere die Session als abgeschlossen in der Progress-Verfolgung
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
      await fetch(`${baseUrl}/api/search-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          currentDay: 0,
          totalDays: 0,
          currentDate: "",
          isComplete: true, // Markiere als abgeschlossen
          uncachedDays: 0,
          cachedDays: 0,
          averageUncachedResponseTime: 0,
          averageCachedResponseTime: 0,
          queueSize: 0,
          activeRequests: 0,
        }),
      })
      console.log(`✅ Progress marked as complete for cancelled session ${sessionId}`)
    } catch (progressError) {
      console.error(`⚠️ Failed to update progress for cancelled session ${sessionId}:`, progressError)
      // Nicht kritisch - Cancel funktioniert trotzdem
    }

    return NextResponse.json({ 
      success: true, 
      sessionId,
      message: "Session marked as cancelled" 
    })
  } catch (error) {
    console.error("Error cancelling session:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}