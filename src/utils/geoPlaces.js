import { getDistanceMeters, isValidCoordinate } from './location'
import { normalizeName } from './normalize'

export function mapProviderType(type = '') {
  const key = normalizeName(type)
  if (key.includes('supermarket')) return 'supermercado'
  if (key.includes('wholesale')) return 'mayorista'
  if (key.includes('convenience')) return 'minimarket'
  if (key.includes('bakery')) return 'panaderia'
  if (key.includes('butcher')) return 'carniceria'
  if (key.includes('greengrocer') || key.includes('fruit') || key.includes('vegetable')) return 'verduleria'
  if (key.includes('marketplace') || key.includes('market')) return 'feria'
  if (key.includes('pharmacy') || key.includes('chemist')) return 'farmacia'
  return key || 'negocio'
}

export function placeToStore(place, provider = 'map') {
  return {
    id: `${provider}-${place.id}`,
    provider_id: place.id,
    name: place.name,
    type: mapProviderType(place.type),
    address: place.address || '',
    sector: place.sector || place.commune || '',
    latitude: Number(place.lat),
    longitude: Number(place.lng),
    provider,
    source: provider,
    is_external: true,
    is_verified: false,
  }
}

export function isDuplicatePlace(candidate, stores, maxDistanceMeters = 300) {
  const candidateName = normalizeName(candidate?.name)
  if (!candidateName) return false
  const candidateLat = candidate?.latitude ?? candidate?.lat
  const candidateLng = candidate?.longitude ?? candidate?.lng

  return stores.some(store => {
    const storeName = normalizeName(store?.name)
    if (!storeName) return false
    const sameName = candidateName === storeName
    const similarName = sameName || (candidateName.length > 5 && storeName.length > 5 && (candidateName.includes(storeName) || storeName.includes(candidateName)))
    if (!similarName) return false
    const storeLat = store?.latitude ?? store?.lat
    const storeLng = store?.longitude ?? store?.lng
    const distance = getDistanceMeters(candidateLat, candidateLng, storeLat, storeLng)
    return distance != null && distance < maxDistanceMeters
  })
}

export function dedupePlaces(localStores = [], externalPlaces = [], maxDistanceMeters = 300) {
  const combined = []
  ;[...localStores, ...externalPlaces].forEach(place => {
    const lat = place?.latitude ?? place?.lat
    const lng = place?.longitude ?? place?.lng
    if (!isValidCoordinate(lat, lng)) return
    if (!isDuplicatePlace(place, combined, maxDistanceMeters)) combined.push(place)
  })
  return combined
}
