import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP, formatUnitPrice, priceChangeDisplay } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'
import { format, startOfWeek, endOfWeek, subWeeks, subDays } from 'date-fns'
import { es } from 'date-fns/locale'

function average(values) {
  if (!values.length) return null
  return values.reduce((acc, value) => acc + Number(value || 0), 0) / values.length
}

function groupByProduct(rows) {
  return rows.reduce((acc, row) => {
    const productName = row.product_name?.trim() || 'Producto sin nombre'
    const unit = row.unit || 'unidad'
    const key = `${productName.toLowerCase()}__${unit}`

    if (!acc[key]) {
      acc[key] = {
        product_name: productName,
        unit,
        prices: [],
        unitPrices: [],
        stores: new Set(),
        latestDate: null,
      }
    }

    acc[key].prices.push(Number(row.price))
    acc[key].unitPrices.push(Number(row.unit_price ?? row.price))
    if (row.store_name) acc[key].stores.add(row.store_name)
    if (!acc[key].latestDate || row.purchase_date > acc[key].latestDate) {
      acc[key].latestDate = row.purchase_date
    }

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
        latest_date: group.latestDate,
      }
    })
    .sort((a, b) => {
      if (b.sample_count !== a.sample_count) return b.sample_count - a.sample_count
      return a.product_name.localeCompare(b.product_name, 'es')
    })
}

function getRange(mode, weekOffset) {
  const now = new Date()

  if (mode === 'week') {
    const start = startOfWeek(subWeeks(now, weekOffset), { weekStartsOn: 1 })
    const end = endOfWeek(start, { weekStartsOn: 1 })
    const previousStart = startOfWeek(subWeeks(now, weekOffset + 1), { weekStartsOn: 1 })
    const previousEnd = endOfWeek(previousStart, { weekStartsOn: 1 })
    return {
      label: `${format(start, 'd MMM', { locale: es })} – ${format(end, 'd MMM yyyy', { locale: es })}`,
      start,
      end,
      previousStart,
      previousEnd,
    }
  }

  if (mode === '30d') {
    const end = now
    const start = subDays(now, 29)
    const previousEnd = subDays(start, 1)
    const previousStart = subDays(previousEnd, 29)
    return {
      label: `Últimos 30 días`,
      start,
      end,
      previousStart,
      previousEnd,
    }
  }

  return {
    label: 'Todos los precios aprobados',
    start: null,
    end: null,
    previousStart: null,
    previousEnd: null,
  }
}

export default function Report() {
  const [reportRows, setReportRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [periodMode, setPeriodMode] = useState('30d')
  const [weekOffset, setWeekOffset] = useState(0)
  const [search, setSearch] = useState('')

  const range = getRange(periodMode, weekOffset)

  async function fetchApprovedRows(start, end) {
    let query = supabase
      .from('price_entries')
      .select('product_name, price, unit_price, unit, store_name, purchase_date')
      .eq('validation_status', 'approved')
      .order('purchase_date', { ascending: false })
      .limit(2000)

    if (start && end) {
      query = query
        .gte('purchase_date', format(start, 'yyyy-MM-dd'))
        .lte('purchase_date', format(end, 'yyyy-MM-dd'))
    }

    return query
  }

  async function loadLiveReport() {
    setLoading(true)
    setError(null)

    const [currentRes, previousRes] = await Promise.all([
      fetchApprovedRows(range.start, range.end),
      range.previousStart && range.previousEnd
        ? fetchApprovedRows(range.previousStart, range.previousEnd)
        : Promise.resolve({ data: [], error: null }),
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

    setReportRows(buildReport(currentRes.data ?? [], previousRes.data ?? []))
    setLoading(false)
  }

  useEffect(() => {
    loadLiveReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMode, weekOffset])

  const filteredRows = reportRows.filter(row =>
    row.product_name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Reporte de precios</h2>
      <p className="text-sm text-slate-500 mb-4">
        Datos en vivo basados en precios aprobados por administración.
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { value: 'week', label: 'Semana' },
          { value: '30d', label: '30 días' },
          { value: 'all', label: 'Todos' },
        ].map(option => (
          <button
            key={option.value}
            onClick={() => {
              setPeriodMode(option.value)
              setWeekOffset(0)
            }}
            className={`rounded-xl py-2 text-sm font-semibold border transition-colors ${
              periodMode === option.value
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {periodMode === 'week' && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2 mb-4">
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95"
            aria-label="Ver semana anterior"
          >
            <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">{range.label}</p>
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
      )}

      {periodMode !== 'week' && (
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 mb-4 text-center">
          <p className="text-sm font-semibold text-slate-800">{range.label}</p>
          <p className="text-xs text-slate-400">Incluye todos los productos aprobados del período seleccionado.</p>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto en el reporte…"
          className="input-field flex-1"
        />
        <button
          onClick={loadLiveReport}
          disabled={loading}
          className="bg-brand-500 text-white px-4 rounded-xl font-semibold text-sm disabled:opacity-50"
        >
          {loading ? '…' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          Error al cargar el reporte: {error}
        </div>
      )}

      {loading && <Spinner />}

      {!loading && filteredRows.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-slate-500 text-sm">
            No hay productos aprobados para este filtro.
          </p>
          <p className="text-slate-400 text-xs mt-1">
            Revisa el período seleccionado o aprueba más solicitudes.
          </p>
        </div>
      )}

      {!loading && filteredRows.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mb-3">
            Mostrando {filteredRows.length} {filteredRows.length === 1 ? 'producto' : 'productos'} · {reportRows.reduce((acc, row) => acc + row.sample_count, 0)} registros aprobados
          </p>

          <div className="space-y-3">
            {filteredRows.map((row, i) => {
              const { color, label } = priceChangeDisplay(row.price_change_pct)
              return (
                <div key={`${row.product_name}-${row.unit}-${i}`} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{row.product_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {row.sample_count} {row.sample_count === 1 ? 'registro' : 'registros'} · {row.store_count} {row.store_count === 1 ? 'tienda' : 'tiendas'}
                        {row.latest_date && <> · último: {row.latest_date}</>}
                      </p>
                    </div>
                    {row.price_change_pct != null ? (
                      <span className={`text-sm font-bold shrink-0 ${color}`}>{label}</span>
                    ) : (
                      <span className="text-xs text-slate-400 shrink-0">Sin comparación</span>
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
        </>
      )}
    </div>
  )
}
