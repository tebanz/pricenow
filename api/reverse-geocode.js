const GEOAPIFY_REVERSE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/reverse'

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
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

function pickZone(properties = {}) {
  const region = properties.state || properties.region || properties.county || ''
  const city = properties.city || properties.town || properties.village || properties.municipality || ''
  const commune = properties.municipality || properties.city || properties.town || properties.county || properties.district || ''
  const district = properties.suburb || properties.district || properties.neighbourhood || ''

  return {
    country: properties.country || '',
    region,
    state: region,
    city,
    municipality: properties.municipality || '',
    commune,
    district,
    suburb: properties.suburb || '',
    postcode: properties.postcode || '',
    formatted: properties.formatted || '',
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const apiKey = process.env.GEOAPIFY_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'Geoapify no esta configurado. Agrega GEOAPIFY_API_KEY.', zone: null })
  }

  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!isValidCoordinate(lat, lng)) {
    return res.status(400).json({ error: 'Coordenadas invalidas.', zone: null })
  }

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    lang: 'es',
    apiKey,
  })

  try {
    const response = await fetchWithTimeout(`${GEOAPIFY_REVERSE_ENDPOINT}?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || `Geoapify respondio ${response.status}`, zone: null })
    }

    const properties = data.features?.[0]?.properties || {}
    return res.status(200).json({ zone: pickZone(properties), source: 'geoapify' })
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Geoapify no respondio.', zone: null })
  }
}
