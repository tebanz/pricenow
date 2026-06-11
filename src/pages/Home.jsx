import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function money(value) {
  return Number(value || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function distanceMeters(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null
  const R = 6371000
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function formatDistance(meters) {
  if (meters == null) return 'Sin distancia'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function Card({ children, className = '' }) {
  return <section className={`rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm ${className}`}>{children}</section>
}

export default function Home() {
  const { user, profile, isValidator } = useAuth()
  const [entries, setEntries] = useState([])
  const [stores, setStores] = useState([])
  const [wallet, setWallet] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [location, setLocation] = useState(null)
  const [locationMessage, setLocationMessage] = useState('')

  async function load() {
    setLoading(true)
    const [entriesRes, storesRes, walletRes, alertsRes] = await Promise.all([
      supabase
        .from('price_entries')
        .select('id, product_name, store_name, sector, unit_price, price, created_at, purchase_date, store_id, product_id, stores(id, name, sector, latitude, longitude), products(id, name, default_unit, category)')
        .eq('validation_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(250),
      supabase.from('stores').select('id, name, sector, address, latitude, longitude, chain').eq('is_active', true).limit(250),
      supabase.from('user_points').select('*').eq('user_id', user?.id).maybeSingle(),
      supabase.from('price_alerts').select('*, products(name, default_unit)').eq('user_id', user?.id).eq('is_active', true).limit(20),
    ])
    setEntries(entriesRes.data || [])
    setStores(storesRes.data || [])
    setWallet(walletRes.data || null)
    setAlerts(alertsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.id])

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationMessage('Tu navegador no permite ubicación.')
      return
    }
    setLocationMessage('Solicitando ubicación...')
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
        setLocationMessage('Ubicación activada para mostrar datos cercanos.')
      },
      () => setLocationMessage('No se pudo obtener ubicación. Puedes usar la app igual.'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  }

  const nearbyStores = useMemo(() => {
    const withDistance = stores
      .map(store => ({
        ...store,
        distance: distanceMeters(location, { lat: Number(store.latitude), lng: Number(store.longitude) }),
      }))
      .filter(store => store.distance != null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
    return withDistance
  }, [stores, location])

  const bestPrices = useMemo(() => {
    const latestByProduct = new Map()
    for (const entry of entries) {
      const key = entry.product_id || entry.product_name
      const current = latestByProduct.get(key)
      const unitPrice = Number(entry.unit_price || entry.price || 0)
      if (!current || unitPrice < Number(current.unit_price || current.price || 0)) latestByProduct.set(key, entry)
    }
    return [...latestByProduct.values()].slice(0, 5)
  }, [entries])

  const opportunities = useMemo(() => {
    return alerts.map(alert => {
      const match = entries.find(entry => {
        if (alert.product_id && entry.product_id !== alert.product_id) return false
        if (alert.sector && entry.sector !== alert.sector) return false
        return Number(entry.unit_price || 0) <= Number(alert.target_unit_price)
      })
      return { alert, match }
    }).filter(item => item.match).slice(0, 3)
  }, [alerts, entries])

  const approvedToday = entries.filter(entry => new Date(entry.created_at).toDateString() === new Date().toDateString()).length
  const firstName = profile?.full_name?.split(' ')[0] || profile?.username || user?.email?.split('@')[0] || 'usuario'

  return (
    <div className="space-y-5 pb-28">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-blue-100">Hola, {firstName}</p>
            <h1 className="mt-1 text-2xl font-black leading-tight">Precios reales cerca de ti</h1>
            <p className="mt-2 text-sm text-blue-50">Compara, reporta y gana beneficios colaborando con la comunidad.</p>
          </div>
          <div className="rounded-3xl bg-white/10 p-3 text-center backdrop-blur">
            <p className="text-xl font-black">{wallet?.balance ?? 0}</p>
            <p className="text-[11px] text-blue-100">puntos</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Link to="/add" className="rounded-2xl bg-white px-3 py-3 text-xs font-black text-blue-700 shadow-sm">Reportar</Link>
          <Link to="/ranking" className="rounded-2xl bg-white/10 px-3 py-3 text-xs font-black text-white ring-1 ring-white/20">Precios</Link>
          <Link to="/profile?tab=beneficios" className="rounded-2xl bg-white/10 px-3 py-3 text-xs font-black text-white ring-1 ring-white/20">Beneficios</Link>
        </div>
      </section>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Tu zona</h2>
            <p className="mt-1 text-sm text-slate-500">Activa ubicación para priorizar negocios y precios cercanos.</p>
            {locationMessage && <p className="mt-2 text-xs font-semibold text-blue-600">{locationMessage}</p>}
          </div>
          <button onClick={requestLocation} className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold text-white">Usar ubicación</button>
        </div>
        <div className="mt-4 grid gap-2">
          {nearbyStores.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Aún no hay tiendas cercanas con coordenadas. Los reportes aprobados seguirán mejorando esta zona.</p>}
          {nearbyStores.map(store => (
            <div key={store.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
              <div>
                <p className="text-sm font-black text-slate-800">{store.name}</p>
                <p className="text-xs text-slate-500">{store.sector || 'Sin sector'}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">{formatDistance(store.distance)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Hoy</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{approvedToday}</p>
          <p className="text-xs text-slate-500">precios aprobados</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Meta sugerida</p>
          <p className="mt-1 text-2xl font-black text-slate-900">+15</p>
          <p className="text-xs text-slate-500">puntos por reportar hoy</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-black text-slate-900">Mejores precios recientes</h2>
          <Link to="/ranking" className="text-xs font-bold text-blue-600">Ver todo</Link>
        </div>
        <div className="mt-4 space-y-2">
          {bestPrices.length === 0 && <p className="text-sm text-slate-500">Aún no hay precios aprobados.</p>}
          {bestPrices.map(entry => (
            <div key={entry.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
              <div>
                <p className="text-sm font-black text-slate-800">{entry.products?.name || entry.product_name}</p>
                <p className="text-xs text-slate-500">{entry.store_name} · {entry.sector}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-emerald-600">{money(entry.unit_price || entry.price)}</p>
                <p className="text-[11px] text-slate-400">por {entry.products?.default_unit || 'unidad'}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {opportunities.length > 0 && (
        <Card className="border-emerald-100 bg-emerald-50/50">
          <h2 className="font-black text-emerald-900">Alertas que se cumplieron</h2>
          <div className="mt-3 space-y-2">
            {opportunities.map(({ alert, match }) => (
              <div key={alert.id} className="rounded-2xl bg-white p-3 text-sm text-emerald-800">
                {match.product_name} está a {money(match.unit_price)} en {match.store_name}.
              </div>
            ))}
          </div>
        </Card>
      )}

      {isValidator && (
        <Card>
          <h2 className="font-black text-slate-900">Herramientas admin</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/quality" className="rounded-2xl bg-slate-950 px-3 py-3 text-center text-xs font-bold text-white">Calidad de datos</Link>
            <Link to="/partners" className="rounded-2xl bg-blue-50 px-3 py-3 text-center text-xs font-bold text-blue-700">Negocios asociados</Link>
          </div>
        </Card>
      )}
    </div>
  )
}
