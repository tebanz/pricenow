const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

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

function buildOverpassNearbyQuery(lat, lng, radiusMeters = 7000) {
  return `
    [out:json][timeout:20];
    (
      node["shop"](around:${radiusMeters},${lat},${lng});
      way["shop"](around:${radiusMeters},${lat},${lng});
      relation["shop"](around:${radiusMeters},${lat},${lng});
      node["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
      way["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
      relation["amenity"~"marketplace"](around:${radiusMeters},${lat},${lng});
      node["name"~"lider|jumbo|tottus|unimarc|santa isabel|acuenta|cugat|mayorista|supermercado|minimarket|almacen|almacén|panader", i](around:${radiusMeters},${lat},${lng});
      way["name"~"lider|jumbo|tottus|unimarc|santa isabel|acuenta|cugat|mayorista|supermercado|minimarket|almacen|almacén|panader", i](around:${radiusMeters},${lat},${lng});
      relation["name"~"lider|jumbo|tottus|unimarc|santa isabel|acuenta|cugat|mayorista|supermercado|minimarket|almacen|almacén|panader", i](around:${radiusMeters},${lat},${lng});
    );
    out center tags 120;
  `
}

function elementPosition(element) {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (lat == null || lng == null) return null
  return { lat: Number(lat), lng: Number(lng) }
}

function addressFromTags(tags = {}) {
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

function normalize(element, origin) {
  const position = elementPosition(element)
  if (!position) return null

  const tags = element.tags || {}
  const name = tags.name || tags.brand || tags.operator
  if (!name) return null

  const type = tags.shop || tags.amenity || 'comercio'
  const distance_km = distanceKm(origin, position)
  if (distance_km == null) return null

  return {
    id: `${element.type}/${element.id}`,
    name,
    type,
    address: addressFromTags(tags),
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_km: Number(distance_km.toFixed(3)),
    source: 'openstreetmap_overpass_api_proxy',
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 8500) {
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
    throw new Error(`Overpass ${endpoint} respondió ${response.status}`)
  }

  return response.json()
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Coordenadas inválidas.', places: [] })
  }

  const origin = { lat, lng }
  const radii = [3000, 7000, 15000]
  let lastError = null

  for (const radius of radii) {
    const query = buildOverpassNearbyQuery(lat, lng, radius)

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const data = await requestOverpass(endpoint, query)
        const unique = new Map()

        ;(data.elements || [])
          .map(element => normalize(element, origin))
          .filter(Boolean)
          .sort((a, b) => a.distance_km - b.distance_km)
          .forEach(place => {
            const key = `${place.name.toLowerCase()}-${place.lat}-${place.lng}`
            if (!unique.has(key)) unique.set(key, place)
          })

        const places = Array.from(unique.values()).slice(0, 12)
        if (places.length > 0) {
          return res.status(200).json({ places, radius_m: radius, source: endpoint })
        }
      } catch (err) {
        lastError = err
      }
    }
  }

  return res.status(200).json({
    places: [],
    error: lastError?.message || null,
  })
}
