const GEOAPIFY_REVERSE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/reverse'
const NOMINATIM_REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalized(value = '') {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function samePlace(a, b) {
  return Boolean(normalized(a) && normalized(a) === normalized(b))
}

function firstText(...values) {
  return values.map(clean).find(Boolean) || ''
}

function inferRancagua(fields = [], formatted = '') {
  const allText = [...fields, formatted].filter(Boolean).join(' ')
  return /\brancagua\b/i.test(allText)
}

function sanitizeZone(zone = {}) {
  let region = clean(zone.region || zone.state)
  let city = clean(zone.city)
  let commune = clean(zone.commune || zone.municipality)
  let sector = clean(zone.sector || zone.district || zone.suburb || zone.neighbourhood)
  const formatted = clean(zone.formatted)

  if (!city && commune) city = commune
  if (!commune && city) commune = city

  if (inferRancagua([city, commune, sector, region], formatted)) {
    city ||= 'Rancagua'
    commune ||= 'Rancagua'
  }

  if (samePlace(sector, city) || samePlace(sector, commune) || samePlace(sector, region)) {
    sector = ''
  }

  if (/^(otro|otro no aparece mi sector)$/i.test(normalized(sector))) sector = ''

  return {
    country: clean(zone.country),
    country_code: clean(zone.country_code).toUpperCase(),
    region,
    state: region,
    city,
    municipality: commune,
    commune,
    sector,
    district: sector,
    suburb: clean(zone.suburb),
    neighbourhood: clean(zone.neighbourhood),
    postcode: clean(zone.postcode),
    formatted,
  }
}

function pickGeoapifyZone(properties = {}) {
  const formatted = clean(properties.formatted)
  const region = firstText(properties.state, properties.region, properties.state_district)
  const city = firstText(properties.city, properties.town, properties.village, properties.locality)
  const commune = firstText(
    properties.municipality,
    properties.city,
    properties.town,
    properties.village,
    properties.county,
    properties.locality,
  )
  const sector = firstText(
    properties.suburb,
    properties.neighbourhood,
    properties.quarter,
    properties.district,
    properties.city_district,
  )

  return sanitizeZone({
    country: properties.country,
    country_code: properties.country_code,
    region,
    city,
    commune,
    sector,
    suburb: properties.suburb,
    neighbourhood: properties.neighbourhood,
    postcode: properties.postcode,
    formatted,
  })
}

function pickNominatimZone(data = {}) {
  const address = data.address || {}
  const formatted = clean(data.display_name)
  const region = firstText(address.state, address.region, address.state_district)
  const city = firstText(address.city, address.town, address.village, address.municipality, address.county)
  const commune = firstText(
    address.municipality,
    address.city,
    address.town,
    address.village,
    address.county,
    address.city_district,
  )
  const sector = firstText(
    address.suburb,
    address.neighbourhood,
    address.quarter,
    address.city_district,
    address.hamlet,
  )

  return sanitizeZone({
    country: address.country,
    country_code: address.country_code,
    region,
    city,
    commune,
    sector,
    suburb: address.suburb,
    neighbourhood: address.neighbourhood,
    postcode: address.postcode,
    formatted,
  })
}

function zoneHasLocation(zone) {
  return Boolean(clean(zone?.commune) || clean(zone?.city))
}

function mergeZones(primary, fallback) {
  return sanitizeZone({
    country: firstText(primary?.country, fallback?.country),
    country_code: firstText(primary?.country_code, fallback?.country_code),
    region: firstText(primary?.region, fallback?.region),
    city: firstText(primary?.city, fallback?.city, primary?.commune, fallback?.commune),
    commune: firstText(primary?.commune, fallback?.commune, primary?.city, fallback?.city),
    sector: firstText(primary?.sector, fallback?.sector),
    suburb: firstText(primary?.suburb, fallback?.suburb),
    neighbourhood: firstText(primary?.neighbourhood, fallback?.neighbourhood),
    postcode: firstText(primary?.postcode, fallback?.postcode),
    formatted: firstText(primary?.formatted, fallback?.formatted),
  })
}

async function fetchGeoapify(lat, lng, apiKey) {
  if (!apiKey) return null
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    lang: 'es',
    apiKey,
  })
  const response = await fetchWithTimeout(`${GEOAPIFY_REVERSE_ENDPOINT}?${params.toString()}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `Geoapify respondio ${response.status}`)
  const properties = data.features?.[0]?.properties
  return properties ? pickGeoapifyZone(properties) : null
}

async function fetchNominatim(lat, lng) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'es',
  })
  const response = await fetchWithTimeout(`${NOMINATIM_REVERSE_ENDPOINT}?${params.toString()}`, {
    headers: {
      'User-Agent': 'EdePrecios/1.0 (reverse geocoding fallback)',
      Accept: 'application/json',
    },
  }, 6500)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `OpenStreetMap respondio ${response.status}`)
  return data?.address ? pickNominatimZone(data) : null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!isValidCoordinate(lat, lng)) {
    return res.status(400).json({ error: 'Coordenadas invalidas.', zone: null })
  }

  const apiKey = process.env.GEOAPIFY_API_KEY
  let geoapifyZone = null
  let geoapifyError = null

  try {
    geoapifyZone = await fetchGeoapify(lat, lng, apiKey)
  } catch (error) {
    geoapifyError = error
  }

  if (zoneHasLocation(geoapifyZone)) {
    return res.status(200).json({ zone: geoapifyZone, source: 'geoapify' })
  }

  try {
    const osmZone = await fetchNominatim(lat, lng)
    const zone = mergeZones(geoapifyZone, osmZone)
    if (zoneHasLocation(zone)) {
      return res.status(200).json({
        zone,
        source: geoapifyZone ? 'geoapify+osm' : 'osm',
        warning: geoapifyError?.message || null,
      })
    }
  } catch (osmError) {
    const zone = sanitizeZone(geoapifyZone || {})
    if (zoneHasLocation(zone)) {
      return res.status(200).json({ zone, source: 'geoapify-partial', warning: osmError.message || null })
    }
    return res.status(502).json({
      error: geoapifyError?.message || osmError?.message || 'No se pudo detectar la comuna.',
      zone: null,
    })
  }

  return res.status(404).json({
    error: geoapifyError?.message || 'Los proveedores no devolvieron una ciudad o comuna.',
    zone: null,
  })
}
