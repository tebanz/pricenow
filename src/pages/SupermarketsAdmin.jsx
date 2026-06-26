import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDistance, getDistanceMeters, isValidCoordinate } from '../utils/location'
import { normalizeName } from '../utils/normalize'

const DEFAULT_FORM = {
  region: "Region de O'Higgins",
  city: 'Rancagua',
  commune: 'Rancagua',
  radius_m: '5000',
}

const RANCAGUA_FORM = {
  region: "Region de O'Higgins",
  city: 'Rancagua',
  commune: 'Rancagua',
  radius_m: '5000',
}

const SUPERMARKET_CHAINS = [
  'Lider',
  'Express de Lider',
  'Jumbo',
  'Santa Isabel',
  'Unimarc',
  'Tottus',
  'Mayorista 10',
  'Acuenta',
  'Alvi',
  'Cugat',
  'Ekono',
]

function StatusPill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }
  return <span className={`rounded-full px-2 py-1 text-[11px] font-black ${tones[tone] || tones.slate}`}>{children}</span>
}

function Field({ label, children }) {
  return <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">{label}{children}</label>
}

function normalized(value = '') {
  return normalizeName(value)
}

function cleanLocation(value) {
  const text = (value || '').toString().trim()
  if (!text) return ''
  const key = normalized(text)
  if (['otro', 'otro no aparece mi sector', 'sin sector'].includes(key)) return ''
  return text
}

function cleanSector(sector, city, commune) {
  const value = cleanLocation(sector)
  if (!value) return ''
  const key = normalized(value)
  if (key && (key === normalized(city) || key === normalized(commune))) return ''
  return value
}

function inferChain(name = '') {
  const key = normalized(name)
  return SUPERMARKET_CHAINS.find(chain => key.includes(normalized(chain))) || ''
}

function inferBranchName(name = '', chainName = '', address = '') {
  const cleaned = name.replace(new RegExp(chainName, 'i'), '').replace(/[-|]/g, ' ').trim()
  if (cleaned && normalized(cleaned) !== normalized(name)) return cleaned
  const addressPart = (address || '').split(',')[0]?.trim()
  return addressPart || ''
}

function sourceLabel(source = '') {
  if (source === 'geoapify') return 'Geoapify'
  if (source.includes('osm') || source.includes('openstreetmap')) return 'OSM'
  return source || 'Mapa'
}

function mapsUrl(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return null
  return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`
}

function placeDistanceMeters(place) {
  if (place.distance_m != null) return Number(place.distance_m)
  if (place.distance_km != null) return Math.round(Number(place.distance_km) * 1000)
  return null
}

function candidateFromPlace(place, form, origin) {
  const chainName = inferChain(place.name)
  const city = cleanLocation(place.city || form.city)
  const commune = cleanLocation(place.commune || form.commune || city)
  const sector = cleanSector(place.sector, city, commune)
  const distance = placeDistanceMeters(place) ?? getDistanceMeters(origin?.lat, origin?.lng, place.lat, place.lng)

  return {
    id: `${place.source || 'map'}-${place.id || `${place.lat}-${place.lng}-${place.name}`}`,
    external_id: String(place.id || ''),
    external_source: place.source === 'geoapify' ? 'geoapify' : 'osm',
    place_id: String(place.id || ''),
    name: place.name || '',
    chain_name: chainName,
    branch_name: inferBranchName(place.name || '', chainName, place.address || ''),
    type: 'supermercado',
    address: place.address || '',
    region: cleanLocation(place.region || form.region),
    city,
    commune,
    sector,
    latitude: Number(place.lat),
    longitude: Number(place.lng),
    distance_m: distance,
    source: place.source || 'map',
    selected: false,
    rejected: false,
    is_verified: false,
    saved: false,
    allowDuplicate: false,
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set()
  return candidates.filter(candidate => {
    const key = candidate.external_id
      ? `${candidate.external_source}-${candidate.external_id}`
      : `${normalized(candidate.name)}-${Number(candidate.latitude).toFixed(5)}-${Number(candidate.longitude).toFixed(5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function textSimilarity(a = '', b = '') {
  const left = new Set(normalized(a).split(' ').filter(Boolean))
  const right = new Set(normalized(b).split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  let matches = 0
  left.forEach(token => { if (right.has(token)) matches += 1 })
  return matches / Math.max(left.size, right.size)
}

function isSupermarket(store = {}) {
  const text = normalized(`${store.type || ''} ${store.store_type || ''} ${store.name || ''} ${store.chain_name || ''} ${store.chain || ''}`)
  return text.includes('supermercado') || SUPERMARKET_CHAINS.some(chain => text.includes(normalized(chain)))
}

function duplicateReasons(candidate, stores) {
  const reasons = []
  const candidateName = normalized(candidate.name)
  const candidateAddress = normalized(candidate.address)
  const candidateCommune = normalized(candidate.commune)

  stores
    .filter(store => store.is_active !== false)
    .forEach(store => {
      const storeExternalId = String(store.external_id || store.place_id || '')
      const sameExternalId = candidate.external_id && storeExternalId && candidate.external_id === storeExternalId
      const sameSource = !store.external_source || !candidate.external_source || store.external_source === candidate.external_source
      const addressMatch = candidateAddress && normalized(store.address) === candidateAddress && (!candidateCommune || normalized(store.commune) === candidateCommune)
      const distance = getDistanceMeters(candidate.latitude, candidate.longitude, store.latitude, store.longitude)
      const nameScore = textSimilarity(candidateName, normalized(store.name || store.normalized_name))
      const nearbyName = nameScore >= 0.62 && distance != null && distance < 250

      if (sameExternalId && sameSource) reasons.push({ store, reason: 'Mismo external_id/place_id' })
      else if (nearbyName) reasons.push({ store, reason: `Nombre parecido a ${formatDistance(distance)}` })
      else if (addressMatch) reasons.push({ store, reason: 'Misma direccion y comuna' })
    })

  return reasons
}

function existingDuplicatePairs(stores) {
  const supermarkets = stores.filter(store => store.is_active !== false && isSupermarket(store))
  const pairs = []
  for (let i = 0; i < supermarkets.length; i += 1) {
    for (let j = i + 1; j < supermarkets.length; j += 1) {
      const left = supermarkets[i]
      const right = supermarkets[j]
      const reasons = duplicateReasons({
        name: left.name,
        external_id: left.external_id,
        external_source: left.external_source,
        address: left.address,
        commune: left.commune,
        latitude: left.latitude,
        longitude: left.longitude,
      }, [right])
      if (reasons.length) pairs.push({ left, right, reason: reasons[0].reason })
    }
  }
  return pairs.slice(0, 20)
}

export default function SupermarketsAdmin() {
  const { isAdmin } = useAuth()
  const [form, setForm] = useState(DEFAULT_FORM)
  const [stores, setStores] = useState([])
  const [candidates, setCandidates] = useState([])
  const [origin, setOrigin] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  async function loadStores() {
    setLoading(true)
    const { data, error } = await supabase.from('stores').select('*').order('name', { ascending: true }).limit(1500)
    if (error) setMessage({ type: 'error', text: error.message })
    setStores(data || [])
    setLoading(false)
  }

  useEffect(() => { loadStores() }, [])

  const duplicatePairs = useMemo(() => existingDuplicatePairs(stores), [stores])
  const pendingSupermarkets = useMemo(() => stores.filter(store => isSupermarket(store) && store.verification_status === 'pending'), [stores])

  async function resolveOrigin(nextForm = form) {
    const params = new URLSearchParams({
      mode: 'import',
      commune: [nextForm.commune, nextForm.city, nextForm.region].filter(Boolean).join(', '),
      type: 'supermercado',
      radius_m: '5000',
      limit: '1',
    })
    const response = await fetch(`/api/nearby-osm?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.origin || !isValidCoordinate(data.origin.lat, data.origin.lng)) {
      throw new Error(data.error || 'No se pudo ubicar la ciudad/comuna.')
    }
    setOrigin(data.origin)
    return data.origin
  }

  async function fetchGeoapify(originPoint, radius) {
    const params = new URLSearchParams({
      mode: 'nearby',
      lat: String(originPoint.lat),
      lng: String(originPoint.lng),
      radius_m: String(radius),
      type: 'supermercado',
      limit: '50',
    })
    const response = await fetch(`/api/nearby-geoapify?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Geoapify no respondio.')
    return (data.places || []).map(place => ({ ...place, source: 'geoapify' }))
  }

  async function fetchOsm(originPoint, radius, nextForm = form) {
    const params = new URLSearchParams({
      mode: 'nearby',
      lat: String(originPoint.lat),
      lng: String(originPoint.lng),
      commune: [nextForm.commune, nextForm.city, nextForm.region].filter(Boolean).join(', '),
      type: 'supermercado',
      radius_m: String(radius),
      limit: '50',
    })
    const response = await fetch(`/api/nearby-osm?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'OSM no respondio.')
    return (data.places || []).map(place => ({ ...place, source: place.source || 'osm' }))
  }

  async function searchRadius(radius, nextForm = form, originPoint = null) {
    const point = originPoint || await resolveOrigin(nextForm)
    try {
      const geoPlaces = await fetchGeoapify(point, radius)
      if (geoPlaces.length) return geoPlaces
    } catch (err) {
      console.warn('EdePrecios Geoapify supermarkets search failed:', err)
    }
    return fetchOsm(point, radius, nextForm)
  }

  async function searchSupermarkets(event) {
    event?.preventDefault()
    setSearching(true)
    setMessage(null)
    try {
      const point = await resolveOrigin(form)
      const places = await searchRadius(Number(form.radius_m), form, point)
      const next = uniqueCandidates(places.map(place => candidateFromPlace(place, form, point)))
      setCandidates(next)
      setMessage({ type: next.length ? 'ok' : 'error', text: next.length ? 'Candidatos encontrados. Revisa, edita e importa solo los correctos.' : 'No encontramos supermercados reales en ese radio.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSearching(false)
    }
  }

  async function loadRancaguaSupermarkets() {
    const nextForm = RANCAGUA_FORM
    setForm(nextForm)
    setSearching(true)
    setMessage(null)
    try {
      const point = await resolveOrigin(nextForm)
      const allPlaces = []
      for (const radius of [5000, 10000, 20000]) {
        // Small sequential batch to keep provider usage controlled.
        // eslint-disable-next-line no-await-in-loop
        const places = await searchRadius(radius, nextForm, point)
        allPlaces.push(...places)
      }
      const next = uniqueCandidates(allPlaces.map(place => candidateFromPlace(place, nextForm, point)))
      setCandidates(next)
      setMessage({ type: next.length ? 'ok' : 'error', text: next.length ? `Rancagua: ${next.length} candidatos listos para revisar.` : 'No encontramos candidatos para Rancagua.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSearching(false)
    }
  }

  function updateCandidate(id, patch) {
    setCandidates(prev => prev.map(candidate => {
      if (candidate.id !== id) return candidate
      const next = { ...candidate, ...patch }
      if (patch.city !== undefined || patch.commune !== undefined || patch.sector !== undefined) {
        next.sector = cleanSector(next.sector, next.city, next.commune)
      }
      if (patch.name !== undefined && !patch.chain_name) {
        next.chain_name = inferChain(next.name)
      }
      return next
    }))
  }

  async function insertStore(candidate) {
    const payload = {
      name: candidate.name.trim(),
      chain: candidate.chain_name.trim() || null,
      chain_name: candidate.chain_name.trim() || null,
      branch_name: candidate.branch_name.trim() || null,
      normalized_name: normalized(candidate.name),
      type: 'supermercado',
      store_type: 'supermercado',
      sector: cleanSector(candidate.sector, candidate.city, candidate.commune) || null,
      address: candidate.address.trim() || null,
      latitude: Number(candidate.latitude),
      longitude: Number(candidate.longitude),
      region: candidate.region.trim() || null,
      city: candidate.city.trim() || candidate.commune.trim() || null,
      commune: candidate.commune.trim() || candidate.city.trim() || null,
      external_source: candidate.external_source || null,
      external_id: candidate.external_id || null,
      place_id: candidate.place_id || candidate.external_id || null,
      source: candidate.external_source || null,
      location_source: candidate.external_source || 'admin',
      verification_status: candidate.is_verified ? 'verified' : 'pending',
      is_verified: Boolean(candidate.is_verified),
      is_active: true,
      updated_at: new Date().toISOString(),
    }

    let nextPayload = { ...payload }
    let result = null
    const optionalColumns = [
      'chain',
      'chain_name',
      'branch_name',
      'normalized_name',
      'type',
      'store_type',
      'region',
      'city',
      'commune',
      'sector',
      'latitude',
      'longitude',
      'external_source',
      'external_id',
      'place_id',
      'source',
      'location_source',
      'verification_status',
      'is_verified',
      'updated_at',
    ]

    for (let attempt = 0; attempt < optionalColumns.length + 1; attempt += 1) {
      result = await supabase.from('stores').insert(nextPayload).select('id').single()
      if (!result.error) return result

      const message = result.error.message || ''
      const missingColumn = optionalColumns.find(column => nextPayload[column] !== undefined && new RegExp(column, 'i').test(message))
      if (missingColumn && /(column|schema cache|could not find)/i.test(message)) {
        const { [missingColumn]: _removed, ...fallbackPayload } = nextPayload
        nextPayload = fallbackPayload
        continue
      }
      return result
    }

    return result
  }

  async function saveCandidate(candidate, force = false) {
    const duplicates = duplicateReasons(candidate, stores)
    if (duplicates.length && !force && !candidate.allowDuplicate) {
      updateCandidate(candidate.id, { selected: false })
      setMessage({ type: 'error', text: `${candidate.name} parece duplicado. Revisa la advertencia antes de importar.` })
      return
    }
    if (!candidate.name.trim() || !isValidCoordinate(candidate.latitude, candidate.longitude)) {
      setMessage({ type: 'error', text: 'Nombre y coordenadas validas son obligatorios.' })
      return
    }

    setSaving(true)
    const result = await insertStore(candidate)
    setSaving(false)
    if (result.error) {
      setMessage({ type: 'error', text: result.error.message })
      return
    }

    updateCandidate(candidate.id, { saved: true, selected: false })
    setMessage({ type: 'ok', text: `${candidate.name} importado como supermercado pendiente.` })
    await loadStores()
  }

  async function importSelected() {
    const selected = candidates.filter(candidate => candidate.selected && !candidate.rejected && !candidate.saved)
    if (!selected.length) {
      setMessage({ type: 'error', text: 'Selecciona al menos un candidato.' })
      return
    }
    setSaving(true)
    let savedCount = 0
    let skippedCount = 0
    for (const candidate of selected) {
      const duplicates = duplicateReasons(candidate, stores)
      if (duplicates.length && !candidate.allowDuplicate) {
        skippedCount += 1
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await insertStore(candidate)
      if (result.error) {
        skippedCount += 1
      } else {
        savedCount += 1
        updateCandidate(candidate.id, { saved: true, selected: false })
      }
    }
    setSaving(false)
    setMessage({ type: savedCount ? 'ok' : 'error', text: `${savedCount} importados. ${skippedCount} omitidos por duplicado o error.` })
    await loadStores()
  }

  async function verifyStore(store) {
    setSaving(true)
    const { error } = await supabase
      .from('stores')
      .update({ is_verified: true, verification_status: 'verified', updated_at: new Date().toISOString() })
      .eq('id', store.id)
    setSaving(false)
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'ok', text: 'Supermercado verificado.' })
      await loadStores()
    }
  }

  async function mergeStores(sourceId, targetId) {
    if (!window.confirm('Fusionar estos supermercados? Esta accion movera reportes al destino.')) return
    setSaving(true)
    const { error } = await supabase.rpc('merge_stores', { p_source_id: sourceId, p_target_id: targetId })
    setSaving(false)
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'ok', text: 'Duplicado fusionado.' })
      await loadStores()
    }
  }

  if (!isAdmin) {
    return <div className="rounded-3xl bg-white p-5 shadow-sm">Solo admins pueden importar, fusionar y verificar supermercados.</div>
  }

  return (
    <div className="space-y-5 pb-32">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-700 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-blue-100">EdePrecios</p>
        <h1 className="mt-2 text-2xl font-black">Registro de supermercados</h1>
        <p className="mt-2 text-sm text-blue-50">Busca supermercados reales por ciudad/comuna, revisa candidatos y guardalos sin duplicados.</p>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <form onSubmit={searchSupermarkets} className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">Buscar por ciudad/comuna</h2>
              <p className="mt-1 text-xs text-slate-500">Geoapify es el proveedor principal. Si no responde o no devuelve datos, se usa OSM como respaldo.</p>
            </div>
            <StatusPill tone="blue">{candidates.length} candidatos</StatusPill>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Region"><input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" /></Field>
            <Field label="Ciudad"><input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" /></Field>
            <Field label="Comuna"><input value={form.commune} onChange={e => setForm({ ...form, commune: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900" /></Field>
            <Field label="Radio"><select value={form.radius_m} onChange={e => setForm({ ...form, radius_m: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-normal text-slate-900">
              <option value="5000">5 km</option>
              <option value="10000">10 km</option>
              <option value="20000">20 km</option>
            </select></Field>
          </div>
          {origin && <p className="text-xs font-semibold text-slate-500">Centro de busqueda detectado por geocoding: {Number(origin.lat).toFixed(5)}, {Number(origin.lng).toFixed(5)}</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <button disabled={searching} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{searching ? 'Buscando...' : 'Buscar supermercados'}</button>
            <button type="button" onClick={loadRancaguaSupermarkets} disabled={searching} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Cargar supermercados de Rancagua</button>
            <button type="button" onClick={importSelected} disabled={saving || !candidates.some(candidate => candidate.selected)} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Importar seleccionados</button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        {candidates.map(candidate => {
          const duplicates = duplicateReasons(candidate, stores)
          const url = mapsUrl(candidate.latitude, candidate.longitude)
          return (
            <div key={candidate.id} className={`rounded-[2rem] border bg-white p-4 shadow-sm ${candidate.rejected ? 'border-slate-100 opacity-60' : duplicates.length ? 'border-amber-200' : 'border-slate-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-slate-900">{candidate.name || 'Sin nombre'}</p>
                    <StatusPill tone={candidate.saved ? 'green' : candidate.rejected ? 'slate' : duplicates.length ? 'amber' : 'blue'}>
                      {candidate.saved ? 'Importado' : candidate.rejected ? 'Rechazado' : duplicates.length ? 'Posible duplicado' : 'Nuevo'}
                    </StatusPill>
                    <StatusPill>{sourceLabel(candidate.source)}</StatusPill>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{candidate.address || 'Sin direccion'}{candidate.distance_m != null ? ` - ${formatDistance(candidate.distance_m)}` : ''}</p>
                  {duplicates.length > 0 && (
                    <div className="mt-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="font-black">Advertencia de duplicado</p>
                      {duplicates.slice(0, 3).map(duplicate => <p key={duplicate.store.id}>{duplicate.reason}: {duplicate.store.name}</p>)}
                      <label className="mt-2 flex items-center gap-2 font-bold">
                        <input type="checkbox" checked={candidate.allowDuplicate} onChange={e => updateCandidate(candidate.id, { allowDuplicate: e.target.checked })} />
                        Importar de todos modos
                      </label>
                    </div>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
                  <input type="checkbox" checked={candidate.selected} disabled={candidate.saved || candidate.rejected} onChange={e => updateCandidate(candidate.id, { selected: e.target.checked })} />
                  Seleccionar
                </label>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Field label="Nombre"><input value={candidate.name} onChange={e => updateCandidate(candidate.id, { name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></Field>
                <Field label="Cadena"><input value={candidate.chain_name} onChange={e => updateCandidate(candidate.id, { chain_name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" placeholder="Ej: Lider" /></Field>
                <Field label="Sucursal"><input value={candidate.branch_name} onChange={e => updateCandidate(candidate.id, { branch_name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></Field>
                <Field label="Direccion"><input value={candidate.address} onChange={e => updateCandidate(candidate.id, { address: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></Field>
                <Field label="Comuna"><input value={candidate.commune} onChange={e => updateCandidate(candidate.id, { commune: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></Field>
                <Field label="Sector"><input value={candidate.sector} onChange={e => updateCandidate(candidate.id, { sector: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" placeholder="Opcional" /></Field>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={saving || candidate.saved || candidate.rejected} onClick={() => saveCandidate(candidate)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Importar</button>
                {duplicates.length > 0 && <button type="button" disabled={saving || candidate.saved || candidate.rejected} onClick={() => saveCandidate(candidate, true)} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Importar igual</button>}
                <button type="button" disabled={candidate.saved} onClick={() => updateCandidate(candidate.id, { rejected: !candidate.rejected, selected: false })} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">{candidate.rejected ? 'Restaurar' : 'Rechazar'}</button>
                <label className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                  <input type="checkbox" checked={candidate.is_verified} onChange={e => updateCandidate(candidate.id, { is_verified: e.target.checked })} />
                  Marcar verificado
                </label>
                {url && <a href={url} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Ver mapa</a>}
              </div>
            </div>
          )
        })}
        {!searching && candidates.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">Busca una ciudad/comuna para revisar candidatos antes de guardar.</p>}
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Pendientes y duplicados existentes</h2>
            <p className="mt-1 text-xs text-slate-500">Solo admins pueden verificar y fusionar supermercados.</p>
          </div>
          <StatusPill tone="blue">{pendingSupermarkets.length} pendientes</StatusPill>
        </div>
        <div className="mt-3 grid gap-2">
          {pendingSupermarkets.slice(0, 8).map(store => (
            <div key={store.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{store.name}</p>
                <p className="truncate text-xs text-slate-500">{store.chain_name || store.chain || 'Sin cadena'} - {store.commune || 'Sin comuna'}</p>
              </div>
              <button type="button" onClick={() => verifyStore(store)} disabled={saving} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Verificar</button>
            </div>
          ))}
          {pendingSupermarkets.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No hay supermercados pendientes.</p>}
        </div>

        <div className="mt-5">
          <h3 className="font-black text-slate-900">Duplicados posibles</h3>
          <div className="mt-3 space-y-2">
            {duplicatePairs.map(pair => (
              <div key={`${pair.left.id}-${pair.right.id}`} className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-black">{pair.reason}</p>
                <p>{pair.left.name} - {pair.left.address || 'Sin direccion'}</p>
                <p>{pair.right.name} - {pair.right.address || 'Sin direccion'}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => mergeStores(pair.left.id, pair.right.id)} disabled={saving} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Fusionar primero en segundo</button>
                  <button type="button" onClick={() => mergeStores(pair.right.id, pair.left.id)} disabled={saving} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Fusionar segundo en primero</button>
                </div>
              </div>
            ))}
            {duplicatePairs.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No se detectaron duplicados de supermercados.</p>}
          </div>
        </div>
      </section>

      {loading && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">Cargando supermercados...</p>}
    </div>
  )
}
