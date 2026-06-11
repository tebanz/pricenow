import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STORE_TYPES = ['supermercado', 'minimarket', 'almacen', 'panaderia', 'carniceria', 'verduleria', 'feria', 'mayorista', 'otro']

const EMPTY_STORE = { name: '', chain: '', type: 'supermercado', commune: 'Rancagua', sector: '', address: '', latitude: '', longitude: '', is_verified: true }
const EMPTY_SECTOR = { commune: 'Rancagua', name: '', latitude: '', longitude: '', radius_m: 900 }

function normalize(text = '') {
  return text.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function distanceMeters(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null
  const R = 6371000
  const toRad = value => Number(value) * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

function formatDistance(meters) {
  if (meters == null) return 'Sin distancia'
  if (meters < 1000) return `${meters} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function FieldHint({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>
}

export default function LocalMapAdmin() {
  const { user, isValidator } = useAuth()
  const [stores, setStores] = useState([])
  const [sectors, setSectors] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [position, setPosition] = useState(null)
  const [storeForm, setStoreForm] = useState(EMPTY_STORE)
  const [sectorForm, setSectorForm] = useState(EMPTY_SECTOR)
  const [editingStoreId, setEditingStoreId] = useState(null)

  async function load() {
    setLoading(true)
    const [storesRes, sectorsRes] = await Promise.all([
      supabase.from('stores').select('*').order('name', { ascending: true }).limit(800),
      supabase.from('local_sectors').select('*').order('commune').order('name').limit(400),
    ])
    if (storesRes.error || sectorsRes.error) setMessage({ type: 'error', text: storesRes.error?.message || sectorsRes.error?.message })
    setStores(storesRes.data || [])
    setSectors(sectorsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filteredStores = useMemo(() => {
    const q = normalize(query)
    return stores.filter(store => !q || normalize(`${store.name} ${store.chain} ${store.sector} ${store.address} ${store.type}`).includes(q)).slice(0, 120)
  }, [stores, query])

  const nearbyStores = useMemo(() => {
    if (!position) return []
    return stores
      .map(store => ({ ...store, distance_m: distanceMeters(position, { lat: store.latitude, lng: store.longitude }) }))
      .filter(store => store.distance_m != null)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 12)
  }, [stores, position])

  const nearestSector = useMemo(() => {
    if (!position) return null
    return sectors
      .map(sector => ({ ...sector, distance_m: distanceMeters(position, { lat: sector.latitude, lng: sector.longitude }) }))
      .filter(sector => sector.distance_m != null)
      .sort((a, b) => a.distance_m - b.distance_m)[0] || null
  }, [sectors, position])

  function useCurrentLocation(target = 'store') {
    if (!navigator.geolocation) return setMessage({ type: 'error', text: 'Tu navegador no permite geolocalización.' })
    navigator.geolocation.getCurrentPosition(
      current => {
        const lat = Number(current.coords.latitude).toFixed(7)
        const lng = Number(current.coords.longitude).toFixed(7)
        const pos = { lat: Number(lat), lng: Number(lng) }
        setPosition(pos)
        if (target === 'store') setStoreForm(prev => ({ ...prev, latitude: lat, longitude: lng }))
        if (target === 'sector') setSectorForm(prev => ({ ...prev, latitude: lat, longitude: lng }))
        setMessage({ type: 'ok', text: `Ubicación capturada: ${lat}, ${lng}` })
      },
      () => setMessage({ type: 'error', text: 'No se pudo obtener ubicación. Revisa permisos del navegador.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  async function saveSector(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const payload = {
      ...sectorForm,
      normalized_name: normalize(sectorForm.name),
      latitude: sectorForm.latitude ? Number(sectorForm.latitude) : null,
      longitude: sectorForm.longitude ? Number(sectorForm.longitude) : null,
      radius_m: Number(sectorForm.radius_m || 900),
      created_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('local_sectors').upsert(payload, { onConflict: 'commune,name' })
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setSectorForm({ ...EMPTY_SECTOR, commune: sectorForm.commune })
    setMessage({ type: 'ok', text: 'Sector guardado. Ahora puedes asociar negocios a ese sector.' })
    await load()
  }

  async function saveStore(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const sector = sectors.find(item => item.name === storeForm.sector || item.id === storeForm.sector)
    const payload = {
      name: storeForm.name.trim(),
      normalized_name: normalize(storeForm.name),
      chain: storeForm.chain.trim() || null,
      type: storeForm.type,
      sector: sector?.name || storeForm.sector || 'Sin sector',
      sector_id: sector?.id || null,
      address: storeForm.address.trim() || null,
      latitude: storeForm.latitude ? Number(storeForm.latitude) : null,
      longitude: storeForm.longitude ? Number(storeForm.longitude) : null,
      location_source: 'admin',
      is_verified: Boolean(storeForm.is_verified),
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    let result
    if (editingStoreId) {
      result = await supabase.from('stores').update(payload).eq('id', editingStoreId)
    } else {
      result = await supabase.from('stores').insert(payload).select('id').single()
      if (!result.error && result.data?.id) {
        await supabase.from('store_aliases').insert({ store_id: result.data.id, alias: payload.name, alias_key: normalize(payload.name), created_by: user?.id || null }).then(() => {})
      }
    }

    setSaving(false)
    if (result.error) return setMessage({ type: 'error', text: result.error.message })
    setStoreForm({ ...EMPTY_STORE, commune: storeForm.commune })
    setEditingStoreId(null)
    setMessage({ type: 'ok', text: editingStoreId ? 'Negocio actualizado con coordenadas.' : 'Negocio guardado con coordenadas.' })
    await load()
  }

  async function updateStore(store, patch) {
    setSaving(true)
    const { error } = await supabase.from('stores').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', store.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Negocio actualizado.' })
    await load()
  }

  function editStore(store) {
    setEditingStoreId(store.id)
    setStoreForm({
      name: store.name || '',
      chain: store.chain || '',
      type: store.type || 'supermercado',
      commune: store.commune || 'Rancagua',
      sector: store.sector || '',
      address: store.address || '',
      latitude: store.latitude || '',
      longitude: store.longitude || '',
      is_verified: store.is_verified ?? true,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingStoreId(null)
    setStoreForm(EMPTY_STORE)
  }

  if (!isValidator) return <div className="rounded-3xl bg-white p-5 shadow-sm">Solo admin o validador puede entrar.</div>

  return (
    <div className="space-y-5 pb-32">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-100">Mapa local</p>
        <h1 className="mt-2 text-2xl font-black">Negocios y sectores</h1>
        <p className="mt-2 text-sm text-blue-50">Agrega supermercados, almacenes y poblaciones con coordenadas reales para que PriceNow calcule distancias correctas.</p>
      </section>

      <section className="rounded-[2rem] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
        <h2 className="font-black">Cómo se corrigen las distancias</h2>
        <p className="mt-2 leading-relaxed">La distancia no se escribe manualmente. PriceNow la calcula comparando la ubicación del usuario con la latitud y longitud del negocio. Si un supermercado aparece mal o no aparece, corrige sus coordenadas aquí.</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-blue-900">
          <li>Primero crea o edita el sector/población, por ejemplo “Población San Francisco”.</li>
          <li>Luego crea o edita el negocio y asígnalo a ese sector.</li>
          <li>Agrega latitud y longitud reales del negocio.</li>
          <li>Marca el negocio como verificado.</li>
          <li>Vuelve al inicio y usa ubicación para ver negocios cercanos con distancia real.</li>
        </ol>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <button onClick={() => useCurrentLocation('store')} className="rounded-3xl bg-slate-950 p-4 text-left text-white shadow-sm">
          <p className="text-sm font-black">Usar ubicación para negocio</p>
          <p className="mt-1 text-xs text-white/70">Rellena latitud/longitud del formulario de negocio.</p>
        </button>
        <button onClick={() => useCurrentLocation('sector')} className="rounded-3xl bg-blue-600 p-4 text-left text-white shadow-sm">
          <p className="text-sm font-black">Usar ubicación para sector</p>
          <p className="mt-1 text-xs text-white/70">Rellena latitud/longitud del sector o población.</p>
        </button>
        <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Sector detectado</p>
          <p className="mt-1 font-black text-slate-900">{nearestSector ? `${nearestSector.name} · ${formatDistance(nearestSector.distance_m)}` : 'Sin ubicación o sectores con coordenadas'}</p>
          <p className="mt-1 text-xs text-slate-500">Completa coordenadas para que la app diga “parece que estás en...”.</p>
        </div>
      </section>

      <form onSubmit={saveStore} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">{editingStoreId ? 'Editar negocio y coordenadas' : 'Agregar negocio con coordenadas'}</h2>
            <FieldHint>Para corregir distancia, edita latitud y longitud. No dupliques el negocio: usa “Editar” en la lista de abajo.</FieldHint>
          </div>
          {editingStoreId && <button type="button" onClick={cancelEdit} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Cancelar edición</button>}
        </div>
        <div className="mt-3 grid gap-2">
          <input required value={storeForm.name} onChange={e => setStoreForm({ ...storeForm, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Nombre del negocio" />
          <div className="grid grid-cols-2 gap-2">
            <input value={storeForm.chain} onChange={e => setStoreForm({ ...storeForm, chain: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Cadena / marca" />
            <select value={storeForm.type} onChange={e => setStoreForm({ ...storeForm, type: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              {STORE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <select value={storeForm.sector} onChange={e => setStoreForm({ ...storeForm, sector: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
            <option value="">Seleccionar sector/población</option>
            {sectors.map(sector => <option key={sector.id} value={sector.name}>{sector.commune} · {sector.name}</option>)}
          </select>
          <input value={storeForm.address} onChange={e => setStoreForm({ ...storeForm, address: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Dirección" />
          <div className="grid grid-cols-2 gap-2">
            <input value={storeForm.latitude} onChange={e => setStoreForm({ ...storeForm, latitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Latitud" />
            <input value={storeForm.longitude} onChange={e => setStoreForm({ ...storeForm, longitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Longitud" />
          </div>
          <button disabled={saving} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{editingStoreId ? 'Guardar cambios del negocio' : 'Guardar negocio'}</button>
        </div>
      </form>

      <form onSubmit={saveSector} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="font-black text-slate-900">Agregar sector o población</h2>
        <FieldHint>El radio define qué tan amplia es la zona. Para una población chica usa 600–900 m; para un sector grande usa 1200–1800 m.</FieldHint>
        <div className="mt-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={sectorForm.commune} onChange={e => setSectorForm({ ...sectorForm, commune: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Comuna" />
            <input required value={sectorForm.name} onChange={e => setSectorForm({ ...sectorForm, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Sector / población" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input value={sectorForm.latitude} onChange={e => setSectorForm({ ...sectorForm, latitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Latitud" />
            <input value={sectorForm.longitude} onChange={e => setSectorForm({ ...sectorForm, longitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Longitud" />
            <input value={sectorForm.radius_m} onChange={e => setSectorForm({ ...sectorForm, radius_m: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Radio m" />
          </div>
          <button disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Guardar sector</button>
        </div>
      </form>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black text-slate-900">Negocios cercanos reales</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{nearbyStores.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {nearbyStores.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Usa ubicación y agrega negocios con coordenadas para calcular distancias reales.</p>}
          {nearbyStores.map(store => (
            <div key={store.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
              <div>
                <p className="font-bold text-slate-900">{store.name}</p>
                <p className="text-xs text-slate-500">{store.sector || 'Sin sector'} · {store.type || 'negocio'}</p>
              </div>
              <span className="text-sm font-black text-blue-600">{formatDistance(store.distance_m)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Editar negocios existentes</h2>
            <FieldHint>Busca un negocio, presiona “Editar”, corrige dirección/coordenadas y guarda. Así se arreglan las distancias.</FieldHint>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{filteredStores.length}</span>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, sector o dirección..." className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
        {loading ? <p className="mt-3 text-sm text-slate-500">Cargando...</p> : (
          <div className="mt-3 space-y-2">
            {filteredStores.map(store => (
              <div key={store.id} className="rounded-2xl border border-slate-100 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{store.name}</p>
                    <p className="text-xs text-slate-500">{store.sector || 'Sin sector'} · {store.address || 'Sin dirección'}</p>
                    <p className="mt-1 text-xs text-slate-400">{store.latitude && store.longitude ? `${store.latitude}, ${store.longitude}` : 'Sin coordenadas'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button onClick={() => editStore(store)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Editar</button>
                    <button onClick={() => updateStore(store, { is_verified: !store.is_verified })} className={`rounded-xl px-3 py-2 text-xs font-bold ${store.is_verified ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{store.is_verified ? 'Verificado' : 'Verificar'}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
