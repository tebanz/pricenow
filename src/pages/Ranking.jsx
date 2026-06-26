import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Report from './Report'
import { supabase } from '../lib/supabase'
import { calcUnitPrice, formatCLP, formatUnitPrice } from '../utils/priceCalc'
import { getDistanceMeters, getStoredZone, isValidCoordinate, PRICE_NOW_ZONE_EVENT, rowCity, rowCommune, rowMatchesCity, rowMatchesSector, rowSector, zoneCity, zoneSector, zoneSubtitle } from '../utils/location'
import { effectivePrice, hasOffer, paymentConditionLabel } from '../utils/discounts'
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
  return product?.category || row.web_category || inferCategory(row)
}

function getWebProduct(row) {
  return Array.isArray(row.web_catalog_products) ? row.web_catalog_products[0] : row.web_catalog_products
}

function getWebStore(row) {
  return Array.isArray(row.stores) ? row.stores[0] : row.stores
}

function normalizeWebUnit(unit = '') {
  const key = normalizeText(unit)
  if (['kg', 'kilogramo', 'kilogramos'].includes(key)) return 'kg'
  if (['g', 'gr', 'gramo', 'gramos'].includes(key)) return 'g'
  if (['l', 'lt', 'litro', 'litros'].includes(key)) return 'litro'
  if (['ml', 'cc', 'mililitro', 'mililitros'].includes(key)) return 'ml'
  if (['caja'].includes(key)) return 'caja'
  if (['par'].includes(key)) return 'par'
  return 'unidad'
}

function webObservationToRankingRow(row) {
  const product = getWebProduct(row) || {}
  const store = getWebStore(row) || {}
  const unit = normalizeWebUnit(product.unit)
  const storeName = store.name || `${row.chain_name || 'Supermercado'} online`
  const webZone = row.location_scope === 'online_national'
    ? 'Online Chile'
    : row.location_verified && (row.city || row.commune)
      ? `Online ${row.city || row.commune}`
      : 'Online - zona no confirmada'

  return {
    id: `web-${row.id}`,
    product_id: product.product_id || null,
    product_name: product.name || 'Producto web',
    web_category: product.category || 'Sin categoria',
    brand: product.brand || '',
    quantity: Number(product.quantity) > 0 ? Number(product.quantity) : 1,
    unit,
    price: Number(row.final_price),
    normal_price: row.normal_price,
    final_price: row.final_price,
    unit_price: row.unit_price,
    store_id: row.store_id,
    store_name: storeName,
    sector: store.sector || webZone,
    city: row.city || store.city || '',
    commune: row.commune || store.commune || '',
    purchase_latitude: store.latitude,
    purchase_longitude: store.longitude,
    purchase_date: row.captured_at?.slice(0, 10),
    source_channel: 'web',
    source_url: row.source_url,
    captured_at: row.captured_at,
    location_scope: row.location_scope,
    location_verified: Boolean(row.location_verified),
    stock_status: row.stock_status,
    promotion_text: row.promotion_text,
    validation_status: 'approved',
    products: null,
  }
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

function productComparisonSignature(row) {
  const brand = normalizeText(row.brand || '')
  const unit = comparableUnit(row.unit)
  const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 1
  const stopwords = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'bolsa', 'envase', 'contenido', 'jumbo', 'unimarc', 'tottus', 'lider'])
  const tokens = normalizeText(getProductName(row))
    .replace(/\bgrado 1\b/g, ' g1 ')
    .replace(/\bgrado 2\b/g, ' g2 ')
    .split(' ')
    .filter(token => token && !stopwords.has(token) && !/^\d+(?:kg|g|ml|l|cc)?$/.test(token))
  const uniqueSorted = [...new Set(tokens)].sort().join('_')
  return `${brand}__${uniqueSorted}__${quantity}_${unit}`
}

function getProductKey(row) {
  const product = getLinkedProduct(row)
  const unit = inferStandardUnit(row)
  const base = product?.id || row.product_id || productComparisonSignature(row)
  return `${base}__${unit}`
}

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
  if (zoneMode === 'city' || zoneMode === 'commune') {
    if (!zoneCity(zone)) return rows.filter(row => row.source_channel !== 'web' || row.location_scope === 'online_national')
    return rows.filter(row => {
      if (row.source_channel === 'web' && !row.location_verified) return false
      if (row.source_channel === 'web' && row.location_scope === 'online_national') return true
      return rowMatchesCity(row, zone)
    })
  }
  if (zoneMode === 'sector') {
    if (!zoneSector(zone)) return rows.filter(row => row.source_channel !== 'web')
    return rows.filter(row => {
      if (row.source_channel === 'web' && row.location_scope !== 'branch_confirmed') return false
      return rowMatchesSector(row, zone)
    })
  }
  if (zoneMode === 'nearby') {
    if (!isValidCoordinate(zone?.lat, zone?.lng)) return rows.filter(row => row.source_channel !== 'web')
    return rows.filter(row => {
      if (row.source_channel === 'web' && row.location_scope !== 'branch_confirmed') return false
      const distance = rowDistanceFromZone(row, zone)
      return distance != null && distance <= 5000
    })
  }
  return rows
}

function zoneFilterLabel(zoneMode, zone) {
  if (zoneMode === 'nearby') return 'Cerca de mi'
  if ((zoneMode === 'city' || zoneMode === 'commune') && zoneCity(zone)) return zoneCity(zone)
  if (zoneMode === 'city' || zoneMode === 'commune') return 'Mi ciudad'
  if (zoneMode === 'sector' && zoneSector(zone)) return zoneSubtitle(zone)
  if (zoneMode === 'sector') return 'Mi sector'
  return 'Todas las zonas'
}

function buildRanking(rows, searchTerm, categoryFilter = 'all', sortMode = 'category_price') {
  const term = normalizeText(searchTerm)
  const groups = {}

  rows.forEach(row => {
    const productName = getProductName(row)
    const category = getProductCategory(row)
    const standardUnit = inferStandardUnit(row)
    const searchText = normalizeText(`${productName} ${category} ${row.product_name || ''} ${row.brand || ''}`)

    if (term && !searchText.includes(term)) return
    if (categoryFilter !== 'all' && category !== categoryFilter) return

    const groupKey = getProductKey(row)
    const unitPrice = effectiveUnitPrice(row)
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

    const storeZone = [rowCity(row) || rowCommune(row), rowSector(row)].filter(Boolean).join(' - ') || 'Sin zona'
    const storeKey = `${normalizeText(row.store_name)}__${storeZone}__${row.source_channel || 'presencial'}`
    if (!groups[groupKey].stores[storeKey]) {
      groups[groupKey].stores[storeKey] = {
        store_name: row.store_name || 'Tienda sin nombre',
        sector: storeZone,
        unit: standardUnit,
        source_channel: row.source_channel || 'presencial',
        location_scope: row.location_scope || null,
        unit_prices: [],
        entries: [],
        latest_date: null,
      }
    }

    const store = groups[groupKey].stores[storeKey]
    store.unit_prices.push(unitPrice)
    store.entries.push(row)
    if (!store.latest_date || row.purchase_date > store.latest_date) store.latest_date = row.purchase_date
  })

  const ranking = Object.values(groups)
    .map(group => {
      const stores = Object.values(group.stores)
        .map(store => {
          const bestEntry = store.entries.reduce((best, entry) => {
            if (!best) return entry
            return effectiveUnitPrice(entry) < effectiveUnitPrice(best) ? entry : best
          }, null)
          const minUnitPrice = effectiveUnitPrice(bestEntry)

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
        lowest_price: stores[0]?.min_unit_price ?? Number.POSITIVE_INFINITY,
        comparable_count: stores.reduce((acc, store) => acc + store.sample_count, 0),
      }
    })
    .filter(group => group.stores.length > 0)

  ranking.sort((a, b) => {
    if (sortMode === 'price_asc') return a.lowest_price - b.lowest_price || a.product_name.localeCompare(b.product_name, 'es')
    if (sortMode === 'price_desc') return b.lowest_price - a.lowest_price || a.product_name.localeCompare(b.product_name, 'es')
    if (sortMode === 'name') return a.product_name.localeCompare(b.product_name, 'es')
    const categoryCompare = a.category.localeCompare(b.category, 'es')
    if (categoryCompare !== 0) return categoryCompare
    return a.lowest_price - b.lowest_price || a.product_name.localeCompare(b.product_name, 'es')
  })

  return ranking
}

async function fetchAllPages(buildQuery, pageSize = 1000, maxPages = 50) {
  const rows = []
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize
    const to = from + pageSize - 1
    // eslint-disable-next-line no-await-in-loop
    const result = await buildQuery().range(from, to)
    if (result.error) return { data: rows, error: result.error, truncated: false }
    const batch = result.data || []
    rows.push(...batch)
    if (batch.length < pageSize) return { data: rows, error: null, truncated: false }
  }
  return { data: rows, error: null, truncated: true }
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
  const [zoneMode, setZoneMode] = useState(() => zoneCity(getStoredZone()) ? 'city' : 'all')
  const [currentZone, setCurrentZone] = useState(() => getStoredZone())
  const [period, setPeriod] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortMode, setSortMode] = useState('category_price')
  const [rows, setRows] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const updateZone = event => setCurrentZone(event?.detail || getStoredZone())
    window.addEventListener(PRICE_NOW_ZONE_EVENT, updateZone)
    window.addEventListener('storage', updateZone)
    return () => {
      window.removeEventListener(PRICE_NOW_ZONE_EVENT, updateZone)
      window.removeEventListener('storage', updateZone)
    }
  }, [])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)

    const since = period === '30d' || period === '90d'
      ? (() => {
        const value = new Date()
        value.setDate(value.getDate() - (period === '30d' ? 30 : 90))
        return value
      })()
      : null

    const buildPriceRequest = () => {
      let request = supabase
        .from('price_entries')
        .select(`
          *,
          products(id, name, category, subcategory, default_unit),
          stores(id, is_active)
        `)
        .eq('validation_status', 'approved')
        .order('purchase_date', { ascending: false })
      if (since) request = request.gte('purchase_date', since.toISOString().slice(0, 10))
      return request
    }

    const buildWebRequest = () => {
      let request = supabase
        .from('web_price_observations')
        .select(`
          id, web_product_id, chain_name, store_id, city, commune, location_scope, location_verified,
          normal_price, final_price, unit_price, unit_label, promotion_text, stock_status, source_url, captured_at,
          web_catalog_products(id, product_id, name, brand, category, package_text, quantity, unit),
          stores(id, name, sector, city, commune, latitude, longitude, is_active)
        `)
        .eq('review_status', 'approved')
        .neq('stock_status', 'out_of_stock')
        .order('captured_at', { ascending: false })
      if (since) request = request.gte('captured_at', since.toISOString())
      return request
    }

    const [priceResult, webResult] = await Promise.all([
      fetchAllPages(buildPriceRequest),
      fetchAllPages(buildWebRequest),
    ])

    if (priceResult.error) {
      setError(priceResult.error.message)
      setRows([])
      setResults([])
      setLoading(false)
      return
    }

    const webTableMissing = webResult.error && (
      webResult.error.code === 'PGRST205' ||
      webResult.error.code === '42P01' ||
      /web_price_observations|schema cache|relation/i.test(webResult.error.message || '')
    )

    if (webResult.error && !webTableMissing) {
      console.error('EdePrecios web prices load failed:', webResult.error)
    }

    const approvedStoreRows = (priceResult.data || []).filter(row => {
      const store = getWebStore(row)
      return !store || store.is_active !== false
    })
    const approvedWebRows = webResult.error ? [] : (webResult.data || [])
      .filter(row => {
        const store = getWebStore(row)
        return !store || store.is_active !== false
      })
      .map(webObservationToRankingRow)

    if (priceResult.truncated || webResult.truncated) {
      console.warn('EdePrecios ranking reached the pagination safety limit.')
    }

    const combinedRows = [...approvedStoreRows, ...approvedWebRows]
    const nextRows = filterRowsByZone(combinedRows, zoneMode, currentZone)
    setRows(nextRows)
    setResults(buildRanking(nextRows, query, categoryFilter, sortMode))
    setLoading(false)
  }, [period, zoneMode, currentZone?.city, currentZone?.commune, currentZone?.sector, currentZone?.suburb, currentZone?.district, currentZone?.lat, currentZone?.lng, query, categoryFilter, sortMode])

  useEffect(() => {
    loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, zoneMode, currentZone?.city, currentZone?.commune, currentZone?.sector, currentZone?.suburb, currentZone?.district, currentZone?.lat, currentZone?.lng])

  useEffect(() => {
    setResults(buildRanking(rows, query, categoryFilter, sortMode))
    // Search text is intentionally applied with the Buscar button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, sortMode])

  function handleSearch(e) {
    e.preventDefault()
    setResults(buildRanking(rows, query, categoryFilter, sortMode))
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

  const categories = [...new Set(rows.map(row => getProductCategory(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
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
          <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Buscar precios en
            <select value={zoneMode} onChange={e => setZoneMode(e.target.value)} className="input-field normal-case tracking-normal">
              <option value="nearby">Cerca de mi</option>
              <option value="city">Mi ciudad</option>
              {zoneSector(currentZone) && <option value="sector">Mi sector</option>}
              <option value="all">Todas las zonas</option>
            </select>
          </label>

          <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Periodo
            <select value={period} onChange={e => setPeriod(e.target.value)} className="input-field normal-case tracking-normal">
              <option value="all">Todos los aprobados</option>
              <option value="30d">Ultimos 30 dias</option>
              <option value="90d">Ultimos 90 dias</option>
            </select>
          </label>

          <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Categoria
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input-field normal-case tracking-normal">
              <option value="all">Todas</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>

          <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
            Orden
            <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="input-field normal-case tracking-normal">
              <option value="category_price">Categoria y menor precio</option>
              <option value="price_asc">Menor precio</option>
              <option value="price_desc">Mayor precio</option>
              <option value="name">Nombre</option>
            </select>
          </label>
        </div>
        <p className="text-xs font-semibold text-slate-400">Zona: {zoneFilterLabel(zoneMode, currentZone)}</p>
      </form>

      {error && <div className="card border-danger-200 bg-danger-50/40 mb-4"><p className="text-sm text-danger-600">No se pudo cargar el ranking: {error}</p></div>}
      {loading && <Spinner />}

      {!loading && searched && results.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-slate-500 text-sm">Sin resultados comparables. Intenta con otro producto, zona o periodo.</p>
        </div>
      )}

      {!loading && results.map((group, gi) => {
        const showCategoryHeader = gi === 0 || results[gi - 1]?.category !== group.category
        return (
        <div key={`${group.product_name}-${gi}`} className="mb-5">
          {showCategoryHeader && sortMode === 'category_price' && (
            <div className="mb-3 mt-6 flex items-center gap-2">
              <div className="h-px flex-1 bg-slate-200" />
              <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{group.category}</h3>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          )}
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
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hasOffer(store.best_entry) && <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Oferta</span>}
                      {store.source_channel === 'web' && <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">Precio web</span>}
                      {store.source_channel === 'web' && !store.best_entry?.location_verified && <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Zona no confirmada</span>}
                    </div>
                    {store.best_entry?.brand && <p className="text-[11px] text-slate-400 truncate">Marca: {store.best_entry.brand}</p>}
                    {store.source_channel === 'web' && store.best_entry?.source_url && <a href={store.best_entry.source_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600 underline">Fuente oficial</a>}
                    {paymentConditionLabel(store.best_entry) && <p className="text-[11px] font-semibold text-blue-600 truncate">Con {paymentConditionLabel(store.best_entry)}</p>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-black text-brand-600 text-base">{formatUnitPrice(store.min_unit_price, group.unit)}</p>
                  <p className="text-xs text-slate-400">{store.source_channel === 'web' ? 'Precio publicado' : 'Compra real'}: {formatCLP(effectivePrice(store.best_entry))}</p>
                  <p className="text-[11px] text-slate-400">{store.sample_count} registro{store.sample_count === 1 ? '' : 's'}</p>
                  {store.latest_date && <p className="text-[10px] text-slate-400">Actualizado: {new Date(`${store.latest_date}T12:00:00`).toLocaleDateString('es-CL')}</p>}
                  {i === 0 && <span className="badge-lowest mt-1">Mejor estándar</span>}
                </div>
              </div>
            ))}
          </div>

          {group.skipped_count > 0 && (
            <p className="text-xs text-amber-600 mt-2">{group.skipped_count} registro{group.skipped_count === 1 ? '' : 's'} no se usaron porque no tenían una unidad comparable con {group.unit}.</p>
          )}
        </div>
        )
      })}
    </div>
  )
}
