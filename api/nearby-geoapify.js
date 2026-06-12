const GEOAPIFY_ENDPOINT = 'https://api.geoapify.com/v2/places'

const DEFAULT_CATEGORIES = [
  'commercial.supermarket',
  'commercial.convenience',
  'commercial.food_and_drink.bakery',
  'commercial.food_and_drink.butcher',
  'commercial.food_and_drink.fruit_and_vegetable',
  'commercial.marketplace',
  'commercial.health_and_beauty.pharmacy',
  'commercial.discount_store',
  'commercial.trade',
]

const TYPE_CATEGORIES = {
  all: DEFAULT_CATEGORIES,
  todos: DEFAULT_CATEGORIES,
  supermercado: ['commercial.supermarket'],
  minimarket: ['commercial.convenience'],
  almacen: ['commercial.convenience'],
  panaderia: ['commercial.food_and_drink.bakery'],
  carniceria: ['commercial.food_and_drink.butcher'],
  verduleria: ['commercial.food_and_drink.fruit_and_vegetable'],
  feria: ['commercial.marketplace'],
  farmacia: ['commercial.health_and_beauty.pharmacy'],
  mayorista: ['commercial.supermarket', 'commercial.discount_store', 'commercial.trade'],
  otros: DEFAULT_CATEGORIES,
  otro: DEFAULT_CATEGORIES,
}

const KNOWN_MARKET_NAMES = [
  'lider',
  'express de lider',
  'santa isabel',
  'jumbo',
  'unimarc',
  'tottus',
  'mayorista 10',
  'acuenta',
  'alvi',
]

function normalizeText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

function distanceMeters(a, b) {
  if (!isValidCoordinate(a?.lat, a?.lng) || !isValidCoordinate(b?.lat, b?.lng)) return null
  const R = 6371000
  const toRad = value => Number(value) * Math.PI / 180
  const dLat = toRad(Number(b.lat) - Number(a.lat))
  const dLng = toRad(Number(b.lng) - Number(a.lng))
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

function categoriesForType(type = 'all') {
  return TYPE_CATEGORIES[normalizeText(type)] || DEFAULT_CATEGORIES
}

function typeFromCategories(categories = [], name = '') {
  const categoryText = categories.join(' ')
  const normalizedName = normalizeText(name)
  if (KNOWN_MARKET_NAMES.some(known => normalizedName.includes(known))) return 'supermercado'
  if (categoryText.includes('supermarket')) return 'supermercado'
  if (categoryText.includes('convenience')) return 'minimarket'
  if (categoryText.includes('bakery')) return 'panaderia'
  if (categoryText.includes('butcher')) return 'carniceria'
  if (categoryText.includes('fruit_and_vegetable')) return 'verduleria'
  if (categoryText.includes('marketplace')) return 'feria'
  if (categoryText.includes('pharmacy') || categoryText.includes('chemist')) return 'farmacia'
  if (categoryText.includes('discount_store') || categoryText.includes('trade')) return 'mayorista'
  return 'negocio'
}

function normalizeFeature(feature, origin) {
  const props = feature?.properties || {}
  const lat = props.lat ?? feature?.geometry?.coordinates?.[1]
  const lng = props.lon ?? feature?.geometry?.coordinates?.[0]
  if (!isValidCoordinate(lat, lng)) return null

  const name = props.name || props.address_line1
  if (!name) return null

  const position = { lat: Number(lat), lng: Number(lng) }
  const distance = Number.isFinite(Number(props.distance))
    ? Math.round(Number(props.distance))
    : distanceMeters(origin, position)

  return {
    id: props.place_id || `geoapify-${position.lat}-${position.lng}-${normalizeText(name)}`,
    name,
    type: typeFromCategories(props.categories || [], name),
    address: props.formatted || [props.street, props.housenumber, props.city].filter(Boolean).join(' '),
    country: props.country || '',
    region: props.state || props.region || '',
    city: props.city || props.town || props.village || props.municipality || '',
    commune: props.municipality || props.city || props.county || '',
    sector: props.suburb || props.district || props.neighbourhood || '',
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_m: distance,
    distance_km: distance == null ? null : Number((distance / 1000).toFixed(3)),
    source: 'geoapify',
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function uniquePlaces(places, limit = 20) {
  const unique = new Map()
  places.filter(Boolean).forEach(place => {
    const key = `${normalizeText(place.name)}-${Number(place.lat).toFixed(5)}-${Number(place.lng).toFixed(5)}`
    if (!unique.has(key)) unique.set(key, place)
  })
  return Array.from(unique.values())
    .sort((a, b) => (a.distance_m ?? 999999) - (b.distance_m ?? 999999))
    .slice(0, limit)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const apiKey = process.env.GEOAPIFY_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'Geoapify no esta configurado. Agrega GEOAPIFY_API_KEY.', places: [] })
  }

  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const radius = Number(req.query.radius || req.query.radius_m || 1500)
  const type = req.query.type || 'all'
  const limit = Math.min(Number(req.query.limit || 20), 50)

  if (!isValidCoordinate(lat, lng)) {
    return res.status(400).json({ error: 'Coordenadas invalidas.', places: [] })
  }

  const params = new URLSearchParams({
    categories: categoriesForType(type).join(','),
    filter: `circle:${lng},${lat},${Number.isFinite(radius) ? radius : 1500}`,
    bias: `proximity:${lng},${lat}`,
    limit: String(limit),
    lang: 'es',
    apiKey,
  })

  try {
    const response = await fetchWithTimeout(`${GEOAPIFY_ENDPOINT}?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || `Geoapify respondio ${response.status}`, places: [] })
    }

    const origin = { lat, lng }
    const places = uniquePlaces((data.features || []).map(feature => normalizeFeature(feature, origin)), limit)
    return res.status(200).json({ places, radius_m: radius, source: 'geoapify' })
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Geoapify no respondio.', places: [] })
  }
}
