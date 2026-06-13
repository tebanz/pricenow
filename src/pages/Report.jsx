import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { calcUnitPrice, formatUnitPrice, priceChangeDisplay } from '../utils/priceCalc'
import { getDistanceMeters, getStoredZone, isValidCoordinate, PRICE_NOW_ZONE_EVENT, rowCommune, sameCommune, zoneSubtitle } from '../utils/location'
import { effectivePrice, hasOffer, paymentConditionLabel } from '../utils/discounts'
import Spinner from '../components/UI/Spinner'
import { format, startOfWeek, endOfWeek, subWeeks, subDays } from 'date-fns'
import { es } from 'date-fns/locale'

function average(values) {
  if (!values.length) return null
  return values.reduce((acc, value) => acc + Number(value || 0), 0) / values.length
}

function effectiveUnitPrice(row) {
  const calculated = calcUnitPrice(effectivePrice(row), row.quantity, row.unit)
  if (calculated != null && Number.isFinite(Number(calculated)) && Number(calculated) > 0) return Number(calculated)
  return Number(row.unit_price)
}

function rowDistanceFromZone(row, zone) {
  const lat = row.purchase_latitude ?? row.latitude
  const lng = row.purchase_longitude ?? row.longitude
  return getDistanceMeters(zone?.lat, zone?.lng, lat, lng)
}

function filterRowsByZone(rows, zoneMode, zone) {
  if (zoneMode === 'all') return rows
  if (zoneMode === 'commune') {
    if (!zone?.commune) return rows
    return rows.filter(row => sameCommune(rowCommune(row), zone.commune))
  }
  if (zoneMode === 'nearby') {
    if (!isValidCoordinate(zone?.lat, zone?.lng)) return rows
    return rows.filter(row => {
      const distance = rowDistanceFromZone(row, zone)
      return distance != null && distance <= 5000
    })
  }
  return rows
}

function zoneFilterLabel(zoneMode, zone) {
  if (zoneMode === 'nearby') return 'Cerca de mi'
  if (zoneMode === 'commune' && zone?.commune) return zoneSubtitle(zone)
  if (zoneMode === 'commune') return 'Mi comuna'
  return 'Todas las zonas'
}

function normalizeText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function comparableUnit(unit) {
  if (unit === 'g') return 'kg'
  if (unit === 'ml') return 'litro'
  return unit || 'unidad'
}

function linkedProduct(row) {
  return Array.isArray(row.products) ? row.products[0] : row.products
}

function inferCategory(row) {
  const product = linkedProduct(row)
  const text = normalizeText(`${product?.name || ''} ${row.product_name || ''} ${row.brand || ''}`)
  if (text.includes('bebida') || text.includes('jugo') || text.includes('agua') || text.includes('pepsi') || text.includes('coca cola') || text.includes('fanta') || text.includes('sprite')) return 'Bebidas'
  if (text.includes('yogur') || text.includes('yogurt') || text.includes('leche')) return 'Lácteos'
  if (text.includes('salchicha') || text.includes('vienesa') || text.includes('longaniza') || text.includes('pollo') || text.includes('carne')) return 'Carnes'
  if (text.includes('pan') || text.includes('marraqueta') || text.includes('hallulla')) return 'Panadería'
  return product?.category || 'Sin categoría'
}

function inferStandardUnit(row) {
  const product = linkedProduct(row)
  const text = normalizeText(`${product?.name || ''} ${row.product_name || ''} ${row.brand || ''} ${product?.category || ''}`)
  const rowUnit = comparableUnit(row.unit)
  const productUnit = comparableUnit(product?.default_unit || '')

  if (text.includes('bebida') || text.includes('gaseosa') || text.includes('jugo') || text.includes('agua') || text.includes('pepsi') || text.includes('coca cola') || text.includes('fanta') || text.includes('sprite')) return 'litro'
  if (text.includes('aceite') || text.includes('cloro') || text.includes('lavalozas') || text.includes('detergente liquido')) return 'litro'
  if (text.includes('salchicha') || text.includes('vienesa') || text.includes('longaniza')) return 'kg'
  if (text.includes('carne') || text.includes('pollo') || text.includes('posta') || text.includes('chuleta')) return 'kg'
  if (text.includes('pan') || text.includes('marraqueta') || text.includes('hallulla')) return rowUnit === 'unidad' ? 'kg' : rowUnit
  if (text.includes('yogur') || text.includes('yogurt')) return 'unidad'

  if (['kg', 'litro'].includes(rowUnit) && productUnit === 'unidad') return rowUnit
  return productUnit || rowUnit || 'unidad'
}

function isCompatibleUnit(rowUnit, standardUnit) {
  const unit = comparableUnit(rowUnit)
  if (standardUnit === 'kg') return unit === 'kg'
  if (standardUnit === 'litro') return unit === 'litro'
  return unit === standardUnit
}

function normalizedUnitPrice(row, standardUnit) {
  if (!isCompatibleUnit(row.unit, standardUnit)) return null
  const value = effectiveUnitPrice(row)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function groupByProduct(rows) {
  return rows.reduce((acc, row) => {
    const product = linkedProduct(row)
    const productName = product?.name || row.product_name?.trim() || 'Producto sin nombre'
    const category = product?.category || inferCategory(row)
    const unit = inferStandardUnit(row)
    const key = row.product_id
      ? `${row.product_id}__${unit}`
      : `${normalizeText(productName)}__${unit}`
    const unitPrice = normalizedUnitPrice(row, unit)

    if (!acc[key]) {
      acc[key] = {
        product_id: row.product_id || null,
        product_name: productName,
        category,
        unit,
        unitPrices: [],
        rawCount: 0,
        incompatibleCount: 0,
        offerCount: 0,
        paymentConditions: new Set(),
        stores: new Set(),
        latestDate: null,
      }
    }

    acc[key].rawCount += 1
    if (unitPrice != null) acc[key].unitPrices.push(unitPrice)
    else acc[key].incompatibleCount += 1

    if (hasOffer(row)) acc[key].offerCount += 1
    const paymentCondition = paymentConditionLabel(row)
    if (paymentCondition) acc[key].paymentConditions.add(paymentCondition)
    if (row.store_name) acc[key].stores.add(row.store_name)
    if (!acc[key].latestDate || row.purchase_date > acc[key].latestDate) acc[key].latestDate = row.purchase_date

    return acc
  }, {})
}

function buildReport(currentRows, previousRows) {
  const current = groupByProduct(currentRows)
  const previous = groupByProduct(previousRows)

  return Object.entries(current)
    .map(([key, group]) => {
      if (!group.unitPrices.length) return null

      const avgUnitPrice = average(group.unitPrices)
      const previousAvgUnitPrice = previous[key]?.unitPrices?.length ? average(previous[key].unitPrices) : null
      const priceChangePct = previousAvgUnitPrice ? ((avgUnitPrice - previousAvgUnitPrice) / previousAvgUnitPrice) * 100 : null

      return {
        product_id: group.product_id,
        product_name: group.product_name,
        category: group.category,
        unit: group.unit,
        avg_unit_price: avgUnitPrice,
        min_unit_price: Math.min(...group.unitPrices),
        max_unit_price: Math.max(...group.unitPrices),
        price_change_pct: priceChangePct,
        sample_count: group.unitPrices.length,
        raw_count: group.rawCount,
        incompatible_count: group.incompatibleCount,
        offer_count: group.offerCount,
        payment_conditions: Array.from(group.paymentConditions),
        store_count: group.stores.size,
        latest_date: group.latestDate,
      }
    })
    .filter(Boolean)
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
    return { label: `${format(start, 'd MMM', { locale: es })} – ${format(end, 'd MMM yyyy', { locale: es })}`, start, end, previousStart, previousEnd }
  }

  if (mode === '30d') {
    const end = now
    const start = subDays(now, 29)
    const previousEnd = subDays(start, 1)
    const previousStart = subDays(previousEnd, 29)
    return { label: 'Últimos 30 días', start, end, previousStart, previousEnd }
  }

  return { label: 'Todos los precios aprobados', start: null, end: null, previousStart: null, previousEnd: null }
}

function SummaryCard({ label, value, tone = 'brand' }) {
  const colors = {
    brand: 'text-brand-600 bg-brand-50',
    success: 'text-success-600 bg-success-50',
    warning: 'text-warning-600 bg-warning-50',
  }
  return (
    <div className="rounded-2xl bg-white border border-slate-100 p-3 text-center shadow-sm">
      <p className={`mx-auto mb-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${colors[tone]}`}>{label}</p>
      <p className="text-xl font-black text-slate-950">{value}</p>
    </div>
  )
}

export default function Report() {
  const [reportRows, setReportRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [periodMode, setPeriodMode] = useState('30d')
  const [weekOffset, setWeekOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [zoneMode, setZoneMode] = useState(() => getStoredZone()?.commune ? 'commune' : 'all')
  const [currentZone, setCurrentZone] = useState(() => getStoredZone())

  const range = getRange(periodMode, weekOffset)

  useEffect(() => {
    const updateZone = event => setCurrentZone(event?.detail || getStoredZone())
    window.addEventListener(PRICE_NOW_ZONE_EVENT, updateZone)
    window.addEventListener('storage', updateZone)
    return () => {
      window.removeEventListener(PRICE_NOW_ZONE_EVENT, updateZone)
      window.removeEventListener('storage', updateZone)
    }
  }, [])

  async function fetchApprovedRows(start, end) {
    let query = supabase
      .from('price_entries')
      .select('*, products(id, name, canonical_name, category, default_unit)')
      .eq('validation_status', 'approved')
      .order('purchase_date', { ascending: false })
      .limit(2500)

    if (start && end) {
      query = query.gte('purchase_date', format(start, 'yyyy-MM-dd')).lte('purchase_date', format(end, 'yyyy-MM-dd'))
    }

    return query
  }

  async function loadLiveReport() {
    setLoading(true)
    setError(null)

    const [currentRes, previousRes] = await Promise.all([
      fetchApprovedRows(range.start, range.end),
      range.previousStart && range.previousEnd ? fetchApprovedRows(range.previousStart, range.previousEnd) : Promise.resolve({ data: [], error: null }),
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

    const currentRows = filterRowsByZone(currentRes.data ?? [], zoneMode, currentZone)
    const previousRows = filterRowsByZone(previousRes.data ?? [], zoneMode, currentZone)
    setReportRows(buildReport(currentRows, previousRows))
    setLoading(false)
  }

  useEffect(() => {
    loadLiveReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMode, weekOffset, zoneMode, currentZone?.commune, currentZone?.lat, currentZone?.lng])

  const filteredRows = reportRows.filter(row => {
    const term = normalizeText(search)
    if (!term) return true
    return normalizeText(`${row.product_name} ${row.category || ''}`).includes(term)
  })

  const totalSamples = reportRows.reduce((acc, row) => acc + row.sample_count, 0)
  const bestCoverage = reportRows[0]?.product_name || '—'

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <div className="rounded-[1.75rem] border border-white bg-gradient-to-br from-white via-slate-50 to-blue-50/80 p-4 shadow-sm mb-4">
        <h2 className="text-xl font-black text-slate-950">Reportes</h2>
        <p className="mt-1 text-sm text-slate-500">Datos en vivo con precios aprobados y unidades estandarizadas.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <SummaryCard label="Productos" value={reportRows.length} />
          <SummaryCard label="Datos" value={totalSamples} tone="success" />
          <SummaryCard label="Más medido" value={bestCoverage} tone="warning" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { value: 'week', label: 'Semana' },
          { value: '30d', label: '30 días' },
          { value: 'all', label: 'Todos' },
        ].map(option => (
          <button key={option.value} onClick={() => { setPeriodMode(option.value); setWeekOffset(0) }} className={`rounded-xl py-2 text-sm font-semibold border transition-colors ${periodMode === option.value ? 'bg-brand-600 text-white border-brand-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>
            {option.label}
          </button>
        ))}
      </div>

      {periodMode === 'week' && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2 mb-4">
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95" aria-label="Ver semana anterior">
            <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">{range.label}</p>
            {weekOffset === 0 && <p className="text-xs text-brand-500">Esta semana</p>}
            {weekOffset === 1 && <p className="text-xs text-slate-400">Semana anterior</p>}
            {weekOffset > 1 && <p className="text-xs text-slate-400">Hace {weekOffset} semanas</p>}
          </div>
          <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0} className="p-1 rounded-lg hover:bg-slate-100 transition-colors active:scale-95 disabled:opacity-30" aria-label="Ver semana siguiente">
            <svg className="w-5 h-5 fill-slate-500" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
          </button>
        </div>
      )}

      {periodMode !== 'week' && (
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 mb-4 text-center">
          <p className="text-sm font-semibold text-slate-800">{range.label}</p>
          <p className="text-xs text-slate-400">Incluye productos aprobados del período seleccionado.</p>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
        <select value={zoneMode} onChange={e => setZoneMode(e.target.value)} className="input-field">
          <option value="nearby">Cerca de mi</option>
          <option value="commune">Mi comuna</option>
          <option value="all">Todas las zonas</option>
        </select>
        <p className="mt-2 text-xs font-semibold text-slate-400">Zona: {zoneFilterLabel(zoneMode, currentZone)}</p>
      </div>

      <div className="flex gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto en el reporte…" className="input-field flex-1" />
        <button onClick={loadLiveReport} disabled={loading} className="btn-primary px-4 rounded-2xl disabled:opacity-50">{loading ? '…' : 'Actualizar'}</button>
      </div>

      {error && <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">Error al cargar el reporte: {error}</div>}
      {loading && <Spinner />}

      {!loading && filteredRows.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-slate-500 text-sm">No hay productos aprobados para este filtro.</p>
          <p className="text-slate-400 text-xs mt-1">Revisa el período seleccionado o aprueba más solicitudes.</p>
        </div>
      )}

      {!loading && filteredRows.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mb-3">Mostrando {filteredRows.length} {filteredRows.length === 1 ? 'producto' : 'productos'} · {totalSamples} registros comparables</p>
          <div className="space-y-3">
            {filteredRows.map((row, i) => {
              const { color, label } = priceChangeDisplay(row.price_change_pct)
              return (
                <div key={`${row.product_name}-${row.unit}-${i}`} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-900 truncate">{row.product_name}</p>
                      <p className="text-[11px] text-brand-600 font-medium mt-0.5">{row.category}</p>
                      {row.offer_count > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Oferta</span>
                          {row.payment_conditions?.map(method => (
                            <span key={method} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Con {method}</span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {row.sample_count} {row.sample_count === 1 ? 'registro comparable' : 'registros comparables'} · {row.store_count} {row.store_count === 1 ? 'tienda' : 'tiendas'}
                        {row.incompatible_count > 0 && <> · {row.incompatible_count} sin unidad comparable</>}
                        {row.latest_date && <> · último: {row.latest_date}</>}
                      </p>
                    </div>
                    {row.price_change_pct != null ? <span className={`text-sm font-bold shrink-0 ${color}`}>{label}</span> : <span className="text-xs text-slate-400 shrink-0">Sin comparación</span>}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="text-center bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-400 mb-0.5">Mínimo estándar</p><p className="text-sm font-bold text-success-600">{formatUnitPrice(row.min_unit_price, row.unit)}</p></div>
                    <div className="text-center bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-400 mb-0.5">Promedio estándar</p><p className="text-sm font-bold text-brand-600">{formatUnitPrice(row.avg_unit_price, row.unit)}</p></div>
                    <div className="text-center bg-slate-50 rounded-lg p-2"><p className="text-xs text-slate-400 mb-0.5">Máximo estándar</p><p className="text-sm font-bold text-danger-500">{formatUnitPrice(row.max_unit_price, row.unit)}</p></div>
                  </div>

                  <div className="mt-3 bg-brand-50 rounded-lg p-2 text-center"><p className="text-xs text-slate-500 mb-0.5">Unidad de comparación</p><p className="text-sm font-bold text-brand-600">Este producto se compara por {row.unit === 'unidad' ? 'unidad' : row.unit}.</p></div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
