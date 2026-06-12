import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const NEARBY_RADIUS_M = 8000
const MAX_SECTOR_DETECTION_M = 50000

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

function formatDistance(meters) {
  if (meters == null) return 'Sin distancia'
  if (meters < 1000) return `${meters} m`
  return `${(meters / 1000).toFixed(1).replace('.0', '')} km`
}

function hasCoords(row) {
  return isValidCoordinate(row?.latitude, row?.longitude)
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

  useEffect(() => {
    if (!navigator.permissions || !navigator.geolocation) return
    navigator.permissions.query({ name: 'geolocation' }).then(permission => {
      if (permission.state === 'granted' && locationStatus === 'idle') askLocation()
    }).catch(() => {})
  }, [locationStatus])

  function askLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('error')
      return
    }
    setLocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      current => {
        setPosition({
          lat: Number(current.coords.latitude),
          lng: Number(current.coords.longitude),
          accuracy: Math.round(current.coords.accuracy || 0),
        })
        setLocationStatus('ok')
      },
      () => setLocationStatus('error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  const nearbyStores = useMemo(() => {
    if (!position) return []
    return stores
      .map(store => ({ ...store, distance_m: distanceMeters(position, { lat: store.latitude, lng: store.longitude }) }))
      .filter(store => store.distance_m != null && store.distance_m <= NEARBY_RADIUS_M)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 6)
  }, [stores, position])

  const nearestSector = useMemo(() => {
    if (!position) return null
    return sectors
      .map(sector => ({ ...sector, distance_m: distanceMeters(position, { lat: sector.latitude, lng: sector.longitude }) }))
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
        {locationStatus === 'error' && <p className="mt-3 text-sm font-bold text-red-600">No se pudo obtener ubicacion. Puedes seguir usando PriceNow sin compartirla.</p>}
        {sectorDetection?.type === 'ok' && <p className="mt-3 rounded-2xl bg-blue-50 px-3 py-2 text-sm text-blue-700">Sector probable: <b>{sectorDetection.name}</b>.</p>}
        {sectorDetection?.type === 'warning' && <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{sectorDetection.text}</p>}

        {!position && (
          <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            Activa ubicacion para ver negocios cercanos. Los negocios sin coordenadas validas no aparecen como cercanos.
          </p>
        )}

        {position && nearbyStores.length === 0 && (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            Aun no hay negocios con coordenadas reales cerca de esta ubicacion.
            {isValidator && <Link to="/local-map" className="mt-2 block font-black text-blue-600">Agregar negocios desde el mapa local</Link>}
          </div>
        )}

        {nearbyStores.length > 0 && (
          <details className="mt-3 rounded-2xl bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-slate-800">
              {nearbyStores.length} negocios cercanos con coordenadas
            </summary>
            <div className="mt-3 space-y-2">
              {nearbyStores.slice(0, 4).map(store => (
                <div key={store.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{store.name}</p>
                    <p className="truncate text-xs text-slate-500">{store.sector || 'Sin sector'} · {store.type || store.chain || 'negocio'}</p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-blue-600">{formatDistance(store.distance_m)}</span>
                </div>
              ))}
            </div>
          </details>
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
