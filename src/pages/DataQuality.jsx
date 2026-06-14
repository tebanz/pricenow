import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const UNITS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'par', 'caja']
const LOCATION_FIELDS = [
  ['region', 'Region'],
  ['city', 'Ciudad'],
  ['commune', 'Comuna'],
  ['sector', 'Sector'],
]
const KNOWN_SECTOR_NAMES = new Set([
  'centro',
  'manzanal',
  'el tenis',
  'manso de velasco',
  'san francisco',
  'rene schneider',
  'villa triana',
  'los lirios',
  'recreo',
  'la compania',
  'la compana',
])

function normalize(text = '') {
  return text.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function sim(a, b) {
  const A = new Set(normalize(a).split(' ').filter(Boolean))
  const B = new Set(normalize(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let same = 0
  A.forEach(x => { if (B.has(x)) same += 1 })
  return same / Math.max(A.size, B.size)
}

function hasCoords(row) {
  if (row?.latitude == null || row?.longitude == null) return false
  if (String(row.latitude).trim() === '' || String(row.longitude).trim() === '') return false
  const lat = Number(row.latitude)
  const lng = Number(row.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

function Field({ label, children }) {
  return <label className="grid gap-1 text-xs font-bold text-slate-500">{label}{children}</label>
}

function Pill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${tones[tone]}`}>{children}</span>
}

function LocationChanges({ current, proposed }) {
  return (
    <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 text-xs">
      {LOCATION_FIELDS.map(([field, label]) => (
        <div key={field} className="grid gap-1 sm:grid-cols-[90px_1fr]">
          <span className="font-black uppercase tracking-wide text-slate-400">{label}</span>
          <span className="text-slate-700">
            <span className="font-semibold">{current[field] || 'Sin dato'}</span>
            <span className="mx-2 text-slate-400">-&gt;</span>
            <span className={`font-black ${current[field] === proposed[field] ? 'text-slate-500' : 'text-blue-700'}`}>{proposed[field] || 'Sin dato'}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function isRecent(value) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return Date.now() - date.getTime() < 14 * 24 * 60 * 60 * 1000
}

function productIssues(product, usageCount = 0) {
  const issues = []
  if (isRecent(product.created_at)) issues.push('nuevo')
  if (!product.category || normalize(product.category) === 'otros' || normalize(product.category) === 'sin categoria') issues.push('categoria')
  if (!product.default_unit) issues.push('unidad')
  if (normalize(product.name).split(' ').length <= 1) issues.push('nombre corto')
  if (usageCount <= 1) issues.push('pocos reportes')
  return issues
}

function storeIssues(store, usageCount = 0) {
  const issues = []
  if (!hasCoords(store)) issues.push('sin coordenadas')
  if (!store.sector || normalize(store.sector) === 'sin sector') issues.push('sin sector')
  if (!store.address) issues.push('sin direccion')
  if (!store.is_verified) issues.push('sin verificar')
  if (usageCount <= 1) issues.push('pocos reportes')
  return issues
}

function territorialReviewIssue(row) {
  const city = normalize(row.city)
  const commune = normalize(row.commune)
  const sector = normalize(row.sector)
  const cityLooksLikeSector = city && KNOWN_SECTOR_NAMES.has(city)
  const cityEqualsSector = city && sector && city === sector

  if (cityLooksLikeSector && (!commune || !sector || cityEqualsSector)) return 'La ciudad parece ser un sector o poblacion.'
  if (cityEqualsSector && (!commune || commune !== city)) return 'Ciudad y sector tienen el mismo valor.'
  return null
}

function territorialLabel(row) {
  return [row.region, row.city, row.commune, row.sector].filter(Boolean).join(' - ') || 'Sin ubicacion territorial'
}

function itemKey(item) {
  return `${item.source_table || item.sourceTable}-${item.source_id || item.sourceId || item.row?.id}`
}

function cleanLocationValue(value) {
  if (value == null) return null
  const text = value.toString().trim()
  if (!text) return null
  const normalized = normalize(text)
  if (['otro', 'otro no aparece mi sector', 'sin sector', 'sin ubicacion', 'sin ubicacion territorial'].includes(normalized)) return null
  return text
}

function sanitizeLocationPatch(raw = {}) {
  const region = cleanLocationValue(raw.region || raw.state)
  const city = cleanLocationValue(raw.city || raw.town || raw.locality)
  const commune = cleanLocationValue(raw.commune || raw.municipality)
  let sector = cleanLocationValue(raw.sector || raw.suburb || raw.district || raw.neighbourhood)

  if (sector && city && normalize(sector) === normalize(city)) sector = null
  if (sector && commune && normalize(sector) === normalize(commune)) sector = null

  return { region, city, commune, sector }
}

function hasLocationValues(values = {}) {
  return Boolean(values.region || values.city || values.commune || values.sector)
}

function valuesEqual(a = {}, b = {}) {
  return ['region', 'city', 'commune', 'sector'].every(field => (a[field] || '') === (b[field] || ''))
}

function coordinateInfo(row = {}) {
  const candidates = [
    ['latitude', 'longitude'],
    ['lat', 'lng'],
    ['purchase_latitude', 'purchase_longitude'],
  ]
  for (const [latKey, lngKey] of candidates) {
    if (hasCoords({ latitude: row[latKey], longitude: row[lngKey] })) {
      return { lat: Number(row[latKey]), lng: Number(row[lngKey]), latKey, lngKey }
    }
  }
  return null
}

function currentLocationValues(row = {}) {
  return {
    region: cleanLocationValue(row.region),
    city: cleanLocationValue(row.city),
    commune: cleanLocationValue(row.commune),
    sector: cleanLocationValue(row.sector),
  }
}

function locationSourceLabel(source) {
  if (source === 'reverse_geocode') return 'GPS / Geoapify'
  if (source === 'store') return 'Negocio corregido'
  if (source === 'manual') return 'Edicion manual'
  return 'Sin propuesta'
}

function buildUsage(entries, field) {
  return entries.reduce((acc, entry) => {
    const id = entry[field]
    if (!id) return acc
    acc[id] = (acc[id] || 0) + 1
    return acc
  }, {})
}

function duplicatePairs(items, getText, minScore = 0.62) {
  const pairs = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i]
      const right = items[j]
      const a = normalize(getText(left))
      const b = normalize(getText(right))
      if (!a || !b) continue
      const score = sim(a, b)
      const contains = a.length > 5 && b.length > 5 && (a.includes(b) || b.includes(a))
      if (score >= minScore || contains) pairs.push({ left, right, score: Math.max(score, contains ? 0.74 : score) })
    }
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 30)
}

export default function DataQuality() {
  const { isValidator, user } = useAuth()
  const [tab, setTab] = useState('reportes')
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [entries, setEntries] = useState([])
  const [territorialReview, setTerritorialReview] = useState([])
  const [territorialDrafts, setTerritorialDrafts] = useState({})
  const [ignoredTerritorialItems, setIgnoredTerritorialItems] = useState({})
  const [territorialBusyKey, setTerritorialBusyKey] = useState(null)
  const [territorialBatchLoading, setTerritorialBatchLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mergeDraft, setMergeDraft] = useState(null)

  async function load() {
    setLoading(true)
    const [p, s, e, t] = await Promise.all([
      supabase.from('products').select('*').order('name').limit(900),
      supabase.from('stores').select('*').order('name').limit(900),
      supabase.from('price_entries').select('*').order('created_at', { ascending: false }).limit(240),
      supabase.from('territorial_location_review').select('*').limit(200),
    ])
    if (p.error || s.error || e.error) setMessage({ type: 'error', text: p.error?.message || s.error?.message || e.error?.message })
    if (t.error) console.warn('PriceNow territorial review view unavailable:', t.error.message)
    setProducts(p.data || [])
    setStores(s.data || [])
    setEntries(e.data || [])
    setTerritorialReview(t.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const activeProducts = products.filter(p => p.is_active !== false && !p.merged_into)
  const activeStores = stores.filter(s => s.is_active !== false && !s.merged_into)
  const productUsage = useMemo(() => buildUsage(entries, 'product_id'), [entries])
  const storeUsage = useMemo(() => buildUsage(entries, 'store_id'), [entries])

  const suspectEntries = useMemo(() => entries.filter(entry => {
    if (query && !normalize(`${entry.product_name} ${entry.store_name} ${entry.sector}`).includes(normalize(query))) return false
    if (!entry.product_id || !entry.store_id) return true
    if (!entry.unit_price || Number(entry.unit_price) <= 0) return true
    const product = activeProducts.find(p => p.id === entry.product_id)
    if (product?.default_unit && product.default_unit !== entry.unit && ['kg','litro','unidad'].includes(product.default_unit)) return true
    return false
  }), [entries, activeProducts, query])

  const suspectProducts = useMemo(() => {
    const q = normalize(query)
    return activeProducts
      .map(product => ({ product, issues: productIssues(product, productUsage[product.id] || 0) }))
      .filter(row => q ? normalize(`${row.product.name} ${row.product.category} ${row.product.default_unit}`).includes(q) : row.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length || a.product.name.localeCompare(b.product.name))
      .slice(0, 100)
  }, [activeProducts, productUsage, query])

  const storesForQuality = useMemo(() => {
    const q = normalize(query)
    return activeStores
      .map(store => ({ store, issues: storeIssues(store, storeUsage[store.id] || 0) }))
      .filter(row => q ? normalize(`${row.store.name} ${row.store.sector} ${row.store.address} ${row.store.type}`).includes(q) : row.issues.includes('sin coordenadas'))
      .sort((a, b) => b.issues.length - a.issues.length || a.store.name.localeCompare(b.store.name))
      .slice(0, 120)
  }, [activeStores, storeUsage, query])

  const productDuplicates = useMemo(() => duplicatePairs(activeProducts, p => `${p.name} ${p.category || ''}`, 0.67), [activeProducts])
  const storeDuplicates = useMemo(() => duplicatePairs(activeStores, s => `${s.name} ${s.sector || ''} ${s.address || ''}`, 0.6), [activeStores])
  const territorialIssues = useMemo(() => {
    const q = normalize(query)
    const fromView = territorialReview.map(viewRow => {
      const isStore = viewRow.source_table === 'stores'
      const row = isStore
        ? activeStores.find(store => String(store.id) === String(viewRow.source_id)) || viewRow
        : entries.find(entry => String(entry.id) === String(viewRow.source_id)) || viewRow
      return {
        kind: isStore ? 'Negocio' : 'Reporte',
        sourceTable: viewRow.source_table,
        sourceId: viewRow.source_id,
        label: viewRow.label || (isStore ? row.name : `${row.product_name || 'Producto'} en ${row.store_name || 'tienda'}`),
        row,
        issue: viewRow.issue || territorialReviewIssue(row) || 'Ubicacion territorial para revisar.',
      }
    })
    const fallbackRows = [
      ...entries.map(entry => ({ kind: 'Reporte', sourceTable: 'price_entries', sourceId: entry.id, label: `${entry.product_name || 'Producto'} en ${entry.store_name || 'tienda'}`, row: entry })),
      ...activeStores.map(store => ({ kind: 'Negocio', sourceTable: 'stores', sourceId: store.id, label: store.name || 'Negocio sin nombre', row: store })),
    ]
      .map(item => ({ ...item, issue: territorialReviewIssue(item.row) }))
      .filter(item => item.issue)
    const rows = fromView.length ? fromView : fallbackRows
    return rows
      .filter(item => !ignoredTerritorialItems[itemKey(item)])
      .filter(item => q ? normalize(`${item.kind} ${item.label} ${territorialLabel(item.row)} ${item.issue}`).includes(q) : true)
      .slice(0, 120)
  }, [territorialReview, entries, activeStores, ignoredTerritorialItems, query])

  function productSuggestion(entry) {
    return activeProducts.map(p => ({ ...p, score: sim(entry.product_name, p.name) })).sort((a, b) => b.score - a.score)[0]
  }

  function storeSuggestion(entry) {
    return activeStores.map(s => ({ ...s, score: sim(`${entry.store_name} ${entry.sector}`, `${s.name} ${s.sector}`) })).sort((a, b) => b.score - a.score)[0]
  }

  async function applySuggestions(entry) {
    const product = productSuggestion(entry)
    const store = storeSuggestion(entry)
    const patch = {}
    if (product?.score >= 0.34) {
      patch.product_id = product.id
      patch.product_name = product.name
      patch.unit = product.default_unit || entry.unit
    }
    if (store?.score >= 0.34) {
      patch.store_id = store.id
      patch.store_name = store.name
      patch.sector = store.sector || entry.sector
    }
    if (!Object.keys(patch).length) return setMessage({ type: 'error', text: 'No hay sugerencias suficientemente parecidas.' })
    setSaving(true)
    const { error } = await supabase.from('price_entries').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', entry.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Sugerencias aplicadas al reporte.' })
    await load()
  }

  async function updateProduct(product, patch) {
    setSaving(true)
    const { error } = await supabase.from('products').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', product.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Producto actualizado.' })
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

  async function reverseLocationFromCoords(coords) {
    const response = await fetch(`/api/reverse-geocode?${new URLSearchParams({ lat: String(coords.lat), lng: String(coords.lng) }).toString()}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar la ubicacion.')
    return sanitizeLocationPatch(data.zone || {})
  }

  async function getFullTerritorialRow(item) {
    if (item.row?.id) return item.row
    const { data, error } = await supabase
      .from(item.sourceTable)
      .select('*')
      .eq('id', item.sourceId)
      .maybeSingle()
    if (error) throw error
    return data || item.row || {}
  }

  function storeLocationForEntry(entry) {
    if (!entry?.store_id) return null
    const store = activeStores.find(item => String(item.id) === String(entry.store_id))
    if (!store) return null
    const values = sanitizeLocationPatch(store)
    if (!hasLocationValues(values)) return null
    if (territorialReviewIssue(values)) return null
    return { store, values }
  }

  async function buildTerritorialProposal(item) {
    const row = await getFullTerritorialRow(item)
    if (item.sourceTable === 'price_entries') {
      const linkedStore = storeLocationForEntry(row)
      if (linkedStore) {
        return {
          proposed: linkedStore.values,
          source: 'store',
          note: `Heredado desde negocio corregido: ${linkedStore.store.name || linkedStore.store.id}.`,
        }
      }
    }

    const coords = coordinateInfo(row)
    if (!coords) {
      return {
        proposed: currentLocationValues(row),
        source: 'manual',
        note: 'Sin store corregido ni coordenadas validas. Requiere revision manual.',
        editing: true,
      }
    }

    const proposed = await reverseLocationFromCoords(coords)
    return {
      proposed,
      source: 'reverse_geocode',
      note: `Propuesto desde ${coords.latKey}/${coords.lngKey}.`,
      coords,
      editing: false,
    }
  }

  async function proposeTerritorialLocation(item) {
    const key = itemKey(item)
    setTerritorialBusyKey(key)
    setMessage(null)
    try {
      const draft = await buildTerritorialProposal(item)
      if (!hasLocationValues(draft.proposed)) {
        setMessage({ type: 'error', text: 'No hay datos suficientes para proponer ubicacion. Edita manualmente o ignora por ahora.' })
      }
      setTerritorialDrafts(prev => ({ ...prev, [key]: draft }))
    } catch (err) {
      console.error('PriceNow territorial proposal failed:', err)
      setMessage({ type: 'error', text: err.message || 'No se pudo proponer ubicacion.' })
    } finally {
      setTerritorialBusyKey(null)
    }
  }

  async function proposeTerritorialBatch() {
    const pending = territorialIssues
      .filter(item => !territorialDrafts[itemKey(item)])
      .slice(0, 5)
    if (!pending.length) return

    setTerritorialBatchLoading(true)
    for (const item of pending) {
      // Sequential and small on purpose: avoids bursts against Geoapify.
      // eslint-disable-next-line no-await-in-loop
      await proposeTerritorialLocation(item)
    }
    setTerritorialBatchLoading(false)
  }

  function startManualTerritorialEdit(item) {
    const key = itemKey(item)
    setTerritorialDrafts(prev => ({
      ...prev,
      [key]: {
        proposed: prev[key]?.proposed || currentLocationValues(item.row),
        source: 'manual',
        note: 'Editado manualmente.',
        editing: true,
      },
    }))
  }

  function updateTerritorialDraft(item, field, value) {
    const key = itemKey(item)
    const previousDraft = territorialDrafts[key] || {}
    const baseProposal = previousDraft.proposed || currentLocationValues(item.row)
    setTerritorialDrafts(prev => ({
      ...prev,
      [key]: {
        ...previousDraft,
        source: 'manual',
        note: 'Editado manualmente.',
        editing: true,
        proposed: sanitizeLocationPatch({
          ...baseProposal,
          [field]: value,
        }),
      },
    }))
  }

  async function logTerritorialCorrection(item, action, proposedValues = {}, appliedValues = null) {
    const payload = {
      source_table: item.sourceTable,
      source_id: String(item.sourceId),
      action,
      previous_values: currentLocationValues(item.row),
      proposed_values: proposedValues || {},
      applied_values: appliedValues,
      issue: item.issue || null,
      created_by: user?.id || null,
    }
    const { error } = await supabase.from('territorial_corrections').insert(payload)
    if (error) console.warn('PriceNow territorial audit skipped:', error.message)
  }

  async function applyTerritorialCorrection(item) {
    const key = itemKey(item)
    const draft = territorialDrafts[key]
    const proposed = sanitizeLocationPatch(draft?.proposed || {})
    if (!hasLocationValues(proposed)) {
      setMessage({ type: 'error', text: 'No hay una propuesta valida para aplicar.' })
      return
    }

    setTerritorialBusyKey(key)
    setSaving(true)
    setMessage(null)
    const patch = { ...proposed, updated_at: new Date().toISOString() }
    const { error } = await supabase.from(item.sourceTable).update(patch).eq('id', item.sourceId)
    if (!error) await logTerritorialCorrection(item, 'applied', proposed, proposed)
    setSaving(false)
    setTerritorialBusyKey(null)

    if (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }

    setTerritorialDrafts(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setMessage({ type: 'ok', text: 'Correccion territorial aplicada.' })
    await load()
  }

  async function ignoreTerritorialItem(item) {
    const key = itemKey(item)
    setIgnoredTerritorialItems(prev => ({ ...prev, [key]: true }))
    await logTerritorialCorrection(item, 'ignored', {}, null)
  }

  function prepareMerge(kind, left, right) {
    const usage = kind === 'producto' ? productUsage : storeUsage
    const leftCount = usage[left.id] || 0
    const rightCount = usage[right.id] || 0
    const source = leftCount > rightCount ? right : left
    const target = leftCount > rightCount ? left : right
    setMergeDraft({ kind, source, target })
  }

  async function mergePrepared() {
    if (!mergeDraft?.source?.id || !mergeDraft?.target?.id || mergeDraft.source.id === mergeDraft.target.id) {
      setMessage({ type: 'error', text: 'Selecciona origen y destino diferentes.' })
      return
    }

    const ok = window.confirm(`Fusionar "${mergeDraft.source.name}" dentro de "${mergeDraft.target.name}"?`)
    if (!ok) return

    setSaving(true)
    const fn = mergeDraft.kind === 'producto' ? 'merge_products' : 'merge_stores'
    const { error } = await supabase.rpc(fn, {
      p_source_id: mergeDraft.source.id,
      p_target_id: mergeDraft.target.id,
    })
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: `${mergeDraft.kind === 'producto' ? 'Producto' : 'Negocio'} fusionado.` })
    setMergeDraft(null)
    await load()
  }

  if (!isValidator) return <div className="rounded-3xl bg-white p-5 shadow-sm">Solo administradores o validadores.</div>

  return (
    <div className="space-y-5 pb-32">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-blue-700 to-indigo-600 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-100">Admin</p>
        <h1 className="mt-2 text-2xl font-black">Calidad de datos</h1>
        <p className="mt-2 text-sm text-blue-50">Corrige productos nuevos, negocios sin coordenadas, posibles duplicados y reportes que no aparecen bien.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{suspectProducts.length}</p><p className="text-[11px] text-blue-100">productos</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{storesForQuality.length}</p><p className="text-[11px] text-blue-100">sin coords</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{productDuplicates.length + storeDuplicates.length}</p><p className="text-[11px] text-blue-100">parecidos</p></div>
        </div>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <div className="grid grid-cols-5 gap-2 rounded-2xl bg-slate-100 p-1 text-xs font-black">
        {['reportes','productos','negocios','duplicados','territorio'].map(item => <button key={item} onClick={() => setTab(item)} className={`rounded-xl py-2 ${tab === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>{item}</button>)}
      </div>

      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar..." className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />

      {loading && <div className="rounded-3xl bg-white p-6 text-center text-sm text-slate-500">Cargando...</div>}

      {tab === 'reportes' && (
        <section className="space-y-3">
          {suspectEntries.map(entry => {
            const ps = productSuggestion(entry)
            const ss = storeSuggestion(entry)
            return (
              <div key={entry.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">{entry.product_name}</p>
                    <p className="text-xs text-slate-500">{entry.store_name} · {entry.sector} · {entry.validation_status}</p>
                  </div>
                  <Pill tone="amber">revisar</Pill>
                </div>
                <div className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 text-sm">
                  <p><b>Producto sugerido:</b> {ps?.score >= 0.34 ? `${ps.name} (${Math.round(ps.score * 100)}%)` : 'Sin sugerencia clara'}</p>
                  <p><b>Negocio sugerido:</b> {ss?.score >= 0.34 ? `${ss.name} · ${ss.sector} (${Math.round(ss.score * 100)}%)` : 'Sin sugerencia clara'}</p>
                </div>
                <button disabled={saving} onClick={() => applySuggestions(entry)} className="mt-3 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">Aplicar sugerencias</button>
              </div>
            )
          })}
          {suspectEntries.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">No hay reportes sospechosos con ese filtro.</p>}
        </section>
      )}

      {tab === 'productos' && (
        <section className="space-y-3">
          {suspectProducts.map(({ product, issues }) => (
            <div key={product.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-900">{product.name}</p>
                  <p className="text-xs text-slate-500">{product.category || 'Sin categoria'} · {product.default_unit || 'Sin unidad'} · {productUsage[product.id] || 0} reportes</p>
                </div>
                <div className="flex max-w-[45%] flex-wrap justify-end gap-1">
                  {issues.map(issue => <Pill key={issue} tone={issue === 'nuevo' ? 'blue' : 'amber'}>{issue}</Pill>)}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Categoria"><input defaultValue={product.category || ''} onBlur={e => e.target.value !== (product.category || '') && updateProduct(product, { category: e.target.value || 'Sin categoria' })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></Field>
                <Field label="Unidad estandar"><select defaultValue={product.default_unit || 'unidad'} onChange={e => updateProduct(product, { default_unit: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></Field>
              </div>
            </div>
          ))}
          {suspectProducts.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">No hay productos nuevos o sospechosos con ese filtro.</p>}
        </section>
      )}

      {tab === 'negocios' && (
        <section className="space-y-3">
          <Link to="/local-map" className="block rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Abrir administrador de negocios y coordenadas</Link>
          {storesForQuality.map(({ store, issues }) => (
            <div key={store.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-900">{store.name}</p>
                  <p className="text-xs text-slate-500">{store.sector || 'Sin sector'} · {store.address || 'Sin direccion'} · {storeUsage[store.id] || 0} reportes</p>
                </div>
                <div className="flex max-w-[45%] flex-wrap justify-end gap-1">
                  {issues.map(issue => <Pill key={issue} tone={issue === 'sin coordenadas' ? 'red' : 'amber'}>{issue}</Pill>)}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input defaultValue={store.latitude || ''} onBlur={e => updateStore(store, { latitude: e.target.value ? Number(e.target.value) : null, location_source: e.target.value ? 'admin_quality' : store.location_source })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Latitud" />
                <input defaultValue={store.longitude || ''} onBlur={e => updateStore(store, { longitude: e.target.value ? Number(e.target.value) : null, location_source: e.target.value ? 'admin_quality' : store.location_source })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Longitud" />
              </div>
              <button disabled={saving} onClick={() => updateStore(store, { is_verified: !store.is_verified })} className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-black disabled:opacity-50 ${store.is_verified ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-600 text-white'}`}>
                {store.is_verified ? 'Marcado como verificado' : 'Marcar como verificado'}
              </button>
            </div>
          ))}
          {storesForQuality.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">No hay negocios sin coordenadas o con ese filtro.</p>}
        </section>
      )}

      {tab === 'territorio' && (
        <section className="space-y-3">
          <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-black">Ubicacion territorial para revisar</p>
            <p className="mt-1">Estos registros vienen de territorial_location_review. PriceNow propone correcciones con coordenadas o negocio corregido, pero nunca inventa ubicacion.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={proposeTerritorialBatch} disabled={territorialBatchLoading || territorialIssues.length === 0} className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white disabled:opacity-50">
              {territorialBatchLoading ? 'Proponiendo...' : 'Proponer lote pequeno'}
            </button>
            <Link to="/local-map" className="block rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Abrir administrador territorial</Link>
          </div>
          {territorialIssues.map(item => {
            const key = itemKey(item)
            const current = currentLocationValues(item.row)
            const draft = territorialDrafts[key]
            const proposed = sanitizeLocationPatch(draft?.proposed || {})
            const coords = coordinateInfo(item.row)
            const canApply = hasLocationValues(proposed) && !valuesEqual(current, proposed)
            const busy = territorialBusyKey === key
            return (
              <div key={key} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">{item.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.kind} - {territorialLabel(item.row)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {coords ? `Coordenadas: ${coords.latKey}/${coords.lngKey}` : 'Sin coordenadas validas'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone="amber">revisar</Pill>
                    {draft && <Pill tone={draft.source === 'manual' ? 'blue' : 'green'}>{locationSourceLabel(draft.source)}</Pill>}
                  </div>
                </div>
                <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{item.issue}</p>

                {draft ? (
                  <div className="mt-3 space-y-3">
                    <LocationChanges current={current} proposed={proposed} />
                    {draft.note && <p className="text-xs font-semibold text-slate-500">{draft.note}</p>}
                    {draft.editing && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {LOCATION_FIELDS.map(([field, label]) => (
                          <Field key={field} label={label}>
                            <input
                              value={proposed[field] || ''}
                              onChange={event => updateTerritorialDraft(item, field, event.target.value)}
                              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                              placeholder={field === 'sector' ? 'Opcional' : label}
                            />
                          </Field>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
                    Presiona "Proponer ubicacion" para consultar coordenadas o heredar desde el negocio corregido.
                  </div>
                )}

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <button type="button" onClick={() => proposeTerritorialLocation(item)} disabled={busy || territorialBatchLoading} className="rounded-2xl bg-blue-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">
                    {busy ? 'Revisando...' : 'Proponer ubicacion'}
                  </button>
                  <button type="button" onClick={() => applyTerritorialCorrection(item)} disabled={busy || saving || !canApply} className="rounded-2xl bg-emerald-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">
                    Aplicar correccion
                  </button>
                  <button type="button" onClick={() => startManualTerritorialEdit(item)} disabled={busy} className="rounded-2xl bg-slate-100 px-3 py-3 text-xs font-black text-slate-700 disabled:opacity-50">
                    Editar manualmente
                  </button>
                  <button type="button" onClick={() => ignoreTerritorialItem(item)} disabled={busy} className="rounded-2xl bg-amber-50 px-3 py-3 text-xs font-black text-amber-700 disabled:opacity-50">
                    Ignorar por ahora
                  </button>
                </div>
              </div>
            )
          })}
          {territorialIssues.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">No hay ubicaciones territoriales sospechosas con ese filtro.</p>}
        </section>
      )}

      {tab === 'duplicados' && (
        <section className="space-y-4">
          {mergeDraft && (
            <div className="rounded-[2rem] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-black">Fusion preparada</p>
              <p className="mt-1">Origen: <b>{mergeDraft.source.name}</b></p>
              <p>Destino: <b>{mergeDraft.target.name}</b></p>
              <p className="mt-1 text-xs text-blue-800">Los reportes del origen pasaran al destino y el origen quedara inactivo.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setMergeDraft(prev => ({ ...prev, source: prev.target, target: prev.source }))} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-700">Invertir</button>
                <button type="button" onClick={() => setMergeDraft(null)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-600">Cancelar</button>
                <button disabled={saving} type="button" onClick={mergePrepared} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Fusionar</button>
              </div>
            </div>
          )}

          <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Negocios duplicados o parecidos</h2>
            <p className="mt-1 text-xs text-slate-500">Prepara la fusion y revisa origen/destino antes de confirmarla.</p>
            <div className="mt-3 space-y-2">
              {storeDuplicates.map(pair => (
                <div key={`store-${pair.left.id}-${pair.right.id}`} className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{pair.left.name}</p>
                      <p className="text-xs text-slate-500">{pair.left.sector || 'Sin sector'} · {pair.left.address || 'Sin direccion'}</p>
                      <p className="mt-2 font-bold text-slate-900">{pair.right.name}</p>
                      <p className="text-xs text-slate-500">{pair.right.sector || 'Sin sector'} · {pair.right.address || 'Sin direccion'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Pill tone="amber">{Math.round(pair.score * 100)}%</Pill>
                      <button type="button" onClick={() => prepareMerge('negocio', pair.left, pair.right)} className="mt-2 block rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Preparar fusion</button>
                    </div>
                  </div>
                </div>
              ))}
              {storeDuplicates.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No se detectaron negocios parecidos.</p>}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Productos duplicados o parecidos</h2>
            <div className="mt-3 space-y-2">
              {productDuplicates.map(pair => (
                <div key={`product-${pair.left.id}-${pair.right.id}`} className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{pair.left.name}</p>
                      <p className="text-xs text-slate-500">{pair.left.category || 'Sin categoria'} · {pair.left.default_unit || 'unidad'}</p>
                      <p className="mt-2 font-bold text-slate-900">{pair.right.name}</p>
                      <p className="text-xs text-slate-500">{pair.right.category || 'Sin categoria'} · {pair.right.default_unit || 'unidad'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Pill tone="amber">{Math.round(pair.score * 100)}%</Pill>
                      <button type="button" onClick={() => prepareMerge('producto', pair.left, pair.right)} className="mt-2 block rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Preparar fusion</button>
                    </div>
                  </div>
                </div>
              ))}
              {productDuplicates.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No se detectaron productos parecidos.</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
