export function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  if (!isValidCoordinate(lat1, lng1) || !isValidCoordinate(lat2, lng2)) return null
  const R = 6371000
  const toRad = value => Number(value) * Math.PI / 180
  const dLat = toRad(Number(lat2) - Number(lat1))
  const dLng = toRad(Number(lng2) - Number(lng1))
  const startLat = toRad(lat1)
  const endLat = toRad(lat2)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export function formatDistance(meters) {
  if (meters == null) return 'Sin distancia'
  if (meters < 1000) return `${meters} m`
  return `${(meters / 1000).toFixed(1).replace('.0', '')} km`
}

export const PRICE_NOW_ZONE_KEY = 'pricenow_current_zone'
export const PRICE_NOW_ZONE_EVENT = 'pricenow-zone-change'

export function zoneDisplayName(zone) {
  return zone?.commune || zone?.municipality || zone?.city || zone?.region || 'Chile'
}

export function zoneSubtitle(zone) {
  const commune = zoneDisplayName(zone)
  const region = zone?.region || zone?.state
  if (commune && region && commune !== region) return `${commune}, ${region}`
  return commune
}

export function normalizeZoneName(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function zoneCommune(zone = {}) {
  return zone?.commune || zone?.municipality || zone?.city || ''
}

export function isManualPreferredZone(zone = {}) {
  return Boolean(zone?.is_preferred && (zone?.source === 'manual' || zone?.preference_source === 'manual'))
}

export function getStoredZone() {
  try {
    const raw = localStorage.getItem(PRICE_NOW_ZONE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setStoredZone(zone) {
  if (!zone) return null
  const next = {
    ...zone,
    is_preferred: zone.is_preferred ?? true,
    confirmed: zone.confirmed ?? true,
    updated_at: new Date().toISOString(),
  }
  localStorage.setItem(PRICE_NOW_ZONE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(PRICE_NOW_ZONE_EVENT, { detail: next }))
  return next
}

export async function reverseGeocode(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return null
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  const response = await fetch(`/api/reverse-geocode?${params.toString()}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'No se pudo detectar la comuna.')
  return data.zone || null
}

export function rowCommune(row = {}) {
  return row.commune || row.city || row.sector || ''
}

export function sameCommune(a = '', b = '') {
  return normalizeZoneName(a) && normalizeZoneName(a) === normalizeZoneName(b)
}
