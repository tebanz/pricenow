import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP, priceChangeDisplay } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'

export default function Report() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)  // 0 = semana actual

  const now       = new Date()
  const weekStart = startOfWeek(subWeeks(now, weekOffset), { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(weekStart,   { weekStartsOn: 1 })

  const weekLabel = `${format(weekStart, 'd MMM', { locale: es })} – ${format(weekEnd, 'd MMM yyyy', { locale: es })}`

  useEffect(() => {
    async function loadReports() {
      setLoading(true)
      const { data, error } = await supabase
        .from('weekly_reports')
        .select('*')
        .eq('week_start', format(weekStart, 'yyyy-MM-dd'))
        .is('store_name', null)        // reporte general (sin filtro de tienda)
        .is('sector', null)            // sin filtro de sector
        .order('price_change_pct', { ascending: false })
        .limit(30)

      if (!error && data) setReports(data)
      setLoading(false)
    }
    loadReports()
  }, [weekOffset]) // eslint-disable-line

  // Si no hay reportes semanales, calcular sobre la marcha
  const [liveData, setLiveData] = useState([])
  useEffect(() => {
    if (!loading && reports.length === 0) {
      supabase
        .from('price_entries')
        .select('product_name, price, unit_price, unit, purchase_date')
        .eq('validation_status', 'approved')
        .gte('purchase_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('purchase_date', format(weekEnd,   'yyyy-MM-dd'))
        .then(({ data }) => {
          if (!data) return
          // Agrupar por producto
          const grouped = data.reduce((acc, row) => {
            if (!acc[row.product_name]) {
              acc[row.product_name] = { prices: [], unit: row.unit }
            }
            acc[row.product_name].prices.push(row.price)
            return acc
          }, {})
          const live = Object.entries(grouped).map(([name, { prices, unit }]) => ({
            product_name: name,
            avg_price:    prices.reduce((a, b) => a + b, 0) / prices.length,
            min_price:    Math.min(...prices),
            max_price:    Math.max(...prices),
            sample_count: prices.length,
            price_change_pct: null,
            unit,
          }))
          setLiveData(live.sort((a, b) => b.sample_count - a.sample_count))
        })
    }
  }, [loading, reports.length]) // eslint-disable-line

  const displayData = reports.length > 0 ? reports : liveData

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Reporte semanal</h2>
      <p className="text-sm text-slate-500 mb-4">Variación de precios en Rancagua.</p>

      {/* Selector de semana */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2 mb-5">
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95"
        >
          <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">{weekLabel}</p>
          {weekOffset === 0 && <p className="text-xs text-brand-500">Esta semana</p>}
          {weekOffset === 1 && <p className="text-xs text-slate-400">Semana anterior</p>}
          {weekOffset > 1  && <p className="text-xs text-slate-400">Hace {weekOffset} semanas</p>}
        </div>
        <button
          onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
          disabled={weekOffset === 0}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95 disabled:opacity-30"
        >
          <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && displayData.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-slate-500 text-sm">
            Sin datos para esta semana todavía.
          </p>
          <p className="text-slate-400 text-xs mt-1">
            Los reportes se generan con datos validados.
          </p>
        </div>
      )}

      {!loading && displayData.length > 0 && (
        <>
          {reports.length === 0 && (
            <div className="bg-warning-50 border border-warning-500/30 rounded-xl p-3 mb-4 text-xs text-warning-600">
              Mostrando datos en tiempo real (sin reporte oficial generado aún).
            </div>
          )}

          <div className="space-y-3">
            {displayData.map((row, i) => {
              const { color, label } = priceChangeDisplay(row.price_change_pct)
              return (
                <div key={i} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{row.product_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {row.sample_count} {row.sample_count === 1 ? 'registro' : 'registros'}
                      </p>
                    </div>
                    {row.price_change_pct != null && (
                      <span className={`text-sm font-bold shrink-0 ${color}`}>
                        {label}
                      </span>
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
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
