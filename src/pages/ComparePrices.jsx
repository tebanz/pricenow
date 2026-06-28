import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../utils/priceCalc'
import {
  buildListSummary,
  enrichSearchText,
  filterComparableRows,
  formatDate,
  groupRowsByFormat,
  normalizeCompareText,
  unifyPriceEntry,
  unifyWebObservation,
} from '../utils/comparePrices'
import {
  formatDistance,
  getStoredZone,
  isValidCoordinate,
  PRICE_NOW_ZONE_EVENT,
  reverseGeocode,
  setStoredZone,
  zoneCity,
  zoneSector,
} from '../utils/location'

const LIST_KEY = 'edeprecios_compare_list'
const ZONE_OPTIONS = [
  { value: 'nearby', label: 'Cerca de mi' },
  { value: 'city', label: 'Toda mi ciudad' },
  { value: 'sector', label: 'Mi sector' },
  { value: 'all', label: 'Todo Chile' },
]

function readList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveList(items) {
  localStorage.setItem(LIST_KEY, JSON.stringify(items))
}

function attachLookups(row, productMap, storeMap) {
  return {
    ...row,
    product: row.product_id ? productMap.get(String(row.product_id)) || null : null,
    store: row.store_id ? storeMap.get(String(row.store_id)) || null : null,
  }
}

function ResultCard({ row, index, maxPrice, selected, onToggleSelected, onAdd }) {
  const saving = maxPrice && maxPrice > row.final_price ? maxPrice - row.final_price : 0
  return (
    <article className={`rounded-[1.75rem] border bg-white p-4 shadow-sm ${index === 0 ? 'border-emerald-200 ring-2 ring-emerald-50' : 'border-slate-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {index === 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">Mas barato</span>}
            {row.has_offer && <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">Oferta</span>}
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{row.source_label}</span>
          </div>
          <h3 className="mt-2 font-black text-slate-900">{row.product_name}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">{[row.brand, row.format_label].filter(Boolean).join(' - ') || row.category}</p>
        </div>
        <label className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
          <input className="mr-2" type="checkbox" checked={selected} onChange={onToggleSelected} />
          Comparar
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <p className="text-2xl font-black text-blue-700">{formatCLP(row.final_price)}</p>
        {row.normal_price && <p className="pb-1 text-sm font-bold text-slate-400 line-through">{formatCLP(row.normal_price)}</p>}
      </div>
      {index === 0 && saving > 0 && <p className="mt-1 text-sm font-bold text-emerald-700">Ahorras {formatCLP(saving)} frente a la opcion mas cara.</p>}

      <div className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 text-sm">
        <p><b>{row.store_name}</b>{row.branch_name ? ` - ${row.branch_name}` : ''}</p>
        <p className="text-xs text-slate-500">
          {row.distance_m != null ? `${formatDistance(row.distance_m)} - ` : ''}
          {formatDate(row.date)} - {row.source_detail}
        </p>
        {(row.offer_text || row.payment_condition) && (
          <p className="text-xs font-bold text-amber-700">{row.offer_text || row.payment_condition}</p>
        )}
      </div>

      <button type="button" onClick={onAdd} className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
        Agregar a mi lista
      </button>
    </article>
  )
}

export default function ComparePrices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const [query, setQuery] = useState(initialQuery)
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [category, setCategory] = useState('all')
  const [zoneMode, setZoneMode] = useState('nearby')
  const [zone, setZone] = useState(() => getStoredZone())
  const [products, setProducts] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [selectedFormatKey, setSelectedFormatKey] = useState('')
  const [selectedRows, setSelectedRows] = useState([])
  const [shoppingList, setShoppingList] = useState(() => readList())

  useEffect(() => {
    function onZoneChange(event) {
      setZone(event.detail || getStoredZone())
    }
    window.addEventListener(PRICE_NOW_ZONE_EVENT, onZoneChange)
    window.addEventListener('storage', onZoneChange)
    return () => {
      window.removeEventListener(PRICE_NOW_ZONE_EVENT, onZoneChange)
      window.removeEventListener('storage', onZoneChange)
    }
  }, [])

  useEffect(() => {
    saveList(shoppingList)
  }, [shoppingList])

  async function loadData() {
    setLoading(true)
    setMessage(null)
    try {
      const productRequest = supabase
        .from('products')
        .select('id,name,canonical_name,category,subcategory,default_unit,is_active')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(700)

      const priceRequest = supabase
        .from('price_entries')
        .select(`
          id,
          product_id,
          product_name,
          brand,
          quantity,
          unit,
          price,
          normal_price,
          final_price,
          store_id,
          store_name,
          city,
          commune,
          validation_status,
          created_at
        `)
        .eq('validation_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1000)

      const storesRequest = supabase
        .from('stores')
        .select('*')
        .limit(1000)

      const webRequest = supabase
        .from('web_price_observations')
        .select(`
          id, web_product_id, chain_name, store_id, city, commune, location_scope, location_verified,
          normal_price, final_price, unit_price, unit_label, promotion_text, stock_status, source_url, captured_at, verification_status,
          product:web_catalog_products!web_price_observations_web_product_id_fkey(id,product_id,name,brand,category,package_text,quantity,unit,provider),
          stores(*)
        `)
        .eq('verification_status', 'approved')
        .neq('stock_status', 'out_of_stock')
        .order('captured_at', { ascending: false })
        .limit(700)

      const [productRes, priceRes, storesRes, webRes] = await Promise.all([productRequest, priceRequest, storesRequest, webRequest])
      const errors = []

      if (productRes.error) {
        console.error('EdePrecios products compare load failed:', productRes.error)
        errors.push(`Productos: ${productRes.error.message}`)
      }
      if (priceRes.error) {
        console.error('EdePrecios price entries compare load failed:', priceRes.error)
        errors.push(`Precios presenciales: ${priceRes.error.message}`)
      }
      if (storesRes.error) {
        console.error('EdePrecios stores compare load failed:', storesRes.error)
        errors.push(`Supermercados: ${storesRes.error.message}`)
      }
      if (webRes.error) {
        console.error('EdePrecios web observations compare load failed:', webRes.error)
        errors.push(`Precios web: ${webRes.error.message}`)
      }

      if (errors.length) {
        setMessage({ type: priceRes.error ? 'error' : 'warning', text: errors.join(' | ') })
      }

      const productList = Array.isArray(productRes.data) ? productRes.data : []
      const storeList = Array.isArray(storesRes.data) ? storesRes.data : []
      const productMap = new Map(productList.map(product => [String(product.id), product]))
      const storeMap = new Map(storeList.map(store => [String(store.id), store]))

      const physicalRows = priceRes.error
        ? []
        : (Array.isArray(priceRes.data) ? priceRes.data : [])
          .map(row => attachLookups(row, productMap, storeMap))
          .map(unifyPriceEntry)
          .filter(Boolean)
      const webRows = webRes.error
        ? []
        : (Array.isArray(webRes.data) ? webRes.data : []).map(unifyWebObservation).filter(Boolean)

      setProducts(productList)
      setRows([...physicalRows, ...webRows].map(enrichSearchText))
    } catch (error) {
      console.error('EdePrecios compare load crashed:', error)
      setMessage({ type: 'error', text: `No pudimos cargar el comparador: ${error.message || 'error inesperado'}` })
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const activeZone = zone || null
  const categories = useMemo(() => {
    const values = new Set()
    products.forEach(product => product.category && values.add(product.category))
    rows.forEach(row => row.category && values.add(row.category))
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [products, rows])

  const suggestions = useMemo(() => {
    const term = normalizeCompareText(query)
    if (term.length < 2) return []
    const productSuggestions = products
      .filter(product => category === 'all' || product.category === category)
      .filter(product => normalizeCompareText(`${product.name} ${product.category} ${product.subcategory}`).includes(term))
      .map(product => ({
        key: `product-${product.id}`,
        label: product.name,
        meta: [product.category, product.default_unit].filter(Boolean).join(' - '),
      }))
    const rowSuggestions = rows
      .filter(row => category === 'all' || row.category === category)
      .filter(row => row.search_text.includes(term))
      .map(row => ({
        key: `row-${row.compare_key}`,
        label: row.product_name,
        meta: [row.brand, row.format_label, row.category].filter(Boolean).join(' - '),
      }))
    const unique = new Map()
    ;[...productSuggestions, ...rowSuggestions].forEach(item => {
      const key = normalizeCompareText(`${item.label} ${item.meta}`)
      if (!unique.has(key)) unique.set(key, item)
    })
    return Array.from(unique.values()).slice(0, 6)
  }, [query, products, rows, category])

  const filteredRows = useMemo(() => {
    if (!activeQuery.trim()) return []
    return filterComparableRows(rows, {
      query: activeQuery,
      category,
      zoneMode,
      zone: activeZone,
    })
  }, [rows, activeQuery, category, zoneMode, activeZone])

  const formatGroups = useMemo(() => groupRowsByFormat(filteredRows), [filteredRows])
  const selectedGroup = formatGroups.find(group => group.key === selectedFormatKey) || formatGroups[0] || null
  const resultRows = selectedGroup?.rows || []
  const maxResultPrice = resultRows.length ? Math.max(...resultRows.map(row => row.final_price)) : null

  useEffect(() => {
    if (!formatGroups.length) {
      setSelectedFormatKey('')
      return
    }
    if (!formatGroups.some(group => group.key === selectedFormatKey)) {
      setSelectedFormatKey(formatGroups[0].key)
      setSelectedRows([])
    }
  }, [formatGroups, selectedFormatKey])

  const listPricePool = useMemo(() => filterComparableRows(rows, {
    query: '',
    category: 'all',
    zoneMode,
    zone: activeZone,
  }), [rows, zoneMode, activeZone])

  const listSummary = useMemo(() => buildListSummary(shoppingList, listPricePool), [shoppingList, listPricePool])

  function runSearch(event) {
    event?.preventDefault()
    const clean = query.trim()
    setActiveQuery(clean)
    setSearchParams(clean ? { q: clean } : {})
    setSelectedRows([])
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage({ type: 'error', text: 'Tu navegador no permite obtener ubicacion.' })
      return
    }
    setMessage({ type: 'ok', text: 'Buscando tu ubicacion...' })
    navigator.geolocation.getCurrentPosition(
      position => {
        const nextZone = {
          ...(zone || {}),
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
          source: 'gps',
          confirmed: true,
        }
        setZone(nextZone)
        setStoredZone(nextZone)
        reverseGeocode(nextZone.lat, nextZone.lng)
          .then(detected => detected && setZone(setStoredZone({ ...nextZone, ...detected, lat: nextZone.lat, lng: nextZone.lng })))
          .catch(() => {})
        setMessage({ type: 'ok', text: 'Ubicacion actualizada para comparar cerca de ti.' })
      },
      () => setMessage({ type: 'error', text: 'No pudimos obtener tu ubicacion. Puedes usar Toda mi ciudad o Todo Chile.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  function toggleSelected(row) {
    setSelectedRows(current => {
      if (current.includes(row.id)) return current.filter(id => id !== row.id)
      if (current.length >= 4) return current
      return [...current, row.id]
    })
  }

  function addToList(row) {
    setShoppingList(current => {
      const existing = current.find(item => item.compare_key === row.compare_key)
      if (existing) {
        return current.map(item => item.compare_key === row.compare_key ? { ...item, quantity: Number(item.quantity) + 1 } : item)
      }
      return [
        ...current,
        {
          compare_key: row.compare_key,
          product_name: row.product_name,
          brand: row.brand,
          format_label: row.format_label,
          category: row.category,
          quantity: 1,
        },
      ]
    })
  }

  function updateListItem(key, patch) {
    setShoppingList(current => current.map(item => item.compare_key === key ? { ...item, ...patch } : item))
  }

  const selectedComparisonRows = resultRows.filter(row => selectedRows.includes(row.id))
  const cheapestSelected = selectedComparisonRows[0]?.final_price || null

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-36">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-700 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-blue-100">Comparador</p>
        <h1 className="mt-2 text-2xl font-black">Encuentra el supermercado mas barato</h1>
        <p className="mt-2 text-sm text-blue-50">Compara precios aprobados presenciales y web sin mezclar formatos distintos.</p>
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <form onSubmit={runSearch} className="space-y-3">
          <label className="grid gap-2">
            <span className="text-lg font-black text-slate-900">Que producto quieres comparar?</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Ej: leche, arroz, aceite, Lider 1 kg..."
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400"
            />
          </label>

          {suggestions.length > 0 && (
            <div className="grid gap-2">
              {suggestions.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setQuery(item.label)
                    setActiveQuery(item.label)
                    setSearchParams({ q: item.label })
                  }}
                  className="rounded-2xl bg-slate-50 px-3 py-2 text-left text-sm"
                >
                  <b>{item.label}</b>
                  {item.meta && <span className="block text-xs text-slate-500">{item.meta}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <select value={category} onChange={event => setCategory(event.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <option value="all">Todas las categorias</option>
              {categories.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={zoneMode} onChange={event => setZoneMode(event.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              {ZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white">Buscar precios</button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Zona: {zoneCity(activeZone) || 'Chile'}{zoneSector(activeZone) ? ` - ${zoneSector(activeZone)}` : ''}
          </span>
          <button type="button" onClick={useMyLocation} className="rounded-full bg-blue-50 px-3 py-1 font-black text-blue-700">Usar mi ubicacion</button>
          {zoneMode === 'nearby' && !isValidCoordinate(activeZone?.lat, activeZone?.lng) && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Activa ubicacion para Cerca de mi.</span>
          )}
        </div>
      </section>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : message.type === 'warning' ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
          {message.text}
        </div>
      )}

      {loading && <div className="rounded-[2rem] bg-white p-5 text-center text-sm text-slate-500 shadow-sm">Cargando precios aprobados...</div>}

      {!loading && activeQuery && formatGroups.length > 1 && (
        <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-black text-slate-900">Formato comparado</h2>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {formatGroups.map(group => (
              <button
                key={group.key}
                type="button"
                onClick={() => {
                  setSelectedFormatKey(group.key)
                  setSelectedRows([])
                }}
                className={`shrink-0 rounded-2xl px-3 py-2 text-left text-xs font-black ${selectedGroup?.key === group.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {group.product_name}
                <span className="block font-semibold opacity-80">{[group.brand, group.format_label].filter(Boolean).join(' - ')} - {group.rows.length} precios</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && activeQuery && resultRows.length === 0 && (
        <section className="rounded-[2rem] border border-slate-100 bg-white p-5 text-center shadow-sm">
          <p className="font-black text-slate-900">Todavia no tenemos precios suficientes para comparar este producto.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link to="/add" className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white">Reportar un precio</Link>
            <button type="button" onClick={() => setQuery('')} className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700">Probar otro producto</button>
          </div>
        </section>
      )}

      {resultRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">Resultados</h2>
              <p className="text-xs text-slate-500">{resultRows.length} alternativa{resultRows.length === 1 ? '' : 's'} ordenada{resultRows.length === 1 ? '' : 's'} de menor a mayor.</p>
            </div>
            {resultRows.length === 1 && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">Faltan alternativas</span>}
          </div>
          {resultRows.map((row, index) => (
            <ResultCard
              key={row.id}
              row={row}
              index={index}
              maxPrice={maxResultPrice}
              selected={selectedRows.includes(row.id)}
              onToggleSelected={() => toggleSelected(row)}
              onAdd={() => addToList(row)}
            />
          ))}
        </section>
      )}

      {selectedComparisonRows.length >= 2 && (
        <section className="rounded-[2rem] border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <h2 className="font-black text-blue-950">Comparacion simple</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {selectedComparisonRows.map(row => (
              <div key={`compare-${row.id}`} className="rounded-2xl bg-white p-3 text-sm shadow-sm">
                <p className="font-black text-slate-900">{row.store_name}</p>
                <p className="text-xs text-slate-500">{row.branch_name || 'Sucursal sin dato'}</p>
                <p className="mt-2 text-xl font-black text-blue-700">{formatCLP(row.final_price)}</p>
                <p className="text-xs font-bold text-slate-500">Diferencia: {cheapestSelected ? formatCLP(row.final_price - cheapestSelected) : '$0'}</p>
                <p className="text-xs text-slate-500">{row.distance_m != null ? formatDistance(row.distance_m) : 'Sin distancia'} - {formatDate(row.date)}</p>
                <p className="text-xs text-slate-500">{row.source_label}{row.availability ? ` - ${row.availability}` : ''}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Mi lista de compras</h2>
            <p className="text-xs text-slate-500">Se guarda temporalmente en este dispositivo.</p>
          </div>
          {shoppingList.length > 0 && <button type="button" onClick={() => setShoppingList([])} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Limpiar</button>}
        </div>

        <div className="mt-3 space-y-2">
          {shoppingList.map(item => (
            <div key={item.compare_key} className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[1fr_120px_auto] sm:items-center">
              <div>
                <p className="font-black text-slate-900">{item.product_name}</p>
                <p className="text-xs text-slate-500">{[item.brand, item.format_label].filter(Boolean).join(' - ')}</p>
              </div>
              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={event => updateListItem(item.compare_key, { quantity: Math.max(1, Number(event.target.value) || 1) })}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => setShoppingList(current => current.filter(row => row.compare_key !== item.compare_key))} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-red-600">Quitar</button>
            </div>
          ))}
          {shoppingList.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Agrega productos desde los resultados para armar tu lista.</p>}
        </div>

        {shoppingList.length > 0 && (
          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Compra combinada mas barata</p>
              <p className="mt-1 text-2xl font-black text-emerald-800">{formatCLP(listSummary.combinedTotal)}</p>
              <div className="mt-2 space-y-1 text-xs text-emerald-900">
                {listSummary.bestItems.map(line => (
                  <p key={line.item.compare_key}>{line.item.product_name}: {line.row.store_name} - {formatCLP(line.subtotal)}</p>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-blue-50 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-blue-700">Supermercado unico mas barato</p>
              {listSummary.singleStoreBest ? (
                <>
                  <p className="mt-1 text-xl font-black text-blue-800">{listSummary.singleStoreBest.store_name} - {formatCLP(listSummary.singleStoreBest.total)}</p>
                  <p className="mt-1 text-xs text-blue-800">Calculado solo porque tiene precio para todos los productos de la lista.</p>
                </>
              ) : (
                <p className="mt-1 text-sm font-semibold text-blue-800">Ningun supermercado tiene precio disponible para toda la lista.</p>
              )}
            </div>

            {listSummary.missingItems.length > 0 && (
              <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-black">Productos sin precio disponible</p>
                {listSummary.missingItems.map(item => <p key={item.compare_key}>{item.product_name} - {item.format_label}</p>)}
              </div>
            )}

            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <p className="font-black text-slate-900">Ahorro estimado</p>
              <p className="mt-1 text-slate-600">Comparando mejores precios contra las opciones mas caras disponibles para esos mismos productos: <b>{formatCLP(listSummary.estimatedSavings)}</b>.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
