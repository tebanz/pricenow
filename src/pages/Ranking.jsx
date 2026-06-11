import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Report from './Report'
import { supabase } from '../lib/supabase'
import { formatCLP, formatUnitPrice, SECTORES_RANCAGUA } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

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

function getLinkedProduct(row) {
  return Array.isArray(row.products) ? row.products[0] : row.products
}

function getProductName(row) {
  const product = getLinkedProduct(row)
  return product?.name || row.product_name?.trim() || 'Producto sin nombre'
}

function getProductCategory(row) {
  const product = getLinkedProduct(row)
  return product?.category || inferCategory(row)
}

function inferCategory(row) {
  const text = normalizeText(`${row.product_name || ''} ${row.brand || ''}`)
  if (text.includes('bebida') || text.includes('jugo') || text.includes('agua') || text.includes('pepsi') || text.includes('coca cola') || text.includes('fanta') || text.includes('sprite')) return 'Bebidas'
  if (text.includes('yogur') || text.includes('yogurt') || text.includes('leche')) return 'Lácteos'
  if (text.includes('salchicha') || text.includes('vienesa') || text.includes('longaniza') || text.includes('pollo') || text.includes('carne')) return 'Carnes'
  if (text.includes('pan') || text.includes('marraqueta') || text.includes('hallulla')) return 'Panadería'
  return 'Sin categoría'
}

function inferStandardUnit(row) {
  const product = getLinkedProduct(row)
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

function getProductKey(row) {
  const product = getLinkedProduct(row)
  const unit = inferStandardUnit(row)
  const base = product?.id || row.product_id || normalizeText(getProductName(row))
  return `${base}__${unit}`
}

function average(values) {
  if (!values.length) return null
  return values.reduce((acc, value) => acc + Number(value || 0), 0) / values.length
}

function buildRanking(rows, searchTerm) {
  const term = normalizeText(searchTerm)
  const groups = {}

  rows.forEach(row => {
    const productName = getProductName(row)
    const category = getProductCategory(row)
    const standardUnit = inferStandardUnit(row)
    const searchText = normalizeText(`${productName} ${category} ${row.product_name || ''} ${row.brand || ''}`)

    if (term && !searchText.includes(term)) return

    const groupKey = getProductKey(row)
    const unitPrice = Number(row.unit_price)
    const compatible = isCompatibleUnit(row.unit, standardUnit)

    if (!groups[groupKey]) {
      groups[groupKey] = {
        product_name: productName,
        category,
        unit: standardUnit,
        total_count: 0,
        skipped_count: 0,
        stores: {},
      }
    }

    groups[groupKey].total_count += 1

    if (!compatible || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      groups[groupKey].skipped_count += 1
      return
    }

    const storeKey = `${normalizeText(row.store_name)}__${row.sector || ''}`
    if (!groups[groupKey].stores[storeKey]) {
      groups[groupKey].stores[storeKey] = {
        store_name: row.store_name || 'Tienda sin nombre',
        sector: row.sector || 'Sin sector',
        unit: standardUnit,
        unit_prices: [],
        entries: [],
        latest_date: null,
      }
    }

    const store = groups[groupKey].stores[storeKey]
    store.unit_prices.push(unitPrice)
    store.entries.push(row)
    if (!store.latest_date || row.purchase_date > store.latest_date) {
      store.latest_date = row.purchase_date
    }
  })

  return Object.values(groups)
    .map(group => {
      const stores = Object.values(group.stores)
        .map(store => {
          const minUnitPrice = Math.min(...store.unit_prices)
          const bestEntry = store.entries.find(entry => Number(entry.unit_price) === minUnitPrice) || store.entries[0]

          return {
            ...store,
            min_unit_price: minUnitPrice,
            avg_unit_price: average(store.unit_prices),
            sample_count: store.unit_prices.length,
            best_entry: bestEntry,
          }
        })
        .sort((a, b) => a.min_unit_price - b.min_unit_price)

      return {
        ...group,
        stores,
        comparable_count: stores.reduce((acc, store) => acc + store.sample_count, 0),
      }
    })
    .filter(group => group.stores.length > 0)
    .sort((a, b) => {
      if (b.comparable_count !== a.comparable_count) return b.comparable_count - a.comparable_count
      return a.product_name.localeCompare(b.product_name, 'es')
    })
}

function StatPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-sm backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-black text-slate-900">{value}</p>
    </div>
  )
}

export default function Ranking() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'reportes' ? 'reportes' : 'ranking'
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('')
  const [period, setPeriod] = useState('30d')
  const [rows, setRows] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(null)

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)

    let request = supabase
      .from('price_entries')
      .select(`
        id,
        product_id,
        product_name,
        brand,
        quantity,
        unit,
        price,
        unit_price,
        store_name,
        sector,
        purchase_date,
        validation_status,
        products(id, name, category, subcategory, default_unit)
      `)
      .eq('validation_status', 'approved')
      .order('purchase_date', { ascending: false })
      .limit(2500)

    if (period === '30d') {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      request = request.gte('purchase_date', since.toISOString().slice(0, 10))
    }

    if (period === '90d') {
      const since = new Date()
      since.setDate(since.getDate() - 90)
      request = request.gte('purchase_date', since.toISOString().slice(0, 10))
    }

    if (sector) request = request.eq('sector', sector)

    const { data, error: fetchError } = await request

    if (fetchError) {
      setError(fetchError.message)
      setRows([])
      setResults([])
      setLoading(false)
      return
    }

    const nextRows = data || []
    setRows(nextRows)
    setResults(buildRanking(nextRows, query))
    setLoading(false)
  }, [period, sector, query])

  useEffect(() => {
    loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, sector])

  function handleSearch(e) {
    e.preventDefault()
    setResults(buildRanking(rows, query))
    setSearched(true)
  }

  function changeTab(tab) {
    setSearchParams(tab === 'reportes' ? { tab: 'reportes' } : {})
  }

  if (activeTab === 'reportes') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="px-4 pt-5">
          <div className="rounded-[1.75rem] border border-white bg-gradient-to-br from-white to-blue-50/70 p-4 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Precios</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Ranking y reportes en un mismo lugar, comparados por unidad estándar.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              <button type="button" onClick={() => changeTab('ranking')} className="py-2 rounded-xl text-sm font-bold text-slate-500">Ranking</button>
              <button type="button" onClick={() => changeTab('reportes')} className="py-2 rounded-xl text-sm font-bold bg-white text-brand-600 shadow-sm">Reportes</button>
            </div>
          </div>
        </div>
        <Report />
      </div>
    )
  }

  const totalComparable = results.reduce((acc, group) => acc + group.comparable_count, 0)

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <div className="rounded-[1.75rem] border border-white bg-gradient-to-br from-white via-blue-50/70 to-emerald-50/40 p-4 shadow-sm mb-5">
        <h2 className="text-xl font-black text-slate-950">Precios</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Compara tiendas usando precio estándar por kg, litro, unidad, caja o par según el producto.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          <button type="button" onClick={() => changeTab('ranking')} className="py-2 rounded-xl text-sm font-bold bg-white text-brand-600 shadow-sm">Ranking</button>
          <button type="button" onClick={() => changeTab('reportes')} className="py-2 rounded-xl text-sm font-bold text-slate-500">Reportes</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <StatPill label="Productos" value={results.length} />
          <StatPill label="Datos comparables" value={totalComparable} />
        </div>
      </div>

      <form onSubmit={handleSearch} className="space-y-3 mb-5">
        <div className="flex gap-2">
          <input type="text" placeholder="Buscar producto…" value={query} onChange={e => setQuery(e.target.value)} className="input-field flex-1" />
          <button type="submit" className="btn-primary px-4 rounded-2xl">Buscar</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select value={sector} onChange={e => setSector(e.target.value)} className="input-field">
            <option value="">Todos los sectores</option>
            {SECTORES_RANCAGUA.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={period} onChange={e => setPeriod(e.target.value)} className="input-field">
            <option value="30d">Últimos 30 días</option>
            <option value="90d">Últimos 90 días</option>
            <option value="all">Todos</option>
          </select>
        </div>
      </form>

      {error && <div className="card border-danger-200 bg-danger-50/40 mb-4"><p className="text-sm text-danger-600">No se pudo cargar el ranking: {error}</p></div>}
      {loading && <Spinner />}

      {!loading && searched && results.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-slate-500 text-sm">Sin resultados comparables. Intenta con otro producto, sector o período.</p>
        </div>
      )}

      {!loading && results.map((group, gi) => (
        <div key={`${group.product_name}-${gi}`} className="mb-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 className="font-black text-slate-900">{group.product_name}</h3>
              <p className="text-xs text-slate-400">{group.category} · ranking por {group.unit === 'unidad' ? 'unidad' : group.unit}</p>
            </div>
            <span className="text-xs bg-brand-50 text-brand-600 px-2 py-1 rounded-full font-semibold shrink-0">{group.comparable_count} datos</span>
          </div>

          <div className="space-y-2">
            {group.stores.slice(0, 8).map((store, i) => (
              <div key={`${store.store_name}-${store.sector}-${i}`} className={`card flex items-center justify-between gap-3 ${i === 0 ? 'border-success-500/40 bg-success-50/30 animate-pulse-green' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-success-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{store.store_name}</p>
                    <p className="text-xs text-slate-400 truncate">{store.sector}</p>
                    {store.best_entry?.brand && <p className="text-[11px] text-slate-400 truncate">Marca: {store.best_entry.brand}</p>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-black text-brand-600 text-base">{formatUnitPrice(store.min_unit_price, group.unit)}</p>
                  <p className="text-xs text-slate-400">Compra real: {formatCLP(store.best_entry?.price)}</p>
                  <p className="text-[11px] text-slate-400">{store.sample_count} registro{store.sample_count === 1 ? '' : 's'}</p>
                  {i === 0 && <span className="badge-lowest mt-1">Mejor estándar</span>}
                </div>
              </div>
            ))}
          </div>

          {group.skipped_count > 0 && (
            <p className="text-xs text-amber-600 mt-2">{group.skipped_count} registro{group.skipped_count === 1 ? '' : 's'} no se usaron porque no tenían una unidad comparable con {group.unit}.</p>
          )}
        </div>
      ))}
    </div>
  )
}
