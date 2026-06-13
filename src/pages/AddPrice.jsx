import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  calcUnitPrice, formatCLP, formatUnitPrice, UNIDADES
} from '../utils/priceCalc'
import { getStoredZone, isManualPreferredZone, reverseGeocode, sameCommune, setStoredZone, zoneCommune, zoneSubtitle } from '../utils/location'
import { calculateDiscountFinalPrice, DISCOUNT_TYPES, PAYMENT_METHODS, paymentMethodLabel } from '../utils/discounts'
import { parseReceiptOcr, RECEIPT_TYPES } from '../utils/receiptParser'

const EMPTY_FORM = {
  product_name: '',
  product_category: 'Otros',
  _product_id: null,
  brand: '',
  quantity: '',
  unit: 'unidad',
  price: '',
  has_discount: false,
  discount_type: 'monto',
  discount_value: '',
  promotion_description: '',
  payment_method: 'efectivo',
  requires_specific_payment_method: false,
  payment_condition: '',
  baes_eligibility_status: '',
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

const RECEIPT_BUCKET = 'receipts'
const RECEIPT_MAX_SIZE = 10 * 1024 * 1024
const RECEIPT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const RECEIPT_ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const DEFAULT_RECEIPT_CROP = { top: 0, bottom: 100 }
const EMPTY_RECEIPT_META = {
  store_name: '',
  store_address: '',
  purchase_date: '',
  total_amount: null,
  net_amount: null,
  tax_amount: null,
  subtotal_amount: null,
  payment_method: '',
  general_discount_amount: null,
  has_general_discount: false,
  receipt_type: RECEIPT_TYPES.UNKNOWN,
  has_itemized_products: false,
  parser_confidence: 'baja',
  parser_version: '',
  reconciliation_warning: '',
  possible_products_count: 0,
  confident_products_count: 0,
}
const RECEIPT_TYPE_OPTIONS = [
  { value: RECEIPT_TYPES.ITEMIZED, label: 'Boleta con productos' },
  { value: RECEIPT_TYPES.SUMMARY, label: 'Boleta sin desglose' },
  { value: RECEIPT_TYPES.PAYMENT, label: 'Comprobante de pago' },
  { value: RECEIPT_TYPES.UNKNOWN, label: 'No se pudo identificar' },
]

function clampNumber(value, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, numeric))
}

async function loadReceiptImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Fallback below keeps older browsers working.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = err => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    image.src = url
  })
}

function otsuThreshold(grayValues) {
  const histogram = new Array(256).fill(0)
  grayValues.forEach(value => { histogram[value] += 1 })

  const total = grayValues.length
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let maxVariance = 0
  let threshold = 150

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i]
    if (!weightBackground) continue
    const weightForeground = total - weightBackground
    if (!weightForeground) break

    sumBackground += i * histogram[i]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (variance > maxVariance) {
      maxVariance = variance
      threshold = i
    }
  }

  return threshold
}

function denoiseBinary(binary, width, height) {
  const output = new Uint8ClampedArray(binary)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      let blackNeighbors = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          if (binary[(y + dy) * width + (x + dx)] === 0) blackNeighbors += 1
        }
      }
      if (binary[index] === 0 && blackNeighbors <= 1) output[index] = 255
      if (binary[index] === 255 && blackNeighbors >= 7) output[index] = 0
    }
  }
  return output
}

async function preprocessReceiptImage(file, crop = DEFAULT_RECEIPT_CROP) {
  if (typeof document === 'undefined') return file

  const image = await loadReceiptImage(file)
  const naturalWidth = image.width || image.naturalWidth
  const naturalHeight = image.height || image.naturalHeight
  const topPct = clampNumber(crop.top, 0, 90)
  const bottomPct = clampNumber(crop.bottom, topPct + 5, 100)
  const sourceY = Math.round(naturalHeight * (topPct / 100))
  const sourceHeight = Math.max(1, Math.round(naturalHeight * ((bottomPct - topPct) / 100)))
  const maxWidth = 1800
  const scale = Math.min(2, maxWidth / naturalWidth)
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, sourceY, naturalWidth, sourceHeight, 0, 0, width, height)

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[p] = clampNumber(Math.round((value - 128) * 1.45 + 128), 0, 255)
  }

  const threshold = otsuThreshold(gray)
  const binary = new Uint8ClampedArray(gray.length)
  for (let i = 0; i < gray.length; i += 1) binary[i] = gray[i] > threshold ? 255 : 0
  const clean = denoiseBinary(binary, width, height)

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    data[i] = clean[p]
    data[i + 1] = clean[p]
    data[i + 2] = clean[p]
    data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92))
  return blob ? new File([blob], 'receipt-ocr.png', { type: 'image/png' }) : file
}

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

function receiptConfidenceClass(confidence) {
  if (confidence === 'alta') return 'bg-emerald-50 text-emerald-700'
  if (confidence === 'media') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-600'
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
  const [locationZone, setLocationZone] = useState(() => getStoredZone())
  const [locationLoading, setLocationLoading] = useState(false)
  const [osmPlaces, setOsmPlaces] = useState([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [osmSearched, setOsmSearched] = useState(false)
  const [productCatalogOpen, setProductCatalogOpen] = useState(false)
  const [productCatalogCategory, setProductCatalogCategory] = useState('Todas')
  const [receiptProcessing, setReceiptProcessing] = useState(false)
  const [receiptProgress, setReceiptProgress] = useState('')
  const [receiptOcrText, setReceiptOcrText] = useState('')
  const [receiptItems, setReceiptItems] = useState([])
  const [receiptMeta, setReceiptMeta] = useState(EMPTY_RECEIPT_META)
  const [receiptReviewConfirmed, setReceiptReviewConfirmed] = useState(false)
  const [receiptPaymentConfirmed, setReceiptPaymentConfirmed] = useState(false)
  const [receiptCrop, setReceiptCrop] = useState(DEFAULT_RECEIPT_CROP)

  const normalPrice = Number(form.price)
  const discountValue = Number(form.discount_value)
  const finalPrice = form.has_discount
    ? calculateDiscountFinalPrice(normalPrice, form.discount_type, discountValue)
    : (Number.isFinite(normalPrice) && normalPrice > 0 ? normalPrice : null)
  const unitPrice = calcUnitPrice(finalPrice, form.quantity, form.unit)

  useEffect(() => {
    supabase
      .from('stores')
      .select('*')
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

  const catalogCategories = [
    'Todas',
    ...Array.from(new Set(products.map(product => product.category || 'Otros'))).sort((a, b) => a.localeCompare(b)),
  ]

  const catalogProducts = products
    .filter(product => productCatalogCategory === 'Todas' || (product.category || 'Otros') === productCatalogCategory)
    .filter(product => {
      if (productQuery.length < 2) return true
      const searchText = normalizeText(`${product.name} ${product.category || ''} ${product.subcategory || ''} ${product.canonical_name || ''}`)
      return searchText.includes(productQuery)
    })
    .sort((a, b) => `${a.category || ''} ${a.name}`.localeCompare(`${b.category || ''} ${b.name}`))
    .slice(0, 80)

  const availableSectors = Array.from(new Set([
    locationZone?.commune,
    locationZone?.city,
    ...stores.map(store => store.commune || store.sector).filter(Boolean),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
  const includedReceiptItems = receiptMeta.receipt_type === RECEIPT_TYPES.ITEMIZED
    ? receiptItems.filter(item => item.include_in_report && !item.discarded)
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
    setProductCatalogOpen(false)
    setError(null)
  }

  async function resolveProductBeforeSubmit() {
    return resolveProductInput({
      product_id: form._product_id,
      product_name: form.product_name.trim(),
      category: form.product_category || 'Otros',
      unit: form.unit,
    })
  }

  async function resolveProductInput({ product_id, product_name, category = 'Otros', unit = 'unidad' }) {
    if (product_id) {
      return { id: product_id, name: product_name }
    }

    const { data, error: productErr } = await supabase.rpc('find_or_create_product', {
      p_name: product_name,
      p_category: category,
      p_default_unit: unit,
    })

    if (productErr) throw productErr

    const product = Array.isArray(data) ? data[0] : data
    if (!product?.id) return null

    return {
      id: product.id,
      name: product.name || product_name,
      category: product.category || category,
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
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!RECEIPT_ACCEPTED_TYPES.includes(file.type) && !RECEIPT_ACCEPTED_EXTENSIONS.includes(extension)) {
      setError('Formato no compatible. Usa JPG, JPEG, PNG o WEBP.')
      return
    }
    if (file.size > RECEIPT_MAX_SIZE) {
      setError('La imagen es demasiado pesada. Máximo permitido: 10 MB.')
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
    setReceiptOcrText('')
    setReceiptItems([])
    setReceiptMeta(EMPTY_RECEIPT_META)
    setReceiptReviewConfirmed(false)
    setReceiptPaymentConfirmed(false)
    setReceiptCrop(DEFAULT_RECEIPT_CROP)
    setReceiptProgress('')
    setError(null)
  }

  function clearReceiptPhoto() {
    setPhoto(null)
    setPreview(null)
    setReceiptOcrText('')
    setReceiptItems([])
    setReceiptMeta(EMPTY_RECEIPT_META)
    setReceiptReviewConfirmed(false)
    setReceiptPaymentConfirmed(false)
    setReceiptCrop(DEFAULT_RECEIPT_CROP)
    setReceiptProgress('')
    if (fileRef.current) fileRef.current.value = ''
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
        reverseGeocode(nextLocation.lat, nextLocation.lng)
          .then(zone => {
            if (zone) {
              const detectedZone = { ...zone, lat: nextLocation.lat, lng: nextLocation.lng, source: 'gps', preference_source: 'gps', is_preferred: true, confirmed: true }
              const currentZone = getStoredZone()
              const keepManualZone = isManualPreferredZone(currentZone) && zoneCommune(currentZone) && !sameCommune(zoneCommune(currentZone), zoneCommune(detectedZone))
              const savedZone = keepManualZone ? detectedZone : setStoredZone(detectedZone)
              setLocationZone(savedZone)
              setForm(prev => prev.sector ? prev : { ...prev, sector: savedZone?.commune || savedZone?.city || '' })
            }
          })
          .catch(err => console.warn('PriceNow reverse geocode for report failed:', err))
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
    setLocationZone(null)
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

  async function processReceiptPhoto() {
    if (!photo) {
      setError('Primero adjunta una foto de la boleta.')
      return
    }

    setError(null)
    setReceiptProcessing(true)
    setReceiptProgress('Preparando OCR...')
    setReceiptReviewConfirmed(false)
    setReceiptPaymentConfirmed(false)

    let worker = null
    try {
      setReceiptProgress('Preprocesando imagen...')
      const ocrImage = await preprocessReceiptImage(photo, receiptCrop)
      const { createWorker } = await import('tesseract.js')
      setReceiptProgress('Ejecutando OCR...')
      worker = await createWorker('spa', 1, {
        logger: message => {
          if (message?.status) {
            const percent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : ''
            setReceiptProgress(`${message.status}${percent}`)
          }
        },
      })
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6',
      })
      const { data } = await worker.recognize(ocrImage, {}, { text: true, blocks: true, hocr: true, tsv: true })
      const parsed = parseReceiptOcr(data, products)
      setReceiptOcrText(parsed.sanitizedText)
      setReceiptItems(parsed.items)
      setReceiptMeta(parsed.meta)
      const receiptType = parsed.meta.receipt_type
      if (receiptType === RECEIPT_TYPES.ITEMIZED) {
        setReceiptProgress(`Detectamos ${parsed.items.length} productos posibles. Revisa y elimina líneas incorrectas.`)
      } else if (receiptType === RECEIPT_TYPES.SUMMARY) {
        setReceiptProgress('Boleta sin desglose detectada. Puedes usarla como respaldo del reporte manual.')
      } else if (receiptType === RECEIPT_TYPES.PAYMENT) {
        setReceiptProgress('Comprobante de pago detectado. No se extraerán productos.')
      } else {
        setReceiptProgress('No pudimos identificar el documento con seguridad.')
      }

      setForm(prev => ({
        ...prev,
        store_name: prev.store_name || parsed.meta.store_name || '',
        purchase_date: parsed.meta.purchase_date || prev.purchase_date,
        payment_method: parsed.meta.payment_method || prev.payment_method,
      }))

      if (receiptType === RECEIPT_TYPES.ITEMIZED && !parsed.meta.confident_products_count) {
        setError('No pudimos identificar productos con suficiente precisión. Puedes ingresarlos manualmente.')
      }
    } catch (err) {
      console.error('PriceNow receipt OCR failed:', err)
      setError('No pudimos procesar la boleta. Puedes intentar con una foto más clara o ingresar los datos manualmente.')
    } finally {
      if (worker) await worker.terminate().catch(() => {})
      setReceiptProcessing(false)
    }
  }

  function updateReceiptItem(localId, patch) {
    setReceiptReviewConfirmed(false)
    setReceiptItems(prev => prev.map(item => item.local_id === localId ? { ...item, ...patch } : item))
  }

  function useSuggestedReceiptProduct(item) {
    if (!item.suggested_product_name) return
    updateReceiptItem(item.local_id, { product_name: item.suggested_product_name, suggested_product_id: item.suggested_product_id })
  }

  function handleReceiptTypeChange(nextType) {
    setReceiptReviewConfirmed(false)
    setReceiptMeta(prev => ({
      ...prev,
      receipt_type: nextType,
      has_itemized_products: nextType === RECEIPT_TYPES.ITEMIZED,
    }))
    if (nextType !== RECEIPT_TYPES.ITEMIZED) {
      setReceiptItems(prev => prev.map(item => ({ ...item, include_in_report: false, discarded: true })))
    }
  }

  function confirmReceiptReview() {
    if (!photo) return
    if (receiptMeta.payment_method && !receiptPaymentConfirmed) {
      setError('Confirma el método de pago detectado en la boleta.')
      return
    }
    setReceiptReviewConfirmed(true)
    setError(null)
  }

  function validate() {
    const savingReceiptItems = photo && receiptReviewConfirmed && includedReceiptItems.length > 0
    if (photo && !receiptReviewConfirmed) return 'Antes de guardar, abre "Revisa tu boleta" y confirma las líneas detectadas.'
    if (photo && receiptMeta.payment_method && !receiptPaymentConfirmed) return 'Confirma el método de pago detectado en la boleta.'
    if (!savingReceiptItems && !form.product_name.trim()) return 'El nombre del producto es obligatorio.'
    if (!savingReceiptItems && (!form.quantity || parseFloat(form.quantity) <= 0)) return 'La cantidad debe ser mayor a 0.'
    if (!savingReceiptItems && (!form.price || parseFloat(form.price) <= 0)) return 'El precio debe ser mayor a 0.'
    if (!savingReceiptItems && form.has_discount) {
      if (!form.discount_value || Number(form.discount_value) <= 0) return 'Ingresa el valor del descuento.'
      if (form.discount_type === 'porcentaje' && Number(form.discount_value) >= 100) return 'El porcentaje de descuento debe ser menor a 100%.'
      if (finalPrice == null || finalPrice <= 0) return 'El precio final debe ser mayor a 0.'
    }
    if (savingReceiptItems) {
      const invalidItem = includedReceiptItems.find(item => !item.product_name?.trim() || Number(item.quantity) <= 0 || Number(item.final_price) <= 0)
      if (invalidItem) return 'Revisa las líneas incluidas: producto, cantidad y precio final son obligatorios.'
    }
    if (!form.store_name.trim()) return 'La tienda es obligatoria.'
    if (!form.sector) return 'El sector es obligatorio.'
    if (!form.purchase_date) return 'La fecha de compra es obligatoria.'
    return null
  }

  async function insertPriceEntry(payload) {
    let nextPayload = { ...payload }
    let result = null
    const optionalColumns = [
      'city',
      'commune',
      'region',
      'has_discount',
      'normal_price',
      'final_price',
      'discount_type',
      'discount_amount',
      'discount_percentage',
      'promotion_description',
      'payment_method',
      'payment_condition',
      'requires_specific_payment_method',
      'baes_eligibility_status',
      'receipt_id',
      'receipt_item_id',
      'discount_source',
    ]

    for (let attempt = 0; attempt < optionalColumns.length + 1; attempt += 1) {
      result = await supabase.from('price_entries').insert(nextPayload).select('id').single()
      if (!result.error) return result

      const missingColumn = optionalColumns.find(column => nextPayload[column] !== undefined && new RegExp(column, 'i').test(result.error.message || ''))
      if (!missingColumn) return result
      const { [missingColumn]: _removed, ...fallbackPayload } = nextPayload
      nextPayload = fallbackPayload
    }

    return result
  }

  async function uploadReceiptPhoto() {
    if (!photo) return null
    const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${user.id}/${Date.now()}.${extension}`
    const { error: uploadErr } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .upload(path, photo, { contentType: photo.type, upsert: false })

    if (uploadErr) {
      const message = uploadErr.message || ''
      if (/bucket|not found|does not exist/i.test(message)) {
        throw new Error('Falta configurar el bucket "receipts" en Supabase Storage.')
      }
      throw uploadErr
    }
    return path
  }

  async function createReceiptRecord(storagePath) {
    if (!storagePath) return null
    const payload = {
      user_id: user.id,
      storage_path: storagePath,
      original_filename: photo?.name || null,
      mime_type: photo?.type || null,
      size_bytes: photo?.size || null,
      ocr_text: receiptOcrText || null,
      sanitized_text: receiptOcrText || null,
      store_name: form.store_name.trim() || receiptMeta.store_name || null,
      store_address: receiptMeta.store_address || null,
      purchase_date: form.purchase_date || receiptMeta.purchase_date || null,
      total_amount: receiptMeta.total_amount || null,
      net_amount: receiptMeta.net_amount || null,
      tax_amount: receiptMeta.tax_amount || null,
      payment_method: form.payment_method || receiptMeta.payment_method || null,
      payment_method_confirmed: Boolean(receiptPaymentConfirmed),
      general_discount_amount: receiptMeta.general_discount_amount || null,
      general_discount_note: receiptMeta.has_general_discount ? 'La boleta contiene un descuento general. Revisa a que producto corresponde.' : null,
      receipt_type: receiptMeta.receipt_type || RECEIPT_TYPES.UNKNOWN,
      has_itemized_products: receiptMeta.receipt_type === RECEIPT_TYPES.ITEMIZED,
      parser_confidence: receiptMeta.parser_confidence || null,
      parser_version: receiptMeta.parser_version || null,
      review_status: receiptReviewConfirmed ? 'reviewed' : 'pending_review',
    }

    const { data, error: receiptError } = await supabase
      .from('receipts')
      .insert(payload)
      .select('id')
      .single()

    if (receiptError) throw receiptError
    return data?.id || null
  }

  async function createReceiptItems(receiptId, items) {
    if (!receiptId || !items.length) return new Map()
    const rows = items.map((item, index) => ({
      receipt_id: receiptId,
      line_index: item.line_index ?? index,
      original_text: item.original_text,
      product_name: item.product_name.trim(),
      suggested_product_id: item.suggested_product_id || null,
      suggested_product_name: item.suggested_product_name || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'unidad',
      normal_price: Number(item.normal_price || item.final_price || 0),
      discount_amount: Number(item.discount_amount || 0) || null,
      final_price: Number(item.final_price || item.normal_price || 0),
      discount_source: item.discount_amount > 0 ? item.discount_source || 'receipt' : null,
      include_in_report: Boolean(item.include_in_report),
      confidence: item.confidence || null,
      is_discarded: Boolean(item.discarded),
    }))

    const { data, error: itemsError } = await supabase
      .from('receipt_items')
      .insert(rows)
      .select('id,line_index')

    if (itemsError) throw itemsError
    return new Map((data || []).map(row => [row.line_index, row.id]))
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    setError(null)

    try {
      const receipt_photo_url = await uploadReceiptPhoto()
      const receiptId = await createReceiptRecord(receipt_photo_url)
      const zone = locationZone || getStoredZone()
      const useReceiptItems = photo && receiptReviewConfirmed && includedReceiptItems.length > 0
      const selectedReceiptItems = useReceiptItems ? includedReceiptItems : []
      const receiptItemIdMap = await createReceiptItems(receiptId, selectedReceiptItems)

      if (selectedReceiptItems.length) {
        for (const item of selectedReceiptItems) {
          const resolvedProduct = await resolveProductInput({
            product_id: item.suggested_product_id,
            product_name: item.product_name.trim(),
            category: form.product_category || 'Otros',
            unit: item.unit || 'unidad',
          })
          const normalItemPrice = Number(item.normal_price || item.final_price)
          const finalItemPrice = Number(item.final_price || normalItemPrice)
          const itemDiscount = Number(item.discount_amount || 0)
          const itemHasDiscount = itemDiscount > 0 && normalItemPrice > finalItemPrice
          const receiptItemId = receiptItemIdMap.get(item.line_index) || null
          const result = await insertPriceEntry({
            user_id: user.id,
            product_id: resolvedProduct?.id ?? null,
            product_name: resolvedProduct?.name || item.product_name.trim(),
            brand: form.brand.trim() || null,
            quantity: Number(item.quantity || 1),
            unit: item.unit || 'unidad',
            price: normalItemPrice,
            unit_price: calcUnitPrice(finalItemPrice, item.quantity || 1, item.unit || 'unidad'),
            has_discount: itemHasDiscount,
            normal_price: itemHasDiscount ? normalItemPrice : null,
            final_price: itemHasDiscount ? finalItemPrice : null,
            discount_type: itemHasDiscount ? 'monto' : null,
            discount_amount: itemHasDiscount ? itemDiscount : null,
            discount_percentage: null,
            discount_source: itemHasDiscount ? item.discount_source || 'receipt' : null,
            promotion_description: itemHasDiscount ? 'Descuento detectado en boleta' : null,
            payment_method: form.payment_method || null,
            requires_specific_payment_method: Boolean(form.requires_specific_payment_method),
            payment_condition: form.requires_specific_payment_method ? form.payment_condition.trim() || paymentMethodLabel(form.payment_method) : null,
            baes_eligibility_status: form.payment_method === 'junaeb_baes' ? 'eligible' : form.baes_eligibility_status || null,
            store_name: form.store_name.trim(),
            store_id: form._store_id ?? null,
            sector: form.sector,
            city: zone?.city || zone?.commune || null,
            commune: zone?.commune || null,
            region: zone?.region || zone?.state || null,
            purchase_date: form.purchase_date,
            notes: form.notes.trim() || null,
            receipt_photo_url,
            receipt_id: receiptId,
            receipt_item_id: receiptItemId,
            purchase_latitude: location?.lat ?? null,
            purchase_longitude: location?.lng ?? null,
            location_accuracy_m: location?.accuracy ?? null,
            location_source: location?.source ?? null,
            google_maps_url: location ? googleMapsUrl(location.lat, location.lng) : null,
          })
          if (result.error) throw result.error
          if (receiptItemId && result.data?.id) {
            await supabase.from('receipt_items').update({ price_entry_id: result.data.id }).eq('id', receiptItemId)
          }
        }
      } else {
        const resolvedProduct = await resolveProductBeforeSubmit()
        const hasDiscount = Boolean(form.has_discount)
        const parsedDiscountValue = Number(form.discount_value)
        const requiresSpecificPayment = Boolean(form.requires_specific_payment_method)
        const result = await insertPriceEntry({
          user_id: user.id,
          product_id: resolvedProduct?.id ?? null,
          product_name: resolvedProduct?.name || form.product_name.trim(),
          brand: form.brand.trim() || null,
          quantity: parseFloat(form.quantity),
          unit: form.unit,
          price: parseFloat(form.price),
          unit_price: unitPrice,
          has_discount: hasDiscount,
          normal_price: hasDiscount ? parseFloat(form.price) : null,
          final_price: hasDiscount ? finalPrice : null,
          discount_type: hasDiscount ? form.discount_type : null,
          discount_amount: hasDiscount && form.discount_type === 'monto' ? parsedDiscountValue : null,
          discount_percentage: hasDiscount && form.discount_type === 'porcentaje' ? parsedDiscountValue : null,
          discount_source: hasDiscount && photo ? 'receipt' : null,
          promotion_description: hasDiscount ? form.promotion_description.trim() || null : null,
          payment_method: form.payment_method || null,
          requires_specific_payment_method: requiresSpecificPayment,
          payment_condition: requiresSpecificPayment ? form.payment_condition.trim() || paymentMethodLabel(form.payment_method) : null,
          baes_eligibility_status: form.payment_method === 'junaeb_baes' ? 'eligible' : form.baes_eligibility_status || null,
          store_name: form.store_name.trim(),
          store_id: form._store_id ?? null,
          sector: form.sector,
          city: zone?.city || zone?.commune || null,
          commune: zone?.commune || null,
          region: zone?.region || zone?.state || null,
          purchase_date: form.purchase_date,
          notes: form.notes.trim() || null,
          receipt_photo_url,
          receipt_id: receiptId,
          receipt_item_id: null,
          purchase_latitude: location?.lat ?? null,
          purchase_longitude: location?.lng ?? null,
          location_accuracy_m: location?.accuracy ?? null,
          location_source: location?.source ?? null,
          google_maps_url: location ? googleMapsUrl(location.lat, location.lng) : null,
        })
        if (result.error) throw result.error
      }

      setSuccess(true)
      setForm(EMPTY_FORM)
      setPhoto(null)
      setPreview(null)
      setLocation(null)
      setReceiptOcrText('')
      setReceiptItems([])
      setReceiptMeta(EMPTY_RECEIPT_META)
      setReceiptReviewConfirmed(false)
      setReceiptPaymentConfirmed(false)
      setTimeout(() => { setSuccess(false); navigate('/') }, 2000)
    } catch (submitErr) {
      setError('Error al guardar: ' + submitErr.message)
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

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setProductCatalogOpen(prev => !prev)}
              className="btn-secondary w-full text-sm py-2"
            >
              {productCatalogOpen ? 'Ocultar catálogo de productos' : 'Ver catálogo de productos'}
            </button>
          </div>

          {productCatalogOpen && (
            <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Catálogo PriceNow</p>
                  <p className="text-[11px] text-slate-400">Selecciona un producto estándar o escribe uno nuevo.</p>
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">{products.length} productos</span>
              </div>

              <label className="input-label">Filtrar por categoría</label>
              <select
                value={productCatalogCategory}
                onChange={e => setProductCatalogCategory(e.target.value)}
                className="input-field mb-2"
              >
                {catalogCategories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>

              {catalogProducts.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-100">
                  {catalogProducts.map(product => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => applyProduct(product)}
                      className="w-full text-left px-3 py-2 active:bg-brand-50"
                    >
                      <p className="text-sm font-semibold text-slate-800">{product.name}</p>
                      <p className="text-xs text-slate-400">{product.category}{product.subcategory ? ` · ${product.subcategory}` : ''} · unidad base: {product.default_unit}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                  No hay productos con ese filtro. Puedes escribir el nombre manualmente y PriceNow lo creará como producto estandarizado.
                </p>
              )}
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
          <label className="input-label">{form.has_discount ? 'Precio normal ($)' : 'Precio total ($)'} <span className="text-danger-500">*</span></label>
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

        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <label className="flex items-center justify-between gap-3 text-sm font-black text-slate-800">
            ¿Este producto tenia descuento?
            <input
              type="checkbox"
              checked={Boolean(form.has_discount)}
              onChange={e => setForm(prev => ({ ...prev, has_discount: e.target.checked }))}
            />
          </label>

          {form.has_discount && (
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-bold text-slate-500">Tipo
                  <select name="discount_type" value={form.discount_type} onChange={handleChange} className="input-field">
                    {DISCOUNT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-500">
                  {form.discount_type === 'porcentaje' ? 'Porcentaje' : form.discount_type === 'precio_promocional' ? 'Precio promocional' : 'Valor descuento'}
                  <input
                    name="discount_value"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={form.discount_value}
                    onChange={handleChange}
                    className="input-field"
                    placeholder={form.discount_type === 'porcentaje' ? 'Ej: 20' : 'Ej: 500'}
                  />
                </label>
              </div>

              <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                Precio final calculado: {finalPrice != null ? finalPrice.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }) : 'Completa el descuento'}
              </div>

              <textarea
                name="promotion_description"
                value={form.promotion_description}
                onChange={handleChange}
                maxLength={160}
                rows={2}
                className="input-field resize-none"
                placeholder="Descripcion opcional de la oferta"
              />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <label className="input-label">Metodo de pago</label>
          <select name="payment_method" value={form.payment_method} onChange={handleChange} className="input-field">
            {PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
            La oferta exige este método
            <input
              type="checkbox"
              checked={Boolean(form.requires_specific_payment_method)}
              onChange={e => setForm(prev => ({ ...prev, requires_specific_payment_method: e.target.checked }))}
            />
          </label>
          {form.requires_specific_payment_method && (
            <input
              name="payment_condition"
              value={form.payment_condition}
              onChange={handleChange}
              className="input-field mt-2"
              placeholder={`Ej: solo pagando con ${paymentMethodLabel(form.payment_method)}`}
            />
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
          <label className="input-label">Comuna / sector <span className="text-danger-500">*</span></label>
          <input
            name="sector"
            list="pricenow-zones"
            value={form.sector}
            onChange={handleChange}
            className="input-field"
            placeholder="Ej: Providencia, Santiago, Rancagua"
          />
          <datalist id="pricenow-zones">
            {availableSectors.map(s => <option key={s} value={s} />)}
          </datalist>
          {locationZone?.commune && <p className="mt-1 text-xs font-semibold text-brand-600">Zona detectada: {zoneSubtitle(locationZone)}</p>}
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
              <img src={preview} alt="Vista previa boleta" className="max-h-48 mx-auto rounded-lg object-contain" />
            ) : (
              <div className="text-slate-400">
                <svg className="w-8 h-8 mx-auto mb-1 fill-slate-300" viewBox="0 0 24 24">
                  <path d="M20 4v12H8V4h12m0-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 9.67l1.69 2.26 2.48-3.1L19 15H9zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/>
                </svg>
                <p className="text-sm">Toca para tomar o adjuntar foto</p>
                <p className="text-xs text-slate-300 mt-0.5">JPG, JPEG, PNG o WEBP - max. 10 MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          {preview && (
            <button
              type="button"
              onClick={clearReceiptPhoto}
              className="text-xs text-danger-500 mt-1 underline"
            >
              Quitar foto
            </button>
          )}
          {photo && (
            <div className="mt-3 space-y-2">
              <details className="rounded-2xl bg-slate-50 p-3 text-left">
                <summary className="cursor-pointer text-xs font-black text-slate-700">
                  Recortar zona útil antes del OCR
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-semibold text-slate-500">
                    Inicio de lectura: {receiptCrop.top}%
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={receiptCrop.top}
                      onChange={e => setReceiptCrop(prev => ({ ...prev, top: Math.min(Number(e.target.value), prev.bottom - 5) }))}
                      className="mt-1 w-full"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500">
                    Fin de lectura: {receiptCrop.bottom}%
                    <input
                      type="range"
                      min="20"
                      max="100"
                      value={receiptCrop.bottom}
                      onChange={e => setReceiptCrop(prev => ({ ...prev, bottom: Math.max(Number(e.target.value), prev.top + 5) }))}
                      className="mt-1 w-full"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setReceiptCrop(DEFAULT_RECEIPT_CROP)}
                    className="text-xs font-black text-brand-600 underline"
                  >
                    Usar boleta completa
                  </button>
                </div>
              </details>
              <button
                type="button"
                onClick={processReceiptPhoto}
                disabled={receiptProcessing}
                className="btn-secondary w-full text-sm py-2"
              >
                {receiptProcessing ? 'Procesando boleta...' : receiptItems.length || receiptOcrText ? 'Procesar boleta nuevamente' : 'Procesar boleta'}
              </button>
              <p className="text-xs text-slate-400">
                PriceNow usa OCR local con Tesseract.js. No guardes códigos de autorización, cuentas ni números completos de tarjetas.
              </p>
            </div>
          )}
          {receiptProgress && (
            <p className="mt-2 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
              {receiptProgress}
            </p>
          )}

          {photo && (receiptOcrText || receiptItems.length > 0 || receiptMeta.has_general_discount) && (
            <section className="mt-4 rounded-[1.5rem] border border-blue-100 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-900">Revisa tu boleta</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Nada se publica automáticamente. Confirma comercio, método de pago y cada producto incluido.
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-black ${receiptReviewConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {receiptReviewConfirmed ? 'Revisada' : 'Pendiente'}
                </span>
              </div>

              <label className="mt-4 block text-xs font-semibold text-slate-600">
                Tipo de documento detectado
                <select
                  value={receiptMeta.receipt_type || RECEIPT_TYPES.UNKNOWN}
                  onChange={e => handleReceiptTypeChange(e.target.value)}
                  className="input-field mt-1"
                >
                  {RECEIPT_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {receiptMeta.receipt_type === RECEIPT_TYPES.SUMMARY && (
                <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  Esta boleta no incluye desglose de productos. Ingresa manualmente el producto y usa la boleta como respaldo del total.
                </p>
              )}
              {receiptMeta.receipt_type === RECEIPT_TYPES.PAYMENT && (
                <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                  Este comprobante corresponde al pago y no contiene productos.
                </p>
              )}
              {receiptMeta.receipt_type === RECEIPT_TYPES.UNKNOWN && (
                <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  No pudimos identificar con seguridad el documento. Puedes usar la foto como respaldo e ingresar el producto manualmente.
                </p>
              )}

              {receiptMeta.has_general_discount && (
                <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  La boleta contiene un descuento general. Revisa a que producto corresponde.
                </p>
              )}
              {receiptMeta.receipt_type === RECEIPT_TYPES.ITEMIZED && (
                <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                  Detectamos {receiptItems.length} productos posibles. Revisa y elimina líneas incorrectas.
                </p>
              )}
              {receiptMeta.reconciliation_warning && (
                <p className="mt-2 rounded-2xl bg-danger-50 p-3 text-sm font-semibold text-danger-500">
                  {receiptMeta.reconciliation_warning}
                </p>
              )}
              {receiptMeta.receipt_type === RECEIPT_TYPES.ITEMIZED && receiptItems.length > 0 && !receiptMeta.confident_products_count && (
                <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  No pudimos identificar productos con suficiente precisión. Puedes ingresarlos manualmente.
                </p>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">
                  Comercio
                  <input
                    value={form.store_name}
                    onChange={e => setForm(prev => ({ ...prev, store_name: e.target.value }))}
                    className="input-field mt-1"
                    placeholder="Comercio detectado"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Fecha
                  <input
                    type="date"
                    value={form.purchase_date}
                    onChange={e => setForm(prev => ({ ...prev, purchase_date: e.target.value }))}
                    className="input-field mt-1"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </label>
                {receiptMeta.store_address && (
                  <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:col-span-2">
                    Dirección detectada: <span className="text-slate-700">{receiptMeta.store_address}</span>
                  </p>
                )}
                <label className="text-xs font-semibold text-slate-600">
                  Método de pago detectado
                  <select
                    value={form.payment_method}
                    onChange={e => {
                      setForm(prev => ({ ...prev, payment_method: e.target.value }))
                      setReceiptPaymentConfirmed(false)
                    }}
                    className="input-field mt-1"
                  >
                    {PAYMENT_METHODS.map(method => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!receiptMeta.payment_method || receiptPaymentConfirmed}
                    disabled={!receiptMeta.payment_method}
                    onChange={e => setReceiptPaymentConfirmed(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Confirmo el método de pago
                </label>
              </div>

              {receiptMeta.total_amount && (
                <p className="mt-3 text-xs font-semibold text-slate-500">
                  Total detectado: {formatCLP(receiptMeta.total_amount)}
                </p>
              )}
              {(receiptMeta.net_amount || receiptMeta.tax_amount) && (
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {receiptMeta.net_amount ? `Neto: ${formatCLP(receiptMeta.net_amount)}` : ''}
                  {receiptMeta.net_amount && receiptMeta.tax_amount ? ' · ' : ''}
                  {receiptMeta.tax_amount ? `IVA: ${formatCLP(receiptMeta.tax_amount)}` : ''}
                </p>
              )}

              {receiptMeta.receipt_type === RECEIPT_TYPES.ITEMIZED && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-black text-slate-800">Productos detectados</h4>
                  <span className="text-xs font-semibold text-slate-400">
                    {includedReceiptItems.length} incluidos
                  </span>
                </div>

                {receiptItems.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
                    No detectamos productos claros. Puedes completar el reporte manualmente y confirmar esta revisión.
                  </p>
                ) : (
                  receiptItems.map(item => (
                    <article key={item.local_id} className={`rounded-2xl border border-slate-100 bg-slate-50 p-3 ${item.discarded ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs font-black text-slate-700">
                          <input
                            type="checkbox"
                            checked={item.include_in_report && !item.discarded}
                            onChange={e => updateReceiptItem(item.local_id, { include_in_report: e.target.checked })}
                            className="rounded border-slate-300"
                            disabled={item.discarded}
                          />
                          Incluir en reporte
                        </label>
                        <div className="flex flex-wrap justify-end gap-1">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${receiptConfidenceClass(item.confidence)}`}>
                            Confianza {item.confidence || 'baja'}
                          </span>
                          {item.discount_amount > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
                              Descuento boleta
                            </span>
                          )}
                          {item.discarded && (
                            <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-black text-slate-600">
                              Descartada
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Texto original: <span className="font-semibold text-slate-700">{item.original_text}</span>
                      </p>
                      {item.suggested_product_name && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 p-2 text-xs text-blue-700">
                          <span className="font-semibold">Sugerido: {item.suggested_product_name}</span>
                          <button
                            type="button"
                            onClick={() => useSuggestedReceiptProduct(item)}
                            className="rounded-full bg-white px-2 py-1 font-black text-blue-700"
                          >
                            Usar sugerencia
                          </button>
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-slate-600">
                          Producto
                          <input
                            value={item.product_name}
                            onChange={e => updateReceiptItem(item.local_id, { product_name: e.target.value, suggested_product_id: null })}
                            className="input-field mt-1"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                          Cantidad
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.quantity}
                            onChange={e => updateReceiptItem(item.local_id, { quantity: e.target.value })}
                            className="input-field mt-1"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                          Precio final
                          <input
                            type="number"
                            min="1"
                            value={item.final_price}
                            onChange={e => updateReceiptItem(item.local_id, { final_price: e.target.value })}
                            className="input-field mt-1"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                          Descuento
                          <input
                            type="number"
                            min="0"
                            value={item.discount_amount || ''}
                            onChange={e => updateReceiptItem(item.local_id, { discount_amount: e.target.value, discount_source: e.target.value ? 'receipt' : null })}
                            className="input-field mt-1"
                            placeholder="0"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateReceiptItem(item.local_id, { include_in_report: false, discarded: true })}
                        className="mt-3 rounded-full bg-white px-3 py-2 text-xs font-black text-danger-500 shadow-sm"
                      >
                        Descartar línea
                      </button>
                    </article>
                  ))
                )}
              </div>
              )}

              {receiptOcrText && (
                <details className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
                  <summary className="cursor-pointer font-black text-slate-700">Ver texto OCR protegido</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans">{receiptOcrText}</pre>
                </details>
              )}

              <button
                type="button"
                onClick={confirmReceiptReview}
                className="btn-primary mt-4 w-full py-2 text-sm"
              >
                Confirmar revisión de boleta
              </button>
            </section>
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
