import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCLP, formatUnitPrice } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

const MAP_RADIUS_KM = 5

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

function formatDistanceKm(km) {
  if (km == null || Number.isNaN(Number(km))) return 'distancia no disponible'
  const meters = Math.round(Number(km) * 1000)
  if (meters < 1000) return `${meters} m`
  if (meters < 10000) return `${Number(km).toFixed(1).replace('.0', '')} km`
  return `${Math.round(Number(km))} km`
}

function normalizeText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function comparableUnit(unit) {
  if (unit === 'g') return 'kg'
  if (unit === 'ml') return 'litro'
  return unit || 'unidad'
}

function getLinkedProduct(row) {
  return Array.isArray(row.products) ? row.products[0] : row.products
}

function getProductName(row) {
  const product = getLinkedProduct(row)
  return product?.name || row.product_name || 'Producto'
}

function getStandardUnit(row) {
  const product = getLinkedProduct(row)
  return comparableUnit(product?.default_unit || row.unit || 'unidad')
}

function markerIcon(place) {
  const text = normalizeText(`${place.name} ${place.type || ''} ${place.chain || ''}`)
  if (text.includes('panader')) return '🥖'
  if (text.includes('carnicer')) return '🥩'
  if (text.includes('verduler') || text.includes('fruta')) return '🥬'
  if (text.includes('super') || text.includes('lider') || text.includes('jumbo') || text.includes('santa isabel') || text.includes('unimarc') || text.includes('acuenta')) return '🛒'
  return '🏪'
}

function openMapUrl(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}

function markerPosition(origin, place) {
  if (!origin || place.lat == null || place.lng == null) return { left: '50%', top: '50%' }

  const latKm = (Number(place.lat) - Number(origin.lat)) * 111
  const lngKm = (Number(place.lng) - Number(origin.lng)) * 111 * Math.cos(Number(origin.lat) * Math.PI / 180)

  const left = Math.max(6, Math.min(94, 50 + (lngKm / MAP_RADIUS_KM) * 42))
  const top = Math.max(6, Math.min(94, 50 - (latKm / MAP_RADIUS_KM) * 42))

  return { left: `${left}%`, top: `${top}%` }
}

function makeStoreKey(name, sector, lat, lng) {
  return `${normalizeText(name)}__${normalizeText(sector)}__${Number(lat || 0).toFixed(4)}__${Number(lng || 0).toFixed(4)}`
}

function buildNearbyPlaces(location, stores, approvedEntries) {
  if (!location) return []

  const places = new Map()

  stores.forEach(store => {
    if (store.latitude == null || store.longitude == null) return
    const lat = Number(store.latitude)
    const lng = Number(store.longitude)
    const km = distanceKm(location, { lat, lng })
    if (km == null || km > 20) return

    const key = makeStoreKey(store.name, store.sector, lat, lng)
    places.set(key, {
      id: key,
      name: store.name,
      chain: store.chain || '',
      type: store.chain || 'Tienda conocida',
      sector: store.sector || '',
      address: store.address || '',
      lat,
      lng,
      distance_km: km,
      source: 'store',
      prices: [],
    })
  })

  approvedEntries.forEach(entry => {
    if (entry.purchase_latitude == null || entry.purchase_longitude == null || !entry.store_name) return
    const lat = Number(entry.purchase_latitude)
    const lng = Number(entry.purchase_longitude)
    const km = distanceKm(location, { lat, lng })
    if (km == null || km > 20) return

    const key = makeStoreKey(entry.store_name, entry.sector, lat, lng)
    if (!places.has(key)) {
      places.set(key, {
        id: key,
        name: entry.store_name,
        chain: '',
        type: 'Reportado en PriceNow',
        sector: entry.sector || '',
        address: entry.sector || '',
        lat,
        lng,
        distance_km: km,
        source: 'report',
        prices: [],
      })
    }

    const place = places.get(key)
    const unitPrice = Number(entry.unit_price)
    if (Number.isFinite(unitPrice) && unitPrice > 0) {
      place.prices.push({
        id: entry.id,
        product_name: getProductName(entry),
        unit: getStandardUnit(entry),
        unit_price: unitPrice,
        price: Number(entry.price),
        purchase_date: entry.purchase_date,
      })
    }
  })

  return Array.from(places.values())
    .map(place => ({
      ...place,
      best_price: place.prices.length
        ? place.prices.slice().sort((a, b) => a.unit_price - b.unit_price)[0]
        : null,
    }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 12)
}

export default function Home() {
  const { user, profile } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [stores, setStores] = useState([])
  const [approvedEntries, setApprovedEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('idle')
  const [locationError, setLocationError] = useState(null)

  useEffect(() => {
    async function load() {
      const [statsRes, recentRes, storesRes, entriesRes] = await Promise.all([
        supabase
          .from('price_entries')
          .select('id, validation_status', { count: 'exact' })
          .eq('user_id', user.id),
        supabase
          .from('price_entries')
          .select('id, product_name, brand, price, unit, store_name, purchase_date, validation_status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('stores')
          .select('id, name, chain, sector, address, latitude, longitude, is_active')
          .eq('is_active', true)
          .limit(500),
        supabase
          .from('price_entries')
          .select(`
            id,
            product_id,
            product_name,
            brand,
            unit,
            price,
            unit_price,
            store_name,
            sector,
            purchase_date,
            purchase_latitude,
            purchase_longitude,
            products(id, name, category, default_unit)
          `)
          .eq('validation_status', 'approved')
          .not('purchase_latitude', 'is', null)
          .not('purchase_longitude', 'is', null)
          .order('purchase_date', { ascending: false })
          .limit(700),
      ])

      if (statsRes.data) {
        const all = statsRes.data
        const approved = all.filter(r => r.validation_status === 'approved').length
        const pending = all.filter(r => r.validation_status === 'pending').length
        setStats({ total: all.length, approved, pending })
      }

      if (recentRes.data) setRecent(recentRes.data)
      if (storesRes.data) setStores(storesRes.data)
      if (entriesRes.data) setApprovedEntries(entriesRes.data)
      setLoading(false)
    }

    load()
  }, [user.id])

  useEffect(() => {
    const alreadyAsked = sessionStorage.getItem('pricenow_home_location_prompt')
    if (!alreadyAsked) {
      sessionStorage.setItem('pricenow_home_location_prompt', '1')
      requestLocation(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nearbyPlaces = useMemo(
    () => buildNearbyPlaces(location, stores, approvedEntries),
    [location, stores, approvedEntries]
  )

  const nearbyHighlights = nearbyPlaces
    .flatMap(place => (place.prices || []).map(price => ({ ...price, place })))
    .sort((a, b) => a.unit_price - b.unit_price)
    .slice(0, 4)

  function requestLocation(silent = false) {
    setLocationError(null)

    if (!navigator.geolocation) {
      setLocationStatus('error')
      setLocationError('Tu navegador no permite obtener ubicación.')
      return
    }

    setLocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
          accuracy: Math.round(position.coords.accuracy || 0),
        })
        setLocationStatus('ready')
      },
      () => {
        setLocationStatus('denied')
        if (!silent) setLocationError('No se pudo obtener la ubicación. Puedes permitirla desde el navegador o usar la app sin mapa cercano.')
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    )
  }

  const statusBadge = (status) => {
    const map = {
      pending: <span className="badge-pending">Pendiente</span>,
      approved: <span className="badge-approved">Aprobado</span>,
      rejected: <span className="badge-rejected">Rechazado</span>,
    }
    return map[status] ?? null
  }

  if (loading) return <Spinner />

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Hola, {profile?.username} 👋
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Tus aportes ayudan a comparar precios reales en Rancagua.
        </p>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-bold text-slate-900">Mapa cerca de ti</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tiendas y precios aprobados con ubicación exacta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestLocation(false)}
            disabled={locationStatus === 'loading'}
            className="text-xs bg-brand-500 text-white font-semibold px-3 py-2 rounded-xl active:scale-95 transition-transform disabled:opacity-60"
          >
            {locationStatus === 'loading' ? 'Ubicando…' : location ? 'Actualizar' : 'Permitir ubicación'}
          </button>
        </div>

        <div className="relative h-56 rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-50 via-sky-50 to-slate-100 border border-slate-200">
          <div className="absolute inset-0 opacity-50" style={{
            backgroundImage: 'linear-gradient(to right, rgba(100,116,139,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,.18) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }} />
          <div className="absolute left-1/2 top-1/2 w-36 h-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-300/50" />
          <div className="absolute left-1/2 top-1/2 w-52 h-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-200/50" />

          {location ? (
            <>
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-lg ring-4 ring-white font-bold">
                  Tú
                </div>
              </div>

              {nearbyPlaces.slice(0, 10).map(place => {
                const pos = markerPosition(location, place)
                return (
                  <a
                    key={place.id}
                    href={openMapUrl(place.lat, place.lng)}
                    target="_blank"
                    rel="noreferrer"
                    title={`${place.name} · ${formatDistanceKm(place.distance_km)}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center text-lg active:scale-95"
                    style={pos}
                  >
                    {markerIcon(place)}
                  </a>
                )
              })}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-5 text-center">
              <div>
                <p className="text-3xl mb-2">📍</p>
                <p className="text-sm font-semibold text-slate-700">Activa tu ubicación para ver negocios cercanos.</p>
                <p className="text-xs text-slate-500 mt-1">La app seguirá funcionando aunque no des permiso.</p>
              </div>
            </div>
          )}
        </div>

        {location && (
          <p className="text-[11px] text-slate-400 mt-2">
            Precisión aproximada: {location.accuracy ? `${location.accuracy} m` : 'no disponible'} · radio visual: {MAP_RADIUS_KM} km.
          </p>
        )}

        {locationError && <p className="text-xs text-danger-600 mt-2">{locationError}</p>}

        {location && nearbyPlaces.length === 0 && (
          <p className="text-sm text-slate-500 mt-3">
            Aún no hay negocios cercanos con coordenadas guardadas. Registra una compra con ubicación exacta y, cuando se apruebe, aparecerá aquí.
          </p>
        )}

        {nearbyPlaces.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-700">Negocios cercanos</h4>
              <span className="text-xs text-slate-400">{nearbyPlaces.length} encontrados</span>
            </div>
            {nearbyPlaces.slice(0, 4).map(place => (
              <a
                key={place.id}
                href={openMapUrl(place.lat, place.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0">
                    {markerIcon(place)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{place.name}</p>
                    <p className="text-xs text-slate-400 truncate">{place.sector || place.address || place.type}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-brand-600 shrink-0">{formatDistanceKm(place.distance_km)}</span>
              </a>
            ))}
          </div>
        )}

        {nearbyHighlights.length > 0 && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-semibold text-slate-700">Precios destacados cerca</h4>
            {nearbyHighlights.map(item => (
              <div key={`${item.id}-${item.place.id}`} className="rounded-xl border border-success-100 bg-success-50/40 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.product_name}</p>
                    <p className="text-xs text-slate-500 truncate">{item.place.name} · {formatDistanceKm(item.place.distance_km)}</p>
                  </div>
                  <span className="text-sm font-bold text-success-600 shrink-0">
                    {formatUnitPrice(item.unit_price, item.unit)}
                  </span>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-400">
              Estos avisos salen de reportes aprobados; no son descuentos comerciales confirmados por el negocio.
            </p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: stats?.total ?? 0, color: 'text-brand-500' },
          { label: 'Aprobados', value: stats?.approved ?? 0, color: 'text-success-500' },
          { label: 'Pendientes', value: stats?.pending ?? 0, color: 'text-warning-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <Link to="/add" className="block">
        <div className="bg-brand-500 text-white rounded-2xl p-5 flex items-center justify-between shadow-md active:scale-98 transition-transform">
          <div>
            <p className="font-bold text-base">Ingresar precio</p>
            <p className="text-white/70 text-xs mt-0.5">Comparte lo que pagaste hoy</p>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl">
            ＋
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/ranking" className="card flex items-center gap-3 active:scale-95 transition-transform">
          <div className="w-10 h-10 bg-success-50 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 fill-success-500" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Ranking</p>
            <p className="text-xs text-slate-400">Por unidad estándar</p>
          </div>
        </Link>

        <Link to="/report" className="card flex items-center gap-3 active:scale-95 transition-transform">
          <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 fill-brand-500" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Reporte</p>
            <p className="text-xs text-slate-400">Promedios y variación</p>
          </div>
        </Link>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tus últimos ingresos</h3>
        {recent.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-3xl mb-2">🛒</p>
            <p className="text-sm text-slate-500">Aún no has ingresado precios.</p>
            <Link to="/add" className="text-brand-500 text-sm font-semibold mt-2 block">
              Ingresa tu primera compra →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map(entry => (
              <div key={entry.id} className="card flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">
                    {entry.product_name}
                    {entry.brand && <span className="text-slate-400 font-normal"> · {entry.brand}</span>}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{entry.store_name}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-bold text-brand-500">{formatCLP(entry.price)}</span>
                  {statusBadge(entry.validation_status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
