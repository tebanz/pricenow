import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STORE_TYPES = ['supermercado', 'minimarket', 'almacen', 'panaderia', 'carniceria', 'verduleria', 'feria', 'mayorista', 'farmacia', 'otro']
const MAX_SECTOR_DETECTION_M = 50000

const EMPTY_STORE = { name: '', chain: '', type: 'supermercado', sector: '', address: '', latitude: '', longitude: '', is_verified: true, location_source: 'admin' }
const EMPTY_SECTOR = { commune: 'Rancagua', name: '', latitude: '', longitude: '', radius_m: 900, is_active: true }
const EMPTY_SEARCH = { name: '', commune: 'Rancagua', address: '', type: 'supermercado' }
const EMPTY_IMPORT = { commune: 'Rancagua', type: 'supermercado', sector: '' }

function normalize(text = '') {
  return text.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  if (String(lat).trim() === '' || String(lng).trim() === '') return false
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

function hasCoords(row) {
  return isValidCoordinate(row?.latitude, row?.longitude)
}

function coordinatePayload(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return { latitude: null, longitude: null }
  return { latitude: Number(lat), longitude: Number(lng) }
}

function mapsUrl(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return null
  return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`
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

function mapOsmType(type = '') {
  const key = normalize(type)
  if (key.includes('supermarket')) return 'supermercado'
  if (key.includes('wholesale')) return 'mayorista'
  if (key.includes('convenience')) return 'minimarket'
  if (key.includes('bakery')) return 'panaderia'
  if (key.includes('butcher')) return 'carniceria'
  if (key.includes('greengrocer')) return 'verduleria'
  if (key.includes('marketplace')) return 'feria'
  if (key.includes('pharmacy') || key.includes('chemist')) return 'farmacia'
  return STORE_TYPES.includes(key) ? key : 'otro'
}

function FieldHint({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>
}

function StatusPill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${tones[tone] || tones.slate}`}>{children}</span>
}

function duplicateForCandidate(candidate, stores, ignoreId = null) {
  if (!candidate?.name) return null
  const candidateName = normalize(candidate.name)
  if (!candidateName) return null
  const candidatePoint = { lat: candidate.lat ?? candidate.latitude, lng: candidate.lng ?? candidate.longitude }

  return stores.find(store => {
    if (store.id === ignoreId || store.is_active === false) return false
    const storeName = normalize(store.name)
    if (!storeName) return false
    const sameName = storeName === candidateName
    const similarName = sameName || (candidateName.length > 5 && storeName.length > 5 && (candidateName.includes(storeName) || storeName.includes(candidateName)))
    const distance = distanceMeters(candidatePoint, { lat: store.latitude, lng: store.longitude })

    if (sameName && distance == null && !hasCoords(store)) return true
    if (sameName && distance != null && distance <= 250) return true
    if (similarName && distance != null && distance <= 150) return true
    return false
  }) || null
}

function CandidateCard({ candidate, duplicate, onSelect, onSave, saving }) {
  const url = mapsUrl(candidate.lat, candidate.lng)
  const closeDistance = candidate.distance_km != null && Number(candidate.distance_km) <= 50
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-slate-900">{candidate.name}</p>
            <StatusPill tone={duplicate ? 'amber' : 'green'}>{duplicate ? 'Posible duplicado' : 'Candidato nuevo'}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-slate-500">{candidate.address || 'Sin direccion en OSM'} - {mapOsmType(candidate.type)}</p>
          <p className="mt-1 text-xs text-slate-400">{Number(candidate.lat).toFixed(6)}, {Number(candidate.lng).toFixed(6)}{closeDistance ? ` - ${Number(candidate.distance_km).toFixed(1)} km aprox.` : ''}</p>
          {duplicate && <p className="mt-1 text-xs font-semibold text-amber-700">Coincide con: {duplicate.name}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button type="button" onClick={() => onSelect(candidate)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Usar</button>
          <button type="button" disabled={saving || !!duplicate} onClick={() => onSave(candidate)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Guardar</button>
          {url && <a href={url} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-700">Ver mapa</a>}
        </div>
      </div>
    </div>
  )
}

export default function LocalMapAdmin() {
  const { user, isValidator } = useAuth()
  const [stores, setStores] = useState([])
  const [sectors, setSectors] = useState([])
  const [query, setQuery] = useState('')
  const [sectorQuery, setSectorQuery] = useState('')
  const [coordFilter, setCoordFilter] = useState('all')
  const [verifiedFilter, setVerifiedFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [position, setPosition] = useState(null)
  const [storeForm, setStoreForm] = useState(EMPTY_STORE)
  const [sectorForm, setSectorForm] = useState(EMPTY_SECTOR)
  const [editingStoreId, setEditingStoreId] = useState(null)
  const [editingSectorId, setEditingSectorId] = useState(null)
  const [searchForm, setSearchForm] = useState(EMPTY_SEARCH)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [importForm, setImportForm] = useState(EMPTY_IMPORT)
  const [importCandidates, setImportCandidates] = useState([])
  const [importLoading, setImportLoading] = useState(false)

  async function load() {
    setLoading(true)
    const [storesRes, sectorsRes] = await Promise.all([
      supabase.from('stores').select('*').order('name', { ascending: true }).limit(1000),
      supabase.from('local_sectors').select('*').order('commune').order('name').limit(500),
    ])
    if (storesRes.error || sectorsRes.error) setMessage({ type: 'error', text: storesRes.error?.message || sectorsRes.error?.message })
    setStores(storesRes.data || [])
    setSectors(sectorsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const activeSectors = useMemo(() => sectors.filter(sector => sector.is_active !== false), [sectors])

  const availableTypes = useMemo(() => {
    return ['all', ...new Set(stores.map(store => store.type || 'otro').filter(Boolean))]
  }, [stores])

  const filteredStores = useMemo(() => {
    const q = normalize(query)
    return stores
      .filter(store => store.is_active !== false)
      .filter(store => !q || normalize(`${store.name} ${store.chain} ${store.sector} ${store.address} ${store.type}`).includes(q))
      .filter(store => coordFilter === 'all' || (coordFilter === 'with' ? hasCoords(store) : !hasCoords(store)))
      .filter(store => verifiedFilter === 'all' || (verifiedFilter === 'verified' ? store.is_verified : !store.is_verified))
      .filter(store => typeFilter === 'all' || (store.type || 'otro') === typeFilter)
      .slice(0, 160)
  }, [stores, query, coordFilter, verifiedFilter, typeFilter])

  const filteredSectors = useMemo(() => {
    const q = normalize(sectorQuery)
    return activeSectors
      .filter(sector => !q || normalize(`${sector.commune} ${sector.name}`).includes(q))
      .slice(0, 120)
  }, [activeSectors, sectorQuery])

  const nearbyStores = useMemo(() => {
    if (!position) return []
    return stores
      .filter(store => store.is_active !== false && hasCoords(store))
      .map(store => ({ ...store, distance_m: distanceMeters(position, { lat: store.latitude, lng: store.longitude }) }))
      .filter(store => store.distance_m != null)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 12)
  }, [stores, position])

  const nearestSector = useMemo(() => {
    if (!position) return null
    return activeSectors
      .filter(hasCoords)
      .map(sector => ({ ...sector, distance_m: distanceMeters(position, { lat: sector.latitude, lng: sector.longitude }) }))
      .filter(sector => sector.distance_m != null)
      .sort((a, b) => a.distance_m - b.distance_m)[0] || null
  }, [activeSectors, position])

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
      text: `${nearestSector.name} - ${formatDistance(nearestSector.distance_m)}`,
    }
  }, [nearestSector, position])

  function sectorFromName(value) {
    return activeSectors.find(item => item.name === value || item.id === value)
  }

  function useCurrentLocation(target = 'store') {
    if (!navigator.geolocation) return setMessage({ type: 'error', text: 'Tu navegador no permite geolocalizacion.' })
    navigator.geolocation.getCurrentPosition(
      current => {
        const lat = Number(current.coords.latitude).toFixed(7)
        const lng = Number(current.coords.longitude).toFixed(7)
        const pos = { lat: Number(lat), lng: Number(lng) }
        setPosition(pos)
        if (target === 'store') setStoreForm(prev => ({ ...prev, latitude: lat, longitude: lng, location_source: 'admin_current_location' }))
        if (target === 'sector') setSectorForm(prev => ({ ...prev, latitude: lat, longitude: lng }))
        setMessage({ type: 'ok', text: `Ubicacion capturada: ${lat}, ${lng}` })
      },
      () => setMessage({ type: 'error', text: 'No se pudo obtener ubicacion. Revisa permisos del navegador.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  async function fetchOsm(params) {
    const response = await fetch(`/api/nearby-osm?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar OpenStreetMap.')
    return {
      ...data,
      places: (data.places || []).filter(place => isValidCoordinate(place.lat, place.lng) && (place.distance_km == null || Number(place.distance_km) <= 50)),
    }
  }

  async function searchOsmBusinesses(event) {
    event.preventDefault()
    if (!searchForm.name.trim() && !searchForm.address.trim() && !searchForm.commune.trim()) {
      setMessage({ type: 'error', text: 'Escribe al menos nombre, comuna o direccion para buscar.' })
      return
    }

    setSearchLoading(true)
    setSearchResults([])
    setMessage(null)
    try {
      const params = new URLSearchParams({
        mode: 'search',
        query: searchForm.name,
        address: searchForm.address,
        commune: searchForm.commune,
        type: searchForm.type,
        limit: '16',
      })
      const data = await fetchOsm(params)
      setSearchResults(data.places)
      setMessage({ type: data.places.length ? 'ok' : 'error', text: data.places.length ? 'Candidatos encontrados. Revisa antes de guardar.' : 'No encontramos candidatos reales con coordenadas para esa busqueda.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSearchLoading(false)
    }
  }

  async function searchImportCandidates(event) {
    event.preventDefault()
    if (!importForm.commune.trim()) {
      setMessage({ type: 'error', text: 'Indica una comuna para importar candidatos.' })
      return
    }

    setImportLoading(true)
    setImportCandidates([])
    setMessage(null)
    try {
      const params = new URLSearchParams({
        mode: 'import',
        commune: importForm.commune,
        type: importForm.type,
        radius_m: '12000',
        limit: '30',
      })
      const data = await fetchOsm(params)
      setImportCandidates(data.places)
      setMessage({ type: data.places.length ? 'ok' : 'error', text: data.places.length ? 'Candidatos listos para revisar. Guarda solo los que correspondan.' : 'No encontramos negocios conocidos con coordenadas para esa comuna y tipo.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setImportLoading(false)
    }
  }

  function selectCandidate(candidate, preferredSector = '') {
    const sectorName = preferredSector || candidate.sector || storeForm.sector
    setStoreForm(prev => ({
      ...prev,
      name: candidate.name || prev.name,
      type: mapOsmType(candidate.type),
      sector: sectorName,
      address: candidate.address || prev.address,
      latitude: String(candidate.lat || ''),
      longitude: String(candidate.lng || ''),
      is_verified: false,
      location_source: candidate.source || 'osm',
    }))
    setMessage({ type: 'ok', text: 'Candidato cargado en el formulario. Revisa datos y guarda.' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveCandidate(candidate, preferredSector = '') {
    const duplicate = duplicateForCandidate(candidate, stores)
    if (duplicate) {
      setMessage({ type: 'error', text: `No se guardo: parece duplicado de ${duplicate.name}.` })
      return
    }

    const sector = sectorFromName(preferredSector || candidate.sector || '')
    const payload = {
      name: candidate.name.trim(),
      normalized_name: normalize(candidate.name),
      chain: null,
      type: mapOsmType(candidate.type),
      sector: sector?.name || preferredSector || candidate.sector || 'Sin sector',
      sector_id: sector?.id || null,
      address: candidate.address || null,
      ...coordinatePayload(candidate.lat, candidate.lng),
      location_source: candidate.source || 'osm',
      is_verified: false,
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    setSaving(true)
    const result = await supabase.from('stores').insert(payload).select('id').single()
    if (!result.error && result.data?.id) {
      await supabase
        .from('store_aliases')
        .insert({ store_id: result.data.id, alias: payload.name, alias_key: normalize(payload.name), created_by: user?.id || null })
        .then(() => {})
    }
    setSaving(false)

    if (result.error) return setMessage({ type: 'error', text: result.error.message })
    setMessage({ type: 'ok', text: `${candidate.name} guardado como negocio pendiente de verificacion.` })
    await load()
  }

  async function saveSector(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const payload = {
      commune: sectorForm.commune.trim() || 'Rancagua',
      name: sectorForm.name.trim(),
      normalized_name: normalize(sectorForm.name),
      ...coordinatePayload(sectorForm.latitude, sectorForm.longitude),
      radius_m: Number(sectorForm.radius_m || 900),
      is_active: sectorForm.is_active !== false,
      created_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }

    const result = editingSectorId
      ? await supabase.from('local_sectors').update(payload).eq('id', editingSectorId)
      : await supabase.from('local_sectors').upsert(payload, { onConflict: 'commune,name' })

    setSaving(false)
    if (result.error) return setMessage({ type: 'error', text: result.error.message })
    setSectorForm({ ...EMPTY_SECTOR, commune: sectorForm.commune || 'Rancagua' })
    setEditingSectorId(null)
    setMessage({ type: 'ok', text: editingSectorId ? 'Sector actualizado.' : 'Sector guardado.' })
    await load()
  }

  async function saveStore(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)

    const coords = coordinatePayload(storeForm.latitude, storeForm.longitude)
    const duplicate = !editingStoreId
      ? duplicateForCandidate({ name: storeForm.name, lat: coords.latitude, lng: coords.longitude }, stores)
      : null

    if (duplicate) {
      setSaving(false)
      setMessage({ type: 'error', text: `No se guardo: parece duplicado de ${duplicate.name}.` })
      return
    }

    const sector = sectorFromName(storeForm.sector)
    const payload = {
      name: storeForm.name.trim(),
      normalized_name: normalize(storeForm.name),
      chain: storeForm.chain.trim() || null,
      type: storeForm.type || 'otro',
      sector: sector?.name || storeForm.sector || 'Sin sector',
      sector_id: sector?.id || null,
      address: storeForm.address.trim() || null,
      ...coords,
      location_source: storeForm.location_source || 'admin',
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
        await supabase
          .from('store_aliases')
          .insert({ store_id: result.data.id, alias: payload.name, alias_key: normalize(payload.name), created_by: user?.id || null })
          .then(() => {})
      }
    }

    setSaving(false)
    if (result.error) return setMessage({ type: 'error', text: result.error.message })
    setStoreForm(EMPTY_STORE)
    setEditingStoreId(null)
    setMessage({ type: 'ok', text: editingStoreId ? 'Negocio actualizado.' : 'Negocio guardado.' })
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

  async function updateSector(sector, patch) {
    setSaving(true)
    const { error } = await supabase.from('local_sectors').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', sector.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Sector actualizado.' })
    await load()
  }

  function editStore(store) {
    setEditingStoreId(store.id)
    setStoreForm({
      name: store.name || '',
      chain: store.chain || '',
      type: store.type || 'supermercado',
      sector: store.sector || '',
      address: store.address || '',
      latitude: store.latitude || '',
      longitude: store.longitude || '',
      is_verified: store.is_verified ?? true,
      location_source: store.location_source || 'admin',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function editSector(sector) {
    setEditingSectorId(sector.id)
    setSectorForm({
      commune: sector.commune || 'Rancagua',
      name: sector.name || '',
      latitude: sector.latitude || '',
      longitude: sector.longitude || '',
      radius_m: sector.radius_m || 900,
      is_active: sector.is_active !== false,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelStoreEdit() {
    setEditingStoreId(null)
    setStoreForm(EMPTY_STORE)
  }

  function cancelSectorEdit() {
    setEditingSectorId(null)
    setSectorForm(EMPTY_SECTOR)
  }

  if (!isValidator) return <div className="rounded-3xl bg-white p-5 shadow-sm">Solo admin o validador puede entrar.</div>

  const currentStoreMapUrl = mapsUrl(storeForm.latitude, storeForm.longitude)
  const currentSectorMapUrl = mapsUrl(sectorForm.latitude, sectorForm.longitude)

  return (
    <div className="space-y-5 pb-32">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-100">PriceNow Local Intelligence</p>
        <h1 className="mt-2 text-2xl font-black">Negocios y sectores</h1>
        <p className="mt-2 text-sm text-blue-50">Busca negocios reales en OpenStreetMap, revisa duplicados y guarda solo coordenadas confiables.</p>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => useCurrentLocation('store')} className="rounded-3xl bg-slate-950 p-4 text-left text-white shadow-sm">
          <p className="text-sm font-black">Usar mi ubicacion actual</p>
          <p className="mt-1 text-xs text-white/70">Rellena coordenadas del negocio si estas en el lugar.</p>
        </button>
        <button type="button" onClick={() => useCurrentLocation('sector')} className="rounded-3xl bg-blue-600 p-4 text-left text-white shadow-sm">
          <p className="text-sm font-black">Usar ubicacion para sector</p>
          <p className="mt-1 text-xs text-white/70">Rellena coordenadas del sector o poblacion.</p>
        </button>
        <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Sector detectado</p>
          <p className={`mt-1 font-black ${sectorDetection?.type === 'warning' ? 'text-amber-700' : 'text-slate-900'}`}>
            {sectorDetection?.text || 'Sin ubicacion o sectores con coordenadas validas'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Los sectores sin coordenadas validas se ignoran.</p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-blue-100 bg-white p-4 shadow-sm">
        <form onSubmit={searchOsmBusinesses}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">Buscar negocio real</h2>
              <FieldHint>Busca por nombre, comuna o direccion. Los resultados vienen de OSM y se revisan antes de guardar.</FieldHint>
            </div>
            <StatusPill tone="blue">{searchResults.length}</StatusPill>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={searchForm.name} onChange={e => setSearchForm({ ...searchForm, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Nombre del negocio" />
            <input value={searchForm.commune} onChange={e => setSearchForm({ ...searchForm, commune: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Comuna" />
            <input value={searchForm.address} onChange={e => setSearchForm({ ...searchForm, address: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm sm:col-span-2" placeholder="Direccion o referencia" />
            <select value={searchForm.type} onChange={e => setSearchForm({ ...searchForm, type: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              {STORE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <button disabled={searchLoading} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{searchLoading ? 'Buscando...' : 'Buscar en OSM'}</button>
          </div>
        </form>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {searchResults.map(candidate => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                duplicate={duplicateForCandidate(candidate, stores)}
                saving={saving}
                onSelect={selectCandidate}
                onSave={saveCandidate}
              />
            ))}
          </div>
        )}
      </section>

      <form onSubmit={saveStore} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">{editingStoreId ? 'Editar negocio' : 'Agregar negocio'}</h2>
            <FieldHint>Usa primero la busqueda OSM cuando sea posible. Las coordenadas quedan en opciones avanzadas.</FieldHint>
          </div>
          {editingStoreId && <button type="button" onClick={cancelStoreEdit} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Cancelar</button>}
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
            <option value="">Seleccionar sector/poblacion</option>
            {activeSectors.map(sector => <option key={sector.id} value={sector.name}>{sector.commune} - {sector.name}</option>)}
          </select>
          <input value={storeForm.address} onChange={e => setStoreForm({ ...storeForm, address: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Direccion" />

          <div className={`rounded-2xl px-3 py-2 text-xs font-semibold ${currentStoreMapUrl ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {currentStoreMapUrl ? 'Coordenadas validas cargadas.' : 'Sin coordenadas validas. Latitud/longitud vacias o 0,0 no cuentan como ubicacion real.'}
          </div>

          <details className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-slate-700">Opciones avanzadas</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-bold text-slate-500">Latitud del negocio
                <input value={storeForm.latitude} onChange={e => setStoreForm({ ...storeForm, latitude: e.target.value, location_source: 'admin' })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" placeholder="-34.1700000" inputMode="decimal" />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">Longitud del negocio
                <input value={storeForm.longitude} onChange={e => setStoreForm({ ...storeForm, longitude: e.target.value, location_source: 'admin' })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" placeholder="-70.7400000" inputMode="decimal" />
              </label>
            </div>
          </details>

          <label className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
            Marcar negocio como verificado
            <input type="checkbox" checked={!!storeForm.is_verified} onChange={e => setStoreForm({ ...storeForm, is_verified: e.target.checked })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={saving} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{editingStoreId ? 'Guardar cambios del negocio' : 'Guardar negocio'}</button>
            {currentStoreMapUrl && <a href={currentStoreMapUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-black text-slate-700">Ver en mapa</a>}
          </div>
        </div>
      </form>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <form onSubmit={searchImportCandidates}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">Importar negocios conocidos</h2>
              <FieldHint>Busca candidatos reales por comuna y tipo. PriceNow muestra duplicados posibles antes de guardar.</FieldHint>
            </div>
            <StatusPill tone="blue">{importCandidates.length}</StatusPill>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <input value={importForm.commune} onChange={e => setImportForm({ ...importForm, commune: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Comuna" />
            <select value={importForm.type} onChange={e => setImportForm({ ...importForm, type: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              {STORE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <select value={importForm.sector} onChange={e => setImportForm({ ...importForm, sector: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <option value="">Sector opcional</option>
              {activeSectors.map(sector => <option key={sector.id} value={sector.name}>{sector.commune} - {sector.name}</option>)}
            </select>
            <button disabled={importLoading} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{importLoading ? 'Buscando...' : 'Buscar candidatos'}</button>
          </div>
        </form>
        {importCandidates.length > 0 && (
          <div className="mt-3 space-y-2">
            {importCandidates.map(candidate => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                duplicate={duplicateForCandidate(candidate, stores)}
                saving={saving}
                onSelect={item => selectCandidate(item, importForm.sector)}
                onSave={item => saveCandidate(item, importForm.sector)}
              />
            ))}
          </div>
        )}
      </section>

      <form onSubmit={saveSector} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">{editingSectorId ? 'Editar sector o poblacion' : 'Agregar sector o poblacion'}</h2>
            <FieldHint>Los sectores sin coordenadas validas se guardan, pero no se usan para detectar zona.</FieldHint>
          </div>
          {editingSectorId && <button type="button" onClick={cancelSectorEdit} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Cancelar</button>}
        </div>
        <div className="mt-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={sectorForm.commune} onChange={e => setSectorForm({ ...sectorForm, commune: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Comuna" />
            <input required value={sectorForm.name} onChange={e => setSectorForm({ ...sectorForm, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Sector / poblacion" />
          </div>
          <div className={`rounded-2xl px-3 py-2 text-xs font-semibold ${currentSectorMapUrl ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {currentSectorMapUrl ? 'Coordenadas validas cargadas.' : 'Sin coordenadas validas. Este sector no se usara para detectar zona.'}
          </div>
          <details className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-slate-700">Opciones avanzadas</summary>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-xs font-bold text-slate-500">Latitud
                <input value={sectorForm.latitude} onChange={e => setSectorForm({ ...sectorForm, latitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" placeholder="-34.1700000" inputMode="decimal" />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">Longitud
                <input value={sectorForm.longitude} onChange={e => setSectorForm({ ...sectorForm, longitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" placeholder="-70.7400000" inputMode="decimal" />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">Radio m
                <input value={sectorForm.radius_m} onChange={e => setSectorForm({ ...sectorForm, radius_m: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" placeholder="900" inputMode="numeric" />
              </label>
            </div>
          </details>
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{editingSectorId ? 'Guardar cambios del sector' : 'Guardar sector'}</button>
            {currentSectorMapUrl && <a href={currentSectorMapUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-black text-slate-700">Ver en mapa</a>}
          </div>
        </div>
      </form>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black text-slate-900">Negocios cercanos reales</h2>
          <StatusPill tone="blue">{nearbyStores.length}</StatusPill>
        </div>
        <div className="mt-3 space-y-2">
          {nearbyStores.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Usa ubicacion y agrega negocios con coordenadas para calcular distancias reales.</p>}
          {nearbyStores.map(store => (
            <div key={store.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-900">{store.name}</p>
                <p className="truncate text-xs text-slate-500">{store.sector || 'Sin sector'} - {store.type || 'negocio'}</p>
              </div>
              <span className="shrink-0 text-sm font-black text-blue-600">{formatDistance(store.distance_m)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Editar negocios existentes</h2>
            <FieldHint>Filtra por coordenadas o verificacion, corrige datos y marca como verificado cuando corresponda.</FieldHint>
          </div>
          <StatusPill>{filteredStores.length}</StatusPill>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, sector o direccion..." className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <select value={coordFilter} onChange={e => setCoordFilter(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
            <option value="all">Todas</option>
            <option value="with">Con coordenadas</option>
            <option value="without">Sin coordenadas validas</option>
          </select>
          <select value={verifiedFilter} onChange={e => setVerifiedFilter(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
            <option value="all">Verificacion</option>
            <option value="verified">Verificadas</option>
            <option value="unverified">Sin verificar</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
            {availableTypes.map(type => <option key={type} value={type}>{type === 'all' ? 'Tipo' : type}</option>)}
          </select>
        </div>
        {loading ? <p className="mt-3 text-sm text-slate-500">Cargando...</p> : (
          <div className="mt-3 space-y-2">
            {filteredStores.map(store => {
              const url = mapsUrl(store.latitude, store.longitude)
              return (
                <div key={store.id} className="rounded-2xl border border-slate-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-slate-900">{store.name}</p>
                        {hasCoords(store) ? <StatusPill tone="green">Con coordenadas</StatusPill> : <StatusPill tone="amber">Sin coordenadas validas</StatusPill>}
                        {store.is_verified ? <StatusPill tone="green">Verificado</StatusPill> : <StatusPill>Sin verificar</StatusPill>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{store.sector || 'Sin sector'} - {store.address || 'Sin direccion'} - {store.type || 'negocio'}</p>
                      <p className={`mt-1 text-xs ${hasCoords(store) ? 'text-slate-400' : 'font-semibold text-amber-700'}`}>{hasCoords(store) ? `${store.latitude}, ${store.longitude}` : 'Sin coordenadas validas.'}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button type="button" onClick={() => editStore(store)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Editar</button>
                      <button type="button" onClick={() => updateStore(store, { is_verified: !store.is_verified })} className={`rounded-xl px-3 py-2 text-xs font-bold ${store.is_verified ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{store.is_verified ? 'Verificado' : 'Verificar'}</button>
                      {url && <a href={url} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-700">Ver mapa</a>}
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredStores.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No hay negocios con ese filtro.</p>}
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Editar sectores y poblaciones</h2>
            <FieldHint>Los sectores con coordenadas invalidas muestran advertencia y no participan en deteccion.</FieldHint>
          </div>
          <StatusPill>{filteredSectors.length}</StatusPill>
        </div>
        <input value={sectorQuery} onChange={e => setSectorQuery(e.target.value)} placeholder="Buscar sector o comuna..." className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
        <div className="mt-3 space-y-2">
          {filteredSectors.map(sector => {
            const url = mapsUrl(sector.latitude, sector.longitude)
            return (
              <div key={sector.id} className="rounded-2xl border border-slate-100 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-900">{sector.name}</p>
                      {hasCoords(sector) ? <StatusPill tone="green">Con coordenadas</StatusPill> : <StatusPill tone="amber">Sin coordenadas validas</StatusPill>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{sector.commune || 'Sin comuna'} - radio {sector.radius_m || 900} m</p>
                    <p className={`mt-1 text-xs ${hasCoords(sector) ? 'text-slate-400' : 'font-semibold text-amber-700'}`}>{hasCoords(sector) ? `${sector.latitude}, ${sector.longitude}` : 'Advertencia: este sector no tiene coordenadas validas.'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button type="button" onClick={() => editSector(sector)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Editar</button>
                    <button type="button" onClick={() => updateSector(sector, { is_active: false })} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Desactivar</button>
                    {url && <a href={url} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-700">Ver mapa</a>}
                  </div>
                </div>
              </div>
            )
          })}
          {filteredSectors.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No hay sectores con ese filtro.</p>}
        </div>
      </section>
    </div>
  )
}
