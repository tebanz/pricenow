import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { dedupePlaces, isDuplicatePlace, placeToStore } from '../utils/geoPlaces'
import { formatDistance, getDistanceMeters, isValidCoordinate } from '../utils/location'
import { normalizeName } from '../utils/normalize'

const NEARBY_RADIUS_M = 8000
const MAX_SECTOR_DETECTION_M = 50000
const SEARCH_RADII_M = [1500, 3000, 5000]
const PROVIDER_LIMIT = 12

function hasCoords(row) {
  return isValidCoordinate(row?.latitude, row?.longitude)
}

function isOptionalSourceError(error) {
  const message = error?.message || ''
  return /source/i.test(message) && /(column|schema cache|could not find)/i.test(message)
}

function readFlexiblePoints(row) {
  const value = row?.balance ?? row?.points ?? row?.total_points ?? row?.current_points ?? 0
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

async function loadUserPoints(userId) {
  if (!userId) return 0
  const { data, error } = await supabase
    .from('user_points')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('PriceNow points unavailable:', error.message)
    return 0
  }

  return readFlexiblePoints(data)
}

export default function Home() {
  const { user, profile, isValidator } = useAuth()
  const [position, setPosition] = useState(null)
  const [locationStatus, setLocationStatus] = useState('idle')
  const [stores, setStores] = useState([])
  const [osmStores, setOsmStores] = useState([])
  const [osmStatus, setOsmStatus] = useState({ state: 'idle', radius: null })
  const [savingOsmId, setSavingOsmId] = useState(null)
  const [localMessage, setLocalMessage] = useState(null)
  const [sectors, setSectors] = useState([])
  const [stats, setStats] = useState({ today: 0, points: 0 })

  async function load() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const [storesRes, sectorsRes, todayRes, points] = await Promise.all([
      supabase
        .from('stores')
        .select('id, name, chain, type, sector, address, latitude, longitude, is_verified')
        .eq('is_active', true)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(600),
      supabase
        .from('local_sectors')
        .select('id, commune, name, latitude, longitude, radius_m')
        .eq('is_active', true)
        .limit(300),
      supabase
        .from('price_entries')
        .select('id', { count: 'exact', head: true })
        .eq('validation_status', 'approved')
        .gte('created_at', start.toISOString()),
      loadUserPoints(user?.id),
    ])

    if (storesRes.error) console.warn('PriceNow stores unavailable:', storesRes.error.message)
    if (sectorsRes.error) console.warn('PriceNow sectors unavailable:', sectorsRes.error.message)
    if (todayRes.error) console.warn('PriceNow daily stats unavailable:', todayRes.error.message)

    setStores((storesRes.data || []).filter(hasCoords))
    setSectors((sectorsRes.data || []).filter(hasCoords))
    setStats({
      today: todayRes.count || 0,
      points,
    })
  }

  useEffect(() => { load() }, [user?.id])

  async function fetchProviderNearby(origin, provider, radius) {
    const params = new URLSearchParams({
      mode: 'nearby',
      lat: String(origin.lat),
      lng: String(origin.lng),
      radius: String(radius),
      radius_m: String(radius),
      type: 'all',
      limit: String(PROVIDER_LIMIT),
    })
    const endpoint = provider === 'geoapify' ? '/api/nearby-geoapify' : '/api/nearby-osm'
    const response = await fetch(`${endpoint}?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `No se pudo consultar ${provider}.`)

    return (data.places || [])
      .filter(place => isValidCoordinate(place.lat, place.lng))
      .filter(place => place.distance_m == null || Number(place.distance_m) <= radius + 50)
      .filter(place => place.distance_km == null || Number(place.distance_km) * 1000 <= radius + 50)
      .map(place => placeToStore(place, provider))
  }

  async function fetchMapNearby(origin) {
    setOsmStatus({ state: 'loading', radius: null })
    setOsmStores([])

    let lastError = null
    for (const provider of ['geoapify', 'osm']) {
      for (const radius of SEARCH_RADII_M) {
        try {
          const places = await fetchProviderNearby(origin, provider, radius)
          if (places.length > 0) {
            setOsmStores(places)
            setOsmStatus({ state: 'ok', radius, provider })
            return
          }
        } catch (err) {
          lastError = err
          console.error(`PriceNow ${provider} nearby search failed:`, err)
        }
      }
    }

    setOsmStatus({ state: lastError ? 'error' : 'empty', radius: SEARCH_RADII_M[SEARCH_RADII_M.length - 1], provider: null })
  }

  function askLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('error')
      return
    }
    setLocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      current => {
        const nextPosition = {
          lat: Number(current.coords.latitude),
          lng: Number(current.coords.longitude),
          accuracy: Math.round(current.coords.accuracy || 0),
        }
        setPosition(nextPosition)
        setLocationStatus('ok')
        fetchMapNearby(nextPosition)
      },
      () => setLocationStatus('error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  async function insertStore(payload) {
    let nextPayload = { ...payload }
    let result = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await supabase.from('stores').insert(nextPayload).select('id').single()
      if (!result.error) return result

      const message = result.error.message || ''
      if (nextPayload.source && isOptionalSourceError(result.error)) {
        const { source, ...fallbackPayload } = nextPayload
        nextPayload = fallbackPayload
        continue
      }
      if (nextPayload.location_source && /location_source/i.test(message) && /(column|schema cache|could not find)/i.test(message)) {
        const { location_source, ...fallbackPayload } = nextPayload
        nextPayload = fallbackPayload
        continue
      }
      return result
    }

    return result
  }

  async function saveOsmStore(store) {
    if (isDuplicatePlace(store, stores)) {
      setLocalMessage({ type: 'error', text: 'Ese negocio parece estar duplicado en PriceNow.' })
      return
    }

    setSavingOsmId(store.id)
    setLocalMessage(null)
    const payload = {
      name: store.name.trim(),
      normalized_name: normalizeName(store.name),
      chain: null,
      type: store.type || 'negocio',
      sector: store.sector || 'Sin sector',
      sector_id: null,
      address: store.address || null,
      latitude: Number(store.latitude),
      longitude: Number(store.longitude),
      source: store.provider || store.source || 'geoapify',
      location_source: store.provider || store.source || 'geoapify',
      is_verified: false,
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    const result = await insertStore(payload)
    if (!result.error && result.data?.id) {
      await supabase
        .from('store_aliases')
        .insert({ store_id: result.data.id, alias: payload.name, alias_key: normalizeName(payload.name), created_by: user?.id || null })
        .then(() => {})
    }

    setSavingOsmId(null)
    if (result.error) {
      setLocalMessage({ type: 'error', text: result.error.message })
      return
    }

    setLocalMessage({ type: 'ok', text: `${store.name} guardado en PriceNow.` })
    setOsmStores(prev => prev.filter(item => item.id !== store.id))
    await load()
  }

  const supabaseNearbyStores = useMemo(() => {
    if (!position) return []
    return stores
      .map(store => ({
        ...store,
        source_label: 'Verificado PriceNow',
        source_kind: 'pricenow',
        distance_m: getDistanceMeters(position.lat, position.lng, store.latitude, store.longitude),
      }))
      .filter(store => store.distance_m != null && store.distance_m <= NEARBY_RADIUS_M)
      .sort((a, b) => Number(Boolean(b.is_verified)) - Number(Boolean(a.is_verified)) || a.distance_m - b.distance_m)
  }, [stores, position])

  const osmNearbyStores = useMemo(() => {
    if (!position) return []
    return osmStores
      .map(store => ({
        ...store,
        source_label: 'Detectado por mapa',
        source_kind: store.provider || 'map',
        distance_m: getDistanceMeters(position.lat, position.lng, store.latitude, store.longitude),
      }))
      .filter(store => store.distance_m != null && store.distance_m <= SEARCH_RADII_M[SEARCH_RADII_M.length - 1])
      .sort((a, b) => a.distance_m - b.distance_m)
  }, [osmStores, position])

  const nearbyStores = useMemo(() => {
    const combined = dedupePlaces(supabaseNearbyStores, osmNearbyStores)
    return combined
      .sort((a, b) => {
        const priorityA = a.source_kind === 'pricenow' ? (a.is_verified ? 0 : 1) : 2
        const priorityB = b.source_kind === 'pricenow' ? (b.is_verified ? 0 : 1) : 2
        return priorityA - priorityB || a.distance_m - b.distance_m
      })
      .slice(0, 3)
  }, [supabaseNearbyStores, osmNearbyStores])

  const nearestSector = useMemo(() => {
    if (!position) return null
    return sectors
      .map(sector => ({ ...sector, distance_m: getDistanceMeters(position.lat, position.lng, sector.latitude, sector.longitude) }))
      .filter(sector => sector.distance_m != null)
      .sort((a, b) => a.distance_m - b.distance_m)[0] || null
  }, [sectors, position])

  const sectorDetection = useMemo(() => {
    if (!position || !nearestSector) return null
    if (nearestSector.distance_m > MAX_SECTOR_DETECTION_M) {
      return {
        type: 'warning',
        text: 'No pudimos detectar tu sector con precision. Puedes elegirlo manualmente o pedir a un admin que configure la zona.',
      }
    }
    return {
      type: 'ok',
      name: nearestSector.name,
      distance: formatDistance(nearestSector.distance_m),
    }
  }, [nearestSector, position])

  return (
    <div className="space-y-5 pb-32">
      <section className="relative overflow-hidden rounded-b-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 px-5 pb-7 pt-7 text-white shadow-xl">
        <div className="relative">
          <p className="text-sm font-semibold text-white/75">Hola, {profile?.username || 'usuario'}</p>
          <h1 className="mt-2 max-w-sm text-3xl font-black leading-tight">Precios reales cerca de ti</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">Reporta un precio o revisa lo que la comunidad ya valido en tu zona.</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link to="/add" className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-blue-700 shadow-sm">Reportar precio</Link>
            <Link to="/ranking" className="rounded-2xl bg-white/10 px-4 py-3 text-center text-sm font-black text-white ring-1 ring-white/20">Ver precios</Link>
          </div>
        </div>
      </section>

      <section className="mx-4 rounded-[1.75rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Ubicacion</h2>
            <p className="mt-1 text-sm text-slate-500">Usamos tu posicion solo para ordenar negocios con coordenadas reales.</p>
          </div>
          <button onClick={askLocation} disabled={locationStatus === 'loading'} className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white active:scale-95 disabled:opacity-50">
            {locationStatus === 'loading' ? 'Buscando...' : 'Usar ubicacion'}
          </button>
        </div>

        {locationStatus === 'ok' && (
          <p className="mt-3 text-sm font-bold text-blue-600">
            Ubicacion activada{position?.accuracy ? `, precision aprox. ${position.accuracy} m` : ''}.
          </p>
        )}
        {localMessage && <p className={`mt-3 rounded-2xl px-3 py-2 text-sm font-semibold ${localMessage.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{localMessage.text}</p>}
        {locationStatus === 'error' && <p className="mt-3 text-sm font-bold text-red-600">No se pudo obtener ubicacion. Puedes seguir usando PriceNow sin compartirla.</p>}
        {sectorDetection?.type === 'ok' && <p className="mt-3 rounded-2xl bg-blue-50 px-3 py-2 text-sm text-blue-700">Sector probable: <b>{sectorDetection.name}</b>.</p>}
        {sectorDetection?.type === 'warning' && <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{sectorDetection.text}</p>}

        {!position && (
          <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            Activa ubicacion para ver negocios cercanos. Los negocios sin coordenadas validas no aparecen como cercanos.
          </p>
        )}

        {position && osmStatus.state === 'loading' && (
          <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">
            Buscando negocios cercanos en el mapa...
          </p>
        )}

        {position && osmStatus.state !== 'loading' && nearbyStores.length === 0 && (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            No encontramos negocios cercanos todavía. Intenta ampliar el radio o vuelve más tarde.
            {isValidator && <Link to="/local-map" className="mt-2 block font-black text-blue-600">Agregar negocios desde el mapa local</Link>}
          </div>
        )}

        {nearbyStores.length > 0 && (
          <div className="mt-3 space-y-2">
            {nearbyStores.map(store => (
              <div key={store.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{store.name}</p>
                    <p className="truncate text-xs text-slate-500">{store.type || store.chain || 'negocio'} - {store.source_label}</p>
                    <p className="mt-1 text-xs font-black text-blue-600">{formatDistance(store.distance_m)}</p>
                  </div>
                  {isValidator && store.source_kind !== 'pricenow' && (
                    <button
                      type="button"
                      onClick={() => saveOsmStore(store)}
                      disabled={savingOsmId === store.id}
                      className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      {savingOsmId === store.id ? 'Guardando...' : 'Guardar en PriceNow'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mx-4 rounded-[1.75rem] border border-slate-100 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Resumen</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Hoy hay <b className="text-slate-900">{stats.today}</b> precios aprobados. Tienes <b className="text-slate-900">{stats.points || 0}</b> puntos disponibles.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-black text-blue-600">Ver mas herramientas</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/benefits" className="rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm font-black text-slate-600">Beneficios<br /><span className="text-[10px] text-slate-400">Proximamente</span></Link>
            {isValidator && <Link to="/quality" className="rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Calidad</Link>}
            {isValidator && <Link to="/local-map" className="rounded-2xl bg-blue-50 px-4 py-3 text-center text-sm font-black text-blue-700">Mapa local</Link>}
            {isValidator && <Link to="/validate" className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-sm font-black text-amber-700">Validar</Link>}
          </div>
        </details>
      </section>

      <section className="mx-4 rounded-[1.5rem] border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-500">Parte de KairosNow</p>
            <p className="mt-1 text-sm text-slate-600">Herramientas para precios, negocios, finanzas y comunidad local.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">PriceNow activo</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-black">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">PriceNow<br /><span className="font-semibold">Activo</span></div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-500">LedgerNow<br /><span className="font-semibold">Proximamente</span></div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-500">WalleNow<br /><span className="font-semibold">Proximamente</span></div>
        </div>
      </section>
    </div>
  )
}
