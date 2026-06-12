const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

const TYPE_FILTERS = {
  supermercado: { shop: 'supermarket|wholesale' },
  minimarket: { shop: 'convenience' },
  almacen: { shop: 'convenience|general|supermarket' },
  panaderia: { shop: 'bakery' },
  carniceria: { shop: 'butcher' },
  verduleria: { shop: 'greengrocer' },
  feria: { amenity: 'marketplace', shop: 'marketplace' },
  mayorista: { shop: 'wholesale|supermarket' },
  farmacia: { amenity: 'pharmacy', shop: 'chemist|pharmacy' },
  otro: { shop: '.+', amenity: 'marketplace|pharmacy' },
}

const KNOWN_LOCAL_BUSINESS_REGEX = 'lider|lider express|jumbo|tottus|unimarc|santa isabel|acuenta|cugat|mayorista|supermercado|minimarket|almacen|almac[eé]n|panader|carnicer|verduler|farmacia'

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

function distanceKm(a, b) {
  if (!isValidCoordinate(a?.lat, a?.lng) || !isValidCoordinate(b?.lat, b?.lng)) return null
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

function cleanText(value = '') {
  return value.toString().trim().replace(/\s+/g, ' ')
}

function normalizeText(value = '') {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeOverpassRegex(value = '') {
  return cleanText(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function typeFilter(type = 'otro') {
  return TYPE_FILTERS[normalizeText(type)] || TYPE_FILTERS.otro
}

function buildNameFilter(query) {
  const cleaned = cleanText(query)
  if (!cleaned) return ''
  return `["name"~"${escapeOverpassRegex(cleaned)}", i]`
}

function buildOverpassAroundQuery(lat, lng, radiusMeters = 7000, options = {}) {
  const filter = typeFilter(options.type)
  const nameFilter = buildNameFilter(options.query)
  const shopRegex = filter.shop || '.+'
  const amenityRegex = filter.amenity
  const parts = [
    `node["shop"~"${shopRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`,
    `way["shop"~"${shopRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`,
    `relation["shop"~"${shopRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`,
  ]

  if (amenityRegex) {
    parts.push(
      `node["amenity"~"${amenityRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`,
      `way["amenity"~"${amenityRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`,
      `relation["amenity"~"${amenityRegex}", i]${nameFilter}(around:${radiusMeters},${lat},${lng});`
    )
  }

  if (!nameFilter && !options.type) {
    parts.push(
      `node["name"~"${KNOWN_LOCAL_BUSINESS_REGEX}", i](around:${radiusMeters},${lat},${lng});`,
      `way["name"~"${KNOWN_LOCAL_BUSINESS_REGEX}", i](around:${radiusMeters},${lat},${lng});`,
      `relation["name"~"${KNOWN_LOCAL_BUSINESS_REGEX}", i](around:${radiusMeters},${lat},${lng});`
    )
  }

  return `
    [out:json][timeout:22];
    (
      ${parts.join('\n      ')}
    );
    out center tags 140;
  `
}

function elementPosition(element) {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (!isValidCoordinate(lat, lng)) return null
  return { lat: Number(lat), lng: Number(lng) }
}

function addressFromTags(tags = {}) {
  const street = tags['addr:street']
  const number = tags['addr:housenumber']
  const suburb = tags['addr:suburb'] || tags['addr:neighbourhood']
  const city = tags['addr:city'] || tags['addr:municipality']
  const parts = []
  if (street) parts.push(number ? `${street} ${number}` : street)
  if (suburb) parts.push(suburb)
  if (city) parts.push(city)
  return parts.join(', ')
}

function normalizeOverpassElement(element, origin) {
  const position = elementPosition(element)
  if (!position) return null

  const tags = element.tags || {}
  const name = tags.name || tags.brand || tags.operator
  if (!name) return null

  const type = tags.shop || tags.amenity || 'comercio'
  const distance_km = origin ? distanceKm(origin, position) : null

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    type,
    address: addressFromTags(tags),
    commune: tags['addr:city'] || tags['addr:municipality'] || tags['is_in:city'] || '',
    sector: tags['addr:suburb'] || tags['addr:neighbourhood'] || '',
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_km: distance_km == null ? null : Number(distance_km.toFixed(3)),
    source: 'openstreetmap_overpass_api_proxy',
  }
}

function normalizeNominatimPlace(place, origin) {
  if (!isValidCoordinate(place.lat, place.lon)) return null
  const position = { lat: Number(place.lat), lng: Number(place.lon) }
  const distance_km = origin ? distanceKm(origin, position) : null
  const name = place.name || place.display_name?.split(',')[0]
  if (!name) return null

  return {
    id: `nominatim-${place.osm_type || 'place'}-${place.osm_id || `${place.lat}-${place.lon}`}`,
    name,
    type: place.type || place.category || 'resultado',
    address: place.display_name || '',
    commune: place.address?.city || place.address?.town || place.address?.municipality || '',
    sector: place.address?.suburb || place.address?.neighbourhood || '',
    lat: Number(Number(place.lat).toFixed(7)),
    lng: Number(Number(place.lon).toFixed(7)),
    distance_km: distance_km == null ? null : Number(distance_km.toFixed(3)),
    source: 'openstreetmap_nominatim_proxy',
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

async function requestOverpass(endpoint, query) {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
  })

  if (!response.ok) {
    throw new Error(`Overpass ${endpoint} respondio ${response.status}`)
  }

  return response.json()
}

async function geocode(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '8',
    countrycodes: 'cl',
  })
  const response = await fetchWithTimeout(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: {
      'Accept-Language': 'es',
      'User-Agent': 'PriceNow Local Intelligence',
    },
  })
  if (!response.ok) throw new Error(`Nominatim respondio ${response.status}`)
  return response.json()
}

function uniquePlaces(places, limit = 16) {
  const unique = new Map()
  places.filter(Boolean).forEach(place => {
    if (!isValidCoordinate(place.lat, place.lng)) return
    const key = `${normalizeText(place.name)}-${Number(place.lat).toFixed(5)}-${Number(place.lng).toFixed(5)}`
    if (!unique.has(key)) unique.set(key, place)
  })
  return Array.from(unique.values())
    .sort((a, b) => (a.distance_km ?? 999999) - (b.distance_km ?? 999999))
    .slice(0, limit)
}

async function findOrigin({ lat, lng, commune, address }) {
  if (isValidCoordinate(lat, lng)) return { lat: Number(lat), lng: Number(lng) }
  const query = cleanText([address, commune, 'Chile'].filter(Boolean).join(', '))
  if (!query) return null
  const places = await geocode(query)
  const first = places.find(place => isValidCoordinate(place.lat, place.lon))
  return first ? { lat: Number(first.lat), lng: Number(first.lon) } : null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const mode = cleanText(req.query.mode || '')
  const queryText = cleanText(req.query.query || req.query.name || '')
  const address = cleanText(req.query.address || '')
  const commune = cleanText(req.query.commune || '')
  const type = cleanText(req.query.type || '')
  const lat = req.query.lat
  const lng = req.query.lng
  const limit = Math.min(Number(req.query.limit || 16), 30)
  const isImport = mode === 'import'
  const radius = Number(req.query.radius_m || (isImport ? 12000 : 7000))

  let lastError = null
  let origin = null

  try {
    origin = await findOrigin({ lat, lng, commune, address })
  } catch (err) {
    lastError = err
  }

  if (!origin) {
    return res.status(400).json({ error: 'No se pudo ubicar la comuna o coordenada de busqueda.', places: [] })
  }

  const collected = []

  if (!isImport && (queryText || address)) {
    try {
      const geocodeQuery = [queryText, address, commune, 'Chile'].filter(Boolean).join(', ')
      const places = await geocode(geocodeQuery)
      collected.push(...places.map(place => normalizeNominatimPlace(place, origin)))
    } catch (err) {
      lastError = err
    }
  }

  const overpassQuery = buildOverpassAroundQuery(origin.lat, origin.lng, Number.isFinite(radius) ? radius : 7000, {
    query: queryText,
    type,
  })

  for (const endpoint of OVERPASS_ENDPOINTS.slice(0, 2)) {
    try {
      const data = await requestOverpass(endpoint, overpassQuery)
      collected.push(...(data.elements || []).map(element => normalizeOverpassElement(element, origin)))
      const places = uniquePlaces(collected, limit)
      return res.status(200).json({ places, origin, radius_m: radius, source: endpoint, error: lastError?.message || null })
    } catch (err) {
      lastError = err
    }
  }

  return res.status(200).json({
    places: uniquePlaces(collected, limit),
    origin,
    radius_m: radius,
    error: lastError?.message || null,
  })
}
