class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillRate: number

  constructor(capacity: number = 5, refillRate: number = 1) {
    this.capacity = capacity // Max burst capacity
    this.tokens = capacity
    this.lastRefill = Date.now()
    this.refillRate = refillRate // Tokens per second
  }

  private refill(): void {
    const now = Date.now()
    const timePassed = (now - this.lastRefill) / 1000
    const tokensToAdd = timePassed * this.refillRate
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
    this.lastRefill = now
  }

  tryConsume(): boolean {
    this.refill()
    
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    
    return false
  }

  getWaitTime(): number {
    this.refill()
    
    if (this.tokens >= 1) {
      return 0
    }
    
    const tokensNeeded = 1 - this.tokens
    return Math.ceil((tokensNeeded / this.refillRate) * 1000)
  }
}

const stationSearchBucket = new TokenBucket(5, 1) // 5 token capacity, 1 token/second refill

export function checkStationSearchRateLimit(): { allowed: boolean; waitMs?: number } {
  const allowed = stationSearchBucket.tryConsume()
  
  if (!allowed) {
    const waitMs = stationSearchBucket.getWaitTime()
    return { allowed: false, waitMs }
  }
  
  return { allowed: true }
}
