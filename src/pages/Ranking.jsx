import { useState, useEffect, useCallback } from 'react'
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

function isCompatibleUnit(rowUnit, standardUnit) {
  return comparableUnit(rowUnit) === comparableUnit(standardUnit)
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
  return product?.category || 'Sin categoría'
}

function getStandardUnit(row) {
  const product = getLinkedProduct(row)
  return comparableUnit(product?.default_unit || row.unit || 'unidad')
}

function getProductKey(row) {
  const product = getLinkedProduct(row)
  const unit = getStandardUnit(row)
  return row.product_id
    ? `${row.product_id}__${unit}`
    : `${normalizeText(getProductName(row))}__${unit}`
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
    const standardUnit = getStandardUnit(row)
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

export default function Ranking() {
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
      .limit(1500)

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

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Ranking de precios</h2>
      <p className="text-sm text-slate-500 mb-4">
        Compara tiendas usando precio estándar por kg, litro, unidad, caja o par según el producto.
      </p>

      <form onSubmit={handleSearch} className="space-y-3 mb-5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Buscar producto…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input-field flex-1"
          />
          <button
            type="submit"
            className="bg-brand-500 text-white px-4 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          >
            Buscar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            className="input-field"
          >
            <option value="">Todos los sectores</option>
            {SECTORES_RANCAGUA.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="input-field"
          >
            <option value="30d">Últimos 30 días</option>
            <option value="90d">Últimos 90 días</option>
            <option value="all">Todos</option>
          </select>
        </div>
      </form>

      {error && (
        <div className="card border-danger-200 bg-danger-50/40 mb-4">
          <p className="text-sm text-danger-600">No se pudo cargar el ranking: {error}</p>
        </div>
      )}

      {loading && <Spinner />}

      {!loading && searched && results.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-slate-500 text-sm">
            Sin resultados comparables. Intenta con otro producto, sector o período.
          </p>
        </div>
      )}

      {!loading && results.map((group, gi) => (
        <div key={`${group.product_name}-${gi}`} className="mb-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 className="font-bold text-slate-800">{group.product_name}</h3>
              <p className="text-xs text-slate-400">
                {group.category} · ranking por {group.unit === 'unidad' ? 'unidad' : group.unit}
              </p>
            </div>
            <span className="text-xs bg-brand-50 text-brand-600 px-2 py-1 rounded-full font-semibold shrink-0">
              {group.comparable_count} datos
            </span>
          </div>

          <div className="space-y-2">
            {group.stores.slice(0, 8).map((store, i) => (
              <div
                key={`${store.store_name}-${store.sector}-${i}`}
                className={`card flex items-center justify-between gap-3 ${
                  i === 0 ? 'border-success-500/40 bg-success-50/30 animate-pulse-green' : ''
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0
                      ? 'bg-success-500 text-white'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{store.store_name}</p>
                    <p className="text-xs text-slate-400 truncate">{store.sector}</p>
                    {store.best_entry?.brand && (
                      <p className="text-[11px] text-slate-400 truncate">Marca: {store.best_entry.brand}</p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-brand-500 text-base">
                    {formatUnitPrice(store.min_unit_price, group.unit)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Compra real: {formatCLP(store.best_entry?.price)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {store.sample_count} registro{store.sample_count === 1 ? '' : 's'}
                  </p>
                  {i === 0 && (
                    <span className="badge-lowest mt-1">
                      <svg className="w-3 h-3 fill-success-600" viewBox="0 0 24 24">
                        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                      </svg>
                      Mejor estándar
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {group.skipped_count > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              {group.skipped_count} registro{group.skipped_count === 1 ? '' : 's'} no se usaron porque no tenían una unidad comparable con {group.unit}.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
