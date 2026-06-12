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
