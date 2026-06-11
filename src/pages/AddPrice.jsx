import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  calcUnitPrice, formatUnitPrice, SECTORES_RANCAGUA, UNIDADES
} from '../utils/priceCalc'

const EMPTY_FORM = {
  product_name: '',
  product_category: 'Otros',
  _product_id: null,
  brand: '',
  quantity: '',
  unit: 'unidad',
  price: '',
  store_name: '',
  sector: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

const PRODUCT_CATEGORIES = [
  'Panadería',
  'Lácteos',
  'Huevos',
  'Carnes',
  'Pescados y mariscos',
  'Frutas',
  'Verduras',
  'Abarrotes',
  'Arroz y legumbres',
  'Pastas',
  'Aceites',
  'Conservas',
  'Bebidas',
  'Congelados',
  'Limpieza',
  'Higiene',
  'Mascotas',
  'Bebé',
  'Otros',
]

function googleMapsUrl(lat, lng) {
  if (lat == null || lng == null) return null
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const R = 6371
  const dLat = (Number(b.lat) - Number(a.lat)) * Math.PI / 180
  const dLng = (Number(b.lng) - Number(a.lng)) * Math.PI / 180
  const lat1 = Number(a.lat) * Math.PI / 180
  const lat2 = Number(b.lat) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const c = 2 * Math.atan2(
    Math.sqrt(sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng),
    Math.sqrt(1 - (sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng))
  )
  return R * c
}



function formatDistanceKm(km) {
  if (km == null || Number.isNaN(Number(km))) return 'distancia no disponible'
  const meters = Math.round(Number(km) * 1000)
  if (meters < 1000) return `${meters} m`
  if (meters < 10000) return `${Number(km).toFixed(1).replace('.0', '')} km`
  return `${Math.round(Number(km))} km`
}

function osmElementPosition(element) {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (lat == null || lng == null) return null
  return { lat: Number(lat), lng: Number(lng) }
}

function osmElementAddress(tags = {}) {
  const street = tags['addr:street']
  const number = tags['addr:housenumber']
  const suburb = tags['addr:suburb'] || tags['addr:neighbourhood']
  const city = tags['addr:city']
  const parts = []
  if (street) parts.push(number ? `${street} ${number}` : street)
  if (suburb) parts.push(suburb)
  if (city) parts.push(city)
  return parts.join(', ')
}

function normalizeOsmPlace(element, origin) {
  const position = osmElementPosition(element)
  if (!position) return null

  const tags = element.tags || {}
  const name = tags.name || tags.brand || tags.operator
  if (!name) return null

  return {
    id: `${element.type}/${element.id}`,
    name,
    type: tags.shop || tags.amenity || 'comercio',
    address: osmElementAddress(tags),
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_km: distanceKm(origin, position),
    source: 'openstreetmap_overpass',
  }
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

function normalizePriceNowPlace(row, origin) {
  if (!row?.store_name || row.purchase_latitude == null || row.purchase_longitude == null) return null

  const position = {
    lat: Number(row.purchase_latitude),
    lng: Number(row.purchase_longitude),
  }

  const distance_km = distanceKm(origin, position)
  if (distance_km == null || distance_km > 20) return null

  return {
    id: `pricenow-${normalizeText(row.store_name)}-${row.sector || 'sin-sector'}-${position.lat}-${position.lng}`,
    name: row.store_name,
    type: 'reportado en PriceNow',
    address: row.sector || '',
    sector: row.sector || '',
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_km,
    source: 'pricenow_reports',
  }
}


function normalizeKnownStorePlace(store, origin, includeWithoutDistance = false) {
  if (!store?.name) return null

  const hasCoords = store.latitude != null && store.longitude != null
  const position = hasCoords
    ? { lat: Number(store.latitude), lng: Number(store.longitude) }
    : null

  const distance_km = position ? distanceKm(origin, position) : null
  if (distance_km != null && distance_km > 25) return null
  if (distance_km == null && !includeWithoutDistance) return null

  return {
    id: `store-${store.id}`,
    store_id: store.id,
    name: store.name,
    type: store.chain || 'tienda conocida',
    address: store.address || store.sector || '',
    sector: store.sector || '',
    lat: position ? Number(position.lat.toFixed(7)) : null,
    lng: position ? Number(position.lng.toFixed(7)) : null,
    distance_km,
    source: 'pricenow_known_store',
  }
}

function sourceLabel(source) {
  if (source === 'pricenow_reports') return 'PriceNow'
  if (source === 'pricenow_known_store') return 'Tienda conocida'
  if (source && source.includes('openstreetmap')) return 'OpenStreetMap'
  return 'Referencia'
}

function mergeNearbyPlaces(places) {
  const unique = new Map()

  places
    .filter(place => place?.name)
    .sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
    .forEach(place => {
      const key = `${normalizeText(place.name)}-${normalizeText(place.address || place.sector || '')}`
      if (!key.trim()) return

      const existing = unique.get(key)
      if (!existing || (place.distance_km ?? 9999) < (existing.distance_km ?? 9999)) {
        unique.set(key, {
          ...place,
          distance_km: place.distance_km == null ? null : Number(Number(place.distance_km).toFixed(3)),
        })
      }
    })

  return Array.from(unique.values()).sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
}

async function fetchNearbyPriceNowPlaces(location) {
  const { data, error } = await supabase
    .from('price_entries')
    .select('store_name, sector, purchase_latitude, purchase_longitude, purchase_date, validation_status')
    .not('purchase_latitude', 'is', null)
    .not('purchase_longitude', 'is', null)
    .order('purchase_date', { ascending: false })
    .limit(500)

  if (error) throw error

  return (data || [])
    .map(row => normalizePriceNowPlace(row, location))
    .filter(Boolean)
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

function buildOverpassNearbyQuery(lat, lng, radiusMeters = 3000) {
  return `
    [out:json][timeout:25];
    (
      node["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall|department_store|general|kiosk|variety_store|farm|seafood|beverages|frozen_food"](around:${radiusMeters},${lat},${lng});
      way["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall|department_store|general|kiosk|variety_store|farm|seafood|beverages|frozen_food"](around:${radiusMeters},${lat},${lng});
      relation["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall|department_store|general|kiosk|variety_store|farm|seafood|beverages|frozen_food"](around:${radiusMeters},${lat},${lng});
      node["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
      way["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
      relation["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 50;
  `
}

async function fetchOverpass(endpoint, query) {
  // En producción algunos navegadores bloquean POST con headers personalizados por CORS.
  // Por eso primero usamos GET sin headers; si falla, probamos POST simple.
  const getUrl = `${endpoint}?data=${encodeURIComponent(query)}`

  try {
    const getResponse = await fetch(getUrl, { method: 'GET' })
    if (!getResponse.ok) {
      throw new Error(`GET Overpass respondió con estado ${getResponse.status}`)
    }
    return getResponse.json()
  } catch (getError) {
    const postResponse = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    })

    if (!postResponse.ok) {
      throw new Error(`POST Overpass respondió con estado ${postResponse.status}; GET falló: ${getError.message}`)
    }

    return postResponse.json()
  }
}

async function fetchNearbyPlacesWithApiProxy(location) {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)

  let response
  try {
    response = await fetch(`/api/nearby-osm?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(`Proxy OSM no disponible: ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data.places)) return []

  return data.places
    .map(place => ({
      ...place,
      distance_km: place.distance_km ?? distanceKm(location, { lat: place.lat, lng: place.lng }),
    }))
    .filter(place => place.name && place.distance_km != null)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 12)
}

export default function AddPrice() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [stores, setStores] = useState([])
  const [products, setProducts] = useState([])
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [location, setLocation] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [osmPlaces, setOsmPlaces] = useState([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [osmSearched, setOsmSearched] = useState(false)

  const unitPrice = calcUnitPrice(form.price, form.quantity, form.unit)

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, sector, address, latitude, longitude')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setStores(data) })

    supabase
      .from('products')
      .select('id, name, canonical_name, category, subcategory, default_unit')
      .eq('is_active', true)
      .order('category')
      .order('name')
      .then(({ data }) => { if (data) setProducts(data) })
  }, [])

  const nearbyStores = location
    ? stores
        .map(store => ({
          ...store,
          distance_km: distanceKm(
            location,
            store.latitude != null && store.longitude != null
              ? { lat: store.latitude, lng: store.longitude }
              : null
          ),
        }))
        .filter(store => store.distance_km != null)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, 5)
    : []

  const productQuery = normalizeText(form.product_name)
  const selectedProduct = form._product_id
    ? products.find(product => product.id === form._product_id)
    : null
  const productSuggestions = productQuery.length >= 2
    ? products
        .filter(product => {
          const searchText = normalizeText(`${product.name} ${product.category || ''} ${product.subcategory || ''} ${product.canonical_name || ''}`)
          return searchText.includes(productQuery)
        })
        .slice(0, 8)
    : []

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'product_name') {
        next._product_id = null
      }
      return next
    })
    setError(null)
  }

  function applyProduct(product) {
    setForm(prev => ({
      ...prev,
      product_name: product.name,
      product_category: product.category || prev.product_category || 'Otros',
      unit: product.default_unit || prev.unit,
      _product_id: product.id,
    }))
    setError(null)
  }

  async function resolveProductBeforeSubmit() {
    if (form._product_id) {
      return { id: form._product_id, name: form.product_name.trim() }
    }

    const { data, error: productErr } = await supabase.rpc('find_or_create_product', {
      p_name: form.product_name.trim(),
      p_category: form.product_category || 'Otros',
      p_default_unit: form.unit,
    })

    if (productErr) throw productErr

    const product = Array.isArray(data) ? data[0] : data
    if (!product?.id) return null

    return {
      id: product.id,
      name: product.name || form.product_name.trim(),
      category: product.category || form.product_category || 'Otros',
    }
  }

  function applyStore(store) {
    setForm(prev => ({
      ...prev,
      store_name: store.name,
      sector: store.sector,
      _store_id: store.id,
    }))
  }

  function handleStoreSelect(e) {
    const storeId = e.target.value
    if (storeId === 'other') {
      setForm(prev => ({ ...prev, store_name: '', sector: '', _store_id: null }))
      return
    }
    const store = stores.find(s => s.id === storeId)
    if (store) applyStore(store)
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('La foto no puede superar 5 MB.')
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function captureLocation() {
    setError(null)
    if (!navigator.geolocation) {
      setError('Tu navegador no permite obtener ubicación.')
      return
    }

    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        const nextLocation = {
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
          accuracy: Math.round(position.coords.accuracy),
          source: 'browser_geolocation',
        }
        setLocation(nextLocation)
        setLocationLoading(false)
      },
      () => {
        setError('No se pudo obtener la ubicación. Revisa los permisos del navegador.')
        setLocationLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    )
  }

  function clearLocation() {
    setLocation(null)
    setOsmPlaces([])
    setOsmSearched(false)
  }

  function applyOsmPlace(place) {
    setForm(prev => ({
      ...prev,
      store_name: place.name,
      sector: place.sector || prev.sector,
      _store_id: place.store_id || null,
    }))
  }

  async function searchNearbyOsmPlaces() {
    if (!location) {
      setError('Primero debes usar tu ubicación actual.')
      return
    }

    setError(null)
    setOsmLoading(true)
    setOsmSearched(true)

    const combinedResults = []
    let lastError = null

    try {
      // 1) Respuesta rápida: usar primero tiendas conocidas guardadas en PriceNow.
      // Esto evita depender de OpenStreetMap para supermercados conocidos que no estén bien mapeados.
      const knownStoreResults = stores
        .map(store => normalizeKnownStorePlace(store, location, false))
        .filter(Boolean)

      combinedResults.push(...knownStoreResults)

      try {
        const priceNowResults = await fetchNearbyPriceNowPlaces(location)
        combinedResults.push(...priceNowResults)
      } catch (priceNowError) {
        lastError = priceNowError
        console.warn('PriceNow nearby places error:', priceNowError)
      }

      const quickResults = mergeNearbyPlaces(combinedResults).slice(0, 20)
      setOsmPlaces(quickResults)

      // 2) OpenStreetMap queda como complemento. Si demora o falla, no bloquea la búsqueda.
      try {
        const proxyResults = await fetchNearbyPlacesWithApiProxy(location)
        combinedResults.push(...proxyResults)
        setOsmPlaces(mergeNearbyPlaces(combinedResults).slice(0, 20))
      } catch (proxyError) {
        lastError = proxyError
      }

      const finalResults = mergeNearbyPlaces(combinedResults).slice(0, 20)
      setOsmPlaces(finalResults)
    } catch (err) {
      lastError = err
      setError('No se pudieron detectar negocios cercanos. Puedes ingresar la tienda manualmente.')
      setOsmPlaces([])
    } finally {
      if (lastError) console.warn('Búsqueda de negocios cercanos:', lastError)
      setOsmLoading(false)
    }
  }

  function validate() {
    if (!form.product_name.trim()) return 'El nombre del producto es obligatorio.'
    if (!form.quantity || parseFloat(form.quantity) <= 0) return 'La cantidad debe ser mayor a 0.'
    if (!form.price || parseFloat(form.price) <= 0) return 'El precio debe ser mayor a 0.'
    if (!form.store_name.trim()) return 'La tienda es obligatoria.'
    if (!form.sector) return 'El sector es obligatorio.'
    if (!form.purchase_date) return 'La fecha de compra es obligatoria.'
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    setError(null)

    let receipt_photo_url = null

    if (photo) {
      const ext = photo.name.split('.').pop()
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('receipts')
        .upload(path, photo, { contentType: photo.type, upsert: false })

      if (uploadErr) {
        setError('Error al subir la foto: ' + uploadErr.message)
        setLoading(false)
        return
      }
      receipt_photo_url = path
    }

    let resolvedProduct = null
    try {
      resolvedProduct = await resolveProductBeforeSubmit()
    } catch (productErr) {
      setError('Error al estandarizar el producto: ' + productErr.message)
      setLoading(false)
      return
    }

    const { error: insertErr } = await supabase.from('price_entries').insert({
      user_id: user.id,
      product_id: resolvedProduct?.id ?? null,
      product_name: resolvedProduct?.name || form.product_name.trim(),
      brand: form.brand.trim() || null,
      quantity: parseFloat(form.quantity),
      unit: form.unit,
      price: parseFloat(form.price),
      unit_price: unitPrice,
      store_name: form.store_name.trim(),
      store_id: form._store_id ?? null,
      sector: form.sector,
      purchase_date: form.purchase_date,
      notes: form.notes.trim() || null,
      receipt_photo_url,
      purchase_latitude: location?.lat ?? null,
      purchase_longitude: location?.lng ?? null,
      location_accuracy_m: location?.accuracy ?? null,
      location_source: location?.source ?? null,
      google_maps_url: location ? googleMapsUrl(location.lat, location.lng) : null,
    })

    if (insertErr) {
      setError('Error al guardar: ' + insertErr.message)
    } else {
      setSuccess(true)
      setForm(EMPTY_FORM)
      setPhoto(null)
      setPreview(null)
      setLocation(null)
      setTimeout(() => { setSuccess(false); navigate('/') }, 2000)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-xl font-bold text-slate-800">¡Precio registrado!</h3>
        <p className="text-slate-500 text-sm mt-2">
          Tu aporte está en revisión y pronto aparecerá en el ranking.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Ingresar precio</h2>
      <p className="text-sm text-slate-500 mb-5">Registra lo que pagaste en tu última compra.</p>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Producto <span className="text-danger-500">*</span></label>
          <input
            name="product_name"
            type="text"
            placeholder="Ej: Leche entera, Pan marraqueta…"
            value={form.product_name}
            onChange={handleChange}
            maxLength={100}
            className="input-field"
          />

          {selectedProduct && (
            <p className="text-xs text-success-600 font-medium mt-1.5">
              Producto estandarizado: {selectedProduct.name} · {selectedProduct.category}
            </p>
          )}

          {!selectedProduct && productSuggestions.length > 0 && (
            <div className="mt-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <p className="text-[11px] text-slate-400 px-3 pt-2">Selecciona si corresponde:</p>
              {productSuggestions.map(product => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => applyProduct(product)}
                  className="w-full text-left px-3 py-2 border-t border-slate-100 active:bg-brand-50"
                >
                  <p className="text-sm font-semibold text-slate-800">{product.name}</p>
                  <p className="text-xs text-slate-400">{product.category}{product.subcategory ? ` · ${product.subcategory}` : ''} · unidad base: {product.default_unit}</p>
                </button>
              ))}
            </div>
          )}

          {!selectedProduct && form.product_name.trim().length >= 2 && (
            <div className="mt-2">
              <label className="input-label">Categoría si es producto nuevo</label>
              <select
                name="product_category"
                value={form.product_category}
                onChange={handleChange}
                className="input-field"
              >
                {PRODUCT_CATEGORIES.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Si el producto no existe, PriceNow lo creará como producto estandarizado para que los reportes puedan promediarlo.
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="input-label">Marca <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input
            name="brand"
            type="text"
            placeholder="Ej: Soprole, Carozzi…"
            value={form.brand}
            onChange={handleChange}
            maxLength={60}
            className="input-field"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Cantidad <span className="text-danger-500">*</span></label>
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              placeholder="Ej: 1, 0.5, 500"
              value={form.quantity}
              onChange={handleChange}
              min="0.001"
              step="any"
              className="input-field"
            />
          </div>
          <div>
            <label className="input-label">Unidad <span className="text-danger-500">*</span></label>
            <select name="unit" value={form.unit} onChange={handleChange} className="input-field">
              {UNIDADES.map(u => (
                <option key={u.value} value={u.value}>{u.label.split(' →')[0]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="input-label">Precio total ($) <span className="text-danger-500">*</span></label>
          <input
            name="price"
            type="number"
            inputMode="numeric"
            placeholder="Ej: 1490"
            value={form.price}
            onChange={handleChange}
            min="1"
            step="1"
            className="input-field"
          />
          {unitPrice != null && form.quantity && form.price && (
            <p className="text-xs text-success-600 font-medium mt-1.5 flex items-center gap-1">
              <span>→</span>
              <span>{formatUnitPrice(unitPrice, form.unit)}</span>
            </p>
          )}
        </div>

        <div>
          <label className="input-label">Tienda <span className="text-danger-500">*</span></label>
          <select onChange={handleStoreSelect} defaultValue="" className="input-field mb-2">
            <option value="" disabled>Seleccionar tienda conocida…</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value="other">Otra tienda (ingresar manualmente)</option>
          </select>
          <input
            name="store_name"
            type="text"
            placeholder="Nombre de la tienda"
            value={form.store_name}
            onChange={handleChange}
            maxLength={80}
            className="input-field"
          />
        </div>

        {nearbyStores.length > 0 && (
          <div className="bg-brand-50 border border-brand-500/20 rounded-xl p-3">
            <p className="text-xs font-semibold text-brand-700 mb-2">Tiendas cercanas según tu ubicación</p>
            <div className="space-y-2">
              {nearbyStores.map(store => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => applyStore(store)}
                  className="w-full bg-white rounded-lg p-2 text-left border border-brand-100 active:scale-95 transition-transform"
                >
                  <p className="text-sm font-semibold text-slate-800">{store.name}</p>
                  <p className="text-xs text-slate-400">
                    {store.sector} · aprox. {formatDistanceKm(store.distance_km)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="input-label">Sector / población de Rancagua <span className="text-danger-500">*</span></label>
          <select name="sector" value={form.sector} onChange={handleChange} className="input-field">
            <option value="" disabled>Seleccionar sector…</option>
            {SECTORES_RANCAGUA.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">Ubicación exacta <span className="text-slate-400 font-normal">(opcional)</span></label>
          <div className="card border border-slate-200">
            {location ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Ubicación guardada</p>
                <p className="text-xs text-slate-500">
                  Lat: {location.lat} · Lng: {location.lng} · precisión aprox. {location.accuracy} m
                </p>
                <div className="flex gap-2">
                  <a
                    href={googleMapsUrl(location.lat, location.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary flex-1 text-center text-sm py-2"
                  >
                    Ver en Google Maps
                  </a>
                  <button type="button" onClick={clearLocation} className="btn-danger text-sm py-2">
                    Quitar
                  </button>
                </div>

                <button
                  type="button"
                  onClick={searchNearbyOsmPlaces}
                  disabled={osmLoading}
                  className="btn-primary w-full text-sm py-2"
                >
                  {osmLoading ? 'Buscando negocios cercanos…' : 'Detectar negocios cercanos'}
                </button>

                <p className="text-[11px] text-slate-400">
                  Primero se revisan reportes y tiendas con coordenadas en PriceNow; luego se consulta OpenStreetMap como apoyo. Si falta un local, escríbelo manualmente junto con tu ubicación exacta para que PriceNow lo aprenda en próximas búsquedas.
                </p>

                {osmPlaces.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Negocios cercanos detectados</p>
                    {osmPlaces.map(place => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => applyOsmPlace(place)}
                        className="w-full bg-white rounded-lg p-2 text-left border border-slate-200 active:scale-95 transition-transform"
                      >
                        <p className="text-sm font-semibold text-slate-800">{place.name}</p>
                        <p className="text-xs text-slate-500">
                          {place.type} · {place.distance_km != null ? `aprox. ${formatDistanceKm(place.distance_km)} · ` : ''}{sourceLabel(place.source)}
                        </p>
                        {place.address && (
                          <p className="text-xs text-slate-400">{place.address}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {osmSearched && !osmLoading && osmPlaces.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No se encontraron negocios cercanos con coordenadas para esta ubicación. Puedes escribir la tienda manualmente y guardar el precio con ubicación exacta; después de aprobarse, PriceNow podrá usarla como referencia cercana.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Usa esta opción solo si estás en el lugar de compra. El navegador pedirá permiso para acceder a tu ubicación.
                </p>
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={locationLoading}
                  className="btn-secondary w-full text-sm py-2"
                >
                  {locationLoading ? 'Obteniendo ubicación…' : 'Usar mi ubicación actual'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="input-label">Fecha de compra <span className="text-danger-500">*</span></label>
          <input
            name="purchase_date"
            type="date"
            value={form.purchase_date}
            onChange={handleChange}
            max={new Date().toISOString().slice(0, 10)}
            className="input-field"
          />
        </div>

        <div>
          <label className="input-label">Notas <span className="text-slate-400 font-normal">(opcional)</span></label>
          <textarea
            name="notes"
            placeholder="Ej: oferta de la semana, precio de feria…"
            value={form.notes}
            onChange={handleChange}
            maxLength={200}
            rows={2}
            className="input-field resize-none"
          />
        </div>

        <div>
          <label className="input-label">Foto de boleta <span className="text-slate-400 font-normal">(opcional)</span></label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-colors"
          >
            {preview ? (
              <img src={preview} alt="Vista previa boleta" className="max-h-32 mx-auto rounded-lg object-contain" />
            ) : (
              <div className="text-slate-400">
                <svg className="w-8 h-8 mx-auto mb-1 fill-slate-300" viewBox="0 0 24 24">
                  <path d="M20 4v12H8V4h12m0-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 9.67l1.69 2.26 2.48-3.1L19 15H9zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/>
                </svg>
                <p className="text-sm">Toca para adjuntar foto</p>
                <p className="text-xs text-slate-300 mt-0.5">JPG, PNG · máx. 5 MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          {preview && (
            <button
              type="button"
              onClick={() => { setPhoto(null); setPreview(null) }}
              className="text-xs text-danger-500 mt-1 underline"
            >
              Quitar foto
            </button>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary w-full mt-2"
        >
          {loading ? 'Guardando…' : 'Guardar precio'}
        </button>
      </div>
    </div>
  )
}
