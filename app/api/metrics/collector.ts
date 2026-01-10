interface MetricValue {
  value: number
  timestamp: number
  labels?: Record<string, string>
}

interface HistogramBucket {
  le: number // "less than or equal"
  count: number
}

interface Histogram {
  buckets: HistogramBucket[]
  sum: number
  count: number
}

class MetricsCollector {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, Histogram>()
  private labels = new Map<string, Record<string, string>>()
  
  // Histogram buckets for response times (in milliseconds)
  private readonly responseTimeBuckets = [50, 100, 200, 500, 1000, 2000, 5000, 10000, Infinity]
  
  constructor() {
    this.initializeMetrics()
    
    // Cleanup old histogram data every hour
    setInterval(() => this.cleanupOldData(), 60 * 60 * 1000)
  }

  private initializeMetrics() {
    // Initialize counters
    this.counters.set('bahn_api_requests_total', 0)
    this.counters.set('bahn_api_rate_limits_total', 0)
    this.counters.set('user_search_requests_total', 0)
    this.counters.set('days_searched_total', 0)
    this.counters.set('cache_hits_total', 0)
    this.counters.set('cache_misses_total', 0)
    this.counters.set('station_cache_hits_total', 0)
    this.counters.set('station_cache_misses_total', 0)
    this.counters.set('session_cancellations_total', 0)
    this.counters.set('streaming_connections_total', 0)
    
    // Initialize gauges
    this.gauges.set('bahn_api_current_interval_ms', 1200)
    this.gauges.set('active_search_sessions', 0)
    this.gauges.set('queue_size_total', 0)
    this.gauges.set('active_requests', 0)
    this.gauges.set('cached_stations_count', 0)
    this.gauges.set('cached_connections_count', 0)
    this.gauges.set('memory_usage_mb', 0)
    
    // Initialize histograms
    this.histograms.set('bahn_api_response_time_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })
    
    this.histograms.set('user_search_duration_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })
  }

  // Counter methods
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>) {
    const current = this.counters.get(name) || 0
    this.counters.set(name, current + value)
    
    if (labels) {
      this.labels.set(name, { ...this.labels.get(name), ...labels })
    }
    
    // console.log(`📊 Metric: ${name} = ${current + value}${labels ? ` (${JSON.stringify(labels)})` : ''}`) // Only for Debugging purposes
  }

  // Gauge methods
  setGauge(name: string, value: number, labels?: Record<string, string>) {
    this.gauges.set(name, value)
    
    if (labels) {
      this.labels.set(name, { ...this.labels.get(name), ...labels })
    }
  }

  incrementGauge(name: string, value: number = 1) {
    const current = this.gauges.get(name) || 0
    this.gauges.set(name, current + value)
  }

  decrementGauge(name: string, value: number = 1) {
    const current = this.gauges.get(name) || 0
    this.gauges.set(name, Math.max(0, current - value))
  }

  // Histogram methods
  observeHistogram(name: string, value: number, labels?: Record<string, string>) {
    const histogram = this.histograms.get(name)
    if (!histogram) return

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++
      }
    }

    // Update sum and count
    histogram.sum += value
    histogram.count++

    if (labels) {
      this.labels.set(name, { ...this.labels.get(name), ...labels })
    }
  }

  // Specific business metric methods
  recordBahnApiRequest(responseTimeMs: number, statusCode: number) {
    this.incrementCounter('bahn_api_requests_total')
    this.observeHistogram('bahn_api_response_time_ms', responseTimeMs)
    
    if (statusCode === 429) {
      this.incrementCounter('bahn_api_rate_limits_total')
    }
  }

  recordUserSearch(daysSearched: number) {
    this.incrementCounter('user_search_requests_total')
    this.incrementCounter('days_searched_total', daysSearched)
  }

  recordCacheHit(type: 'connection' | 'station' = 'connection') {
    if (type === 'station') {
      this.incrementCounter('station_cache_hits_total')
    } else {
      this.incrementCounter('cache_hits_total')
    }
  }

  recordCacheMiss(type: 'connection' | 'station' = 'connection') {
    if (type === 'station') {
      this.incrementCounter('station_cache_misses_total')
    } else {
      this.incrementCounter('cache_misses_total')
    }
  }

  updateRateLimitInterval(intervalMs: number) {
    this.setGauge('bahn_api_current_interval_ms', intervalMs)
  }

  updateQueueMetrics(queueSize: number, activeRequests: number, activeSessions: number) {
    this.setGauge('queue_size_total', queueSize)
    this.setGauge('active_requests', activeRequests)
    this.setGauge('active_search_sessions', activeSessions)
  }

  updateCacheMetrics(stationCount: number, connectionCount: number) {
    this.setGauge('cached_stations_count', stationCount)
    this.setGauge('cached_connections_count', connectionCount)
  }

  recordSessionCancellation(reason: string) {
    this.incrementCounter('session_cancellations_total', 1, { reason })
  }

  recordStreamingConnection() {
    this.incrementCounter('streaming_connections_total')
  }

  recordSearchDuration(durationMs: number) {
    this.observeHistogram('user_search_duration_ms', durationMs)
  }

  // Memory usage tracking
  updateMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      const usageMB = Math.round(usage.heapUsed / 1024 / 1024)
      this.setGauge('memory_usage_mb', usageMB)
    }
  }

  private cleanupOldData() {
    console.log('🧹 Cleaning up old metrics data...')
    // Histogramme haben keine automatische Bereinigung in diesem einfachen System
    // In einer produktiven Umgebung würde man hier ältere Daten archivieren
  }

  // Export metrics in Prometheus format
  exportPrometheusMetrics(): string {
    let output = ''
    
    // Export counters
    for (const [name, value] of this.counters) {
      output += `# TYPE ${name} counter\n`
      const labels = this.labels.get(name)
      if (labels && Object.keys(labels).length > 0) {
        const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')
        output += `${name}{${labelStr}} ${value}\n`
      } else {
        output += `${name} ${value}\n`
      }
      output += '\n'
    }
    
    // Export gauges
    for (const [name, value] of this.gauges) {
      output += `# TYPE ${name} gauge\n`
      output += `${name} ${value}\n\n`
    }
    
    // Export histograms
    for (const [name, histogram] of this.histograms) {
      output += `# TYPE ${name} histogram\n`
      
      for (const bucket of histogram.buckets) {
        output += `${name}_bucket{le="${bucket.le === Infinity ? '+Inf' : bucket.le}"} ${bucket.count}\n`
      }
      
      output += `${name}_sum ${histogram.sum}\n`
      output += `${name}_count ${histogram.count}\n\n`
    }
    
    // Add timestamp
    output += `# Generated at ${new Date().toISOString()}\n`
    
    return output
  }

  // Get current metrics as JSON (for debugging)
  getMetricsJSON() {
    this.updateMemoryUsage()
    
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
      labels: Object.fromEntries(this.labels),
      timestamp: new Date().toISOString()
    }
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector()

// Update memory usage every 30 seconds
setInterval(() => {
  metricsCollector.updateMemoryUsage()
}, 30 * 1000)
