import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP, formatUnitPrice, priceChangeDisplay } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'

function average(values) {
  if (!values.length) return null
  return values.reduce((acc, value) => acc + Number(value || 0), 0) / values.length
}

function groupByProduct(rows) {
  return rows.reduce((acc, row) => {
    const key = `${row.product_name}__${row.unit}`
    if (!acc[key]) {
      acc[key] = {
        product_name: row.product_name,
        unit: row.unit,
        prices: [],
        unitPrices: [],
        stores: new Set(),
      }
    }

    acc[key].prices.push(Number(row.price))
    acc[key].unitPrices.push(Number(row.unit_price ?? row.price))
    if (row.store_name) acc[key].stores.add(row.store_name)

    return acc
  }, {})
}

function buildReport(currentRows, previousRows) {
  const current = groupByProduct(currentRows)
  const previous = groupByProduct(previousRows)

  return Object.entries(current)
    .map(([key, group]) => {
      const avgPrice = average(group.prices)
      const avgUnitPrice = average(group.unitPrices)
      const previousAvgUnitPrice = previous[key]
        ? average(previous[key].unitPrices)
        : null

      const priceChangePct = previousAvgUnitPrice
        ? ((avgUnitPrice - previousAvgUnitPrice) / previousAvgUnitPrice) * 100
        : null

      return {
        product_name: group.product_name,
        unit: group.unit,
        avg_price: avgPrice,
        min_price: Math.min(...group.prices),
        max_price: Math.max(...group.prices),
        avg_unit_price: avgUnitPrice,
        min_unit_price: Math.min(...group.unitPrices),
        max_unit_price: Math.max(...group.unitPrices),
        price_change_pct: priceChangePct,
        sample_count: group.prices.length,
        store_count: group.stores.size,
      }
    })
    .sort((a, b) => {
      const aChange = Math.abs(a.price_change_pct ?? 0)
      const bChange = Math.abs(b.price_change_pct ?? 0)
      if (bChange !== aChange) return bChange - aChange
      return b.sample_count - a.sample_count
    })
}

export default function Report() {
  const [reportRows, setReportRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)

  const now = new Date()
  const weekStart = startOfWeek(subWeeks(now, weekOffset), { weekStartsOn: 1 })
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const previousWeekStart = startOfWeek(subWeeks(now, weekOffset + 1), { weekStartsOn: 1 })
  const previousWeekEnd = endOfWeek(previousWeekStart, { weekStartsOn: 1 })

  const weekLabel = `${format(weekStart, 'd MMM', { locale: es })} – ${format(weekEnd, 'd MMM yyyy', { locale: es })}`

  async function loadLiveReport() {
    setLoading(true)
    setError(null)

    const currentStart = format(weekStart, 'yyyy-MM-dd')
    const currentEnd = format(weekEnd, 'yyyy-MM-dd')
    const previousStart = format(previousWeekStart, 'yyyy-MM-dd')
    const previousEnd = format(previousWeekEnd, 'yyyy-MM-dd')

    const [currentRes, previousRes] = await Promise.all([
      supabase
        .from('price_entries')
        .select('product_name, price, unit_price, unit, store_name, purchase_date')
        .eq('validation_status', 'approved')
        .gte('purchase_date', currentStart)
        .lte('purchase_date', currentEnd),
      supabase
        .from('price_entries')
        .select('product_name, price, unit_price, unit, store_name, purchase_date')
        .eq('validation_status', 'approved')
        .gte('purchase_date', previousStart)
        .lte('purchase_date', previousEnd),
    ])

    if (currentRes.error) {
      setError(currentRes.error.message)
      setReportRows([])
      setLoading(false)
      return
    }

    if (previousRes.error) {
      setError(previousRes.error.message)
      setReportRows([])
      setLoading(false)
      return
    }

    const rows = buildReport(currentRes.data ?? [], previousRes.data ?? [])
    setReportRows(rows)
    setLoading(false)
  }

  useEffect(() => {
    loadLiveReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset])

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Reporte semanal</h2>
      <p className="text-sm text-slate-500 mb-4">
        Datos en vivo basados en precios aprobados por administración.
      </p>

      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2 mb-4">
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95"
          aria-label="Ver semana anterior"
        >
          <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">{weekLabel}</p>
          {weekOffset === 0 && <p className="text-xs text-brand-500">Esta semana</p>}
          {weekOffset === 1 && <p className="text-xs text-slate-400">Semana anterior</p>}
          {weekOffset > 1 && <p className="text-xs text-slate-400">Hace {weekOffset} semanas</p>}
        </div>
        <button
          onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
          disabled={weekOffset === 0}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95 disabled:opacity-30"
          aria-label="Ver semana siguiente"
        >
          <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </div>

      <button
        onClick={loadLiveReport}
        disabled={loading}
        className="btn-secondary w-full text-sm py-2 mb-4"
      >
        {loading ? 'Actualizando…' : 'Actualizar reporte'}
      </button>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          Error al cargar el reporte: {error}
        </div>
      )}

      {loading && <Spinner />}

      {!loading && reportRows.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-slate-500 text-sm">
            Sin precios aprobados para esta semana todavía.
          </p>
          <p className="text-slate-400 text-xs mt-1">
            Cuando apruebes una solicitud, toca “Actualizar reporte”.
          </p>
        </div>
      )}

      {!loading && reportRows.length > 0 && (
        <div className="space-y-3">
          {reportRows.map((row, i) => {
            const { color, label } = priceChangeDisplay(row.price_change_pct)
            return (
              <div key={`${row.product_name}-${row.unit}-${i}`} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{row.product_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {row.sample_count} {row.sample_count === 1 ? 'registro' : 'registros'} · {row.store_count} {row.store_count === 1 ? 'tienda' : 'tiendas'}
                    </p>
                  </div>
                  {row.price_change_pct != null ? (
                    <span className={`text-sm font-bold shrink-0 ${color}`}>{label}</span>
                  ) : (
                    <span className="text-xs text-slate-400 shrink-0">Sin semana previa</span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="text-center bg-slate-50 rounded-lg p-2">
                    <p className="text-xs text-slate-400 mb-0.5">Mínimo</p>
                    <p className="text-sm font-bold text-success-600">{formatCLP(row.min_price)}</p>
                  </div>
                  <div className="text-center bg-slate-50 rounded-lg p-2">
                    <p className="text-xs text-slate-400 mb-0.5">Promedio</p>
                    <p className="text-sm font-bold text-brand-500">{formatCLP(row.avg_price)}</p>
                  </div>
                  <div className="text-center bg-slate-50 rounded-lg p-2">
                    <p className="text-xs text-slate-400 mb-0.5">Máximo</p>
                    <p className="text-sm font-bold text-danger-500">{formatCLP(row.max_price)}</p>
                  </div>
                </div>

                <div className="mt-3 bg-brand-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Promedio normalizado</p>
                  <p className="text-sm font-bold text-brand-600">
                    {formatUnitPrice(row.avg_unit_price, row.unit)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
