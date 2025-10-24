"use client"

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

interface PriceHistoryChartProps {
  history: PriceHistoryEntry[]
  title: string
}

function getTrend(history: PriceHistoryEntry[]) {
  if (history.length < 2) {
    return { icon: <Minus className="h-4 w-4 text-gray-500" />, text: "Stabiler Preis", color: "text-gray-500", percentage: null }
  }
  const firstPrice = history[0].preis
  const lastPrice = history[history.length - 1].preis
  const change = lastPrice - firstPrice
  const percentage = firstPrice > 0 ? (change / firstPrice) * 100 : 0

  if (change > 0) {
    return { icon: <TrendingUp className="h-4 w-4 text-red-500" />, text: "Preis gestiegen", color: "text-red-500", percentage }
  } else if (change < 0) {
    return { icon: <TrendingDown className="h-4 w-4 text-green-500" />, text: "Preis gefallen", color: "text-green-500", percentage }
  } else {
    return { icon: <Minus className="h-4 w-4 text-gray-500" />, text: "Stabiler Preis", color: "text-gray-500", percentage: 0 }
  }
}

export function PriceHistoryChart({ history, title }: PriceHistoryChartProps) {
  if (!history || history.length < 1) {
    return (
      <div className="text-center text-sm text-gray-500 py-4">
        Keine Preishistorie vorhanden.
      </div>
    )
  }

  // Prüfe ob mehrere Einträge am selben Tag existieren
  const dates = history.map(entry => new Date(entry.recorded_at).toLocaleDateString('de-DE'))
  const uniqueDates = new Set(dates)
  const hasMultipleEntriesPerDay = dates.length > uniqueDates.size

  const data = history.map(entry => {
    const entryDate = new Date(entry.recorded_at)
    // Wenn mehrere Einträge pro Tag: zeige auch Uhrzeit
    const label = hasMultipleEntriesPerDay
      ? entryDate.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : entryDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    
    return {
      date: label,
      preis: entry.preis,
    }
  })

  const trend = getTrend(history)
  const minPrice = Math.min(...history.map(h => h.preis))
  const maxPrice = Math.max(...history.map(h => h.preis))

  // Runde die Y-Achsen-Domain, um unschöne Nachkommastellen zu vermeiden
  const yDomain = [
    Math.max(0, Math.floor(minPrice - 10)),
    Math.ceil(maxPrice + 10)
  ]

  return (
    <div className="p-4 border rounded-lg bg-gray-50/50">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-semibold text-gray-800">{title}</h4>
        <div className={`flex items-center gap-1 text-sm font-medium ${trend.color}`}>
          {trend.icon}
          <span>{trend.text}</span>
          {trend.percentage !== null && (
            <span className="font-bold">({trend.percentage > 0 ? '+' : ''}{trend.percentage.toFixed(0)}%)</span>
          )}
        </div>
      </div>
      {history.length === 1 ? (
        <div className="text-center text-sm text-gray-600 py-4">
          Nur ein Datenpunkt vorhanden: {history[0].preis.toFixed(2)}€ am {new Date(history[0].recorded_at).toLocaleString('de-DE')}
        </div>
      ) : (
        <div style={{ width: '100%', height: 150 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis 
                dataKey="date" 
                fontSize={10} 
                tick={{ fill: '#666' }}
                angle={hasMultipleEntriesPerDay ? -45 : 0}
                textAnchor={hasMultipleEntriesPerDay ? "end" : "middle"}
                height={hasMultipleEntriesPerDay ? 60 : 30}
              />
              <YAxis domain={yDomain} fontSize={12} tick={{ fill: '#666' }} tickFormatter={(value) => `${Number(value).toFixed(2)}€`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid #ccc',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                }}
                labelStyle={{ fontWeight: 'bold' }}
                formatter={(value: number) => [`${Number(value).toFixed(2)}€`, 'Preis']}
              />
              <Line type="monotone" dataKey="preis" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              {history.length > 1 && (
                <>
                  <ReferenceLine y={minPrice} label={{ value: `Min: ${minPrice.toFixed(2)}€`, position: 'insideBottomLeft', fill: '#16a34a', fontSize: 10 }} stroke="#16a34a" strokeDasharray="3 3" />
                  <ReferenceLine y={maxPrice} label={{ value: `Max: ${maxPrice.toFixed(2)}€`, position: 'insideTopLeft', fill: '#dc2626', fontSize: 10 }} stroke="#dc2626" strokeDasharray="3 3" />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
