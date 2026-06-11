import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const UNIT_OPTIONS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'par', 'caja']
const STATUS_OPTIONS = ['pending', 'approved', 'rejected']

function normalize(text = '') {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function money(value) {
  const number = Number(value || 0)
  return number.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${tones[tone] || tones.slate}`}>{children}</span>
}

function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${active ? 'bg-slate-950 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-100'}`}
    >
      {children}
    </button>
  )
}

export default function DataQuality() {
  const { isValidator } = useAuth()
  const [tab, setTab] = useState('productos')
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [entries, setEntries] = useState([])
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [selectedSource, setSelectedSource] = useState('')
  const [selectedTarget, setSelectedTarget] = useState('')

  async function loadData() {
    setLoading(true)
    setMessage(null)
    const [productsRes, storesRes, entriesRes, flagsRes] = await Promise.all([
      supabase.from('products').select('*').order('name', { ascending: true }).limit(500),
      supabase.from('stores').select('*').order('name', { ascending: true }).limit(500),
      supabase
        .from('price_entries')
        .select('id, product_name, store_name, sector, price, quantity, unit, unit_price, validation_status, created_at, product_id, store_id')
        .order('created_at', { ascending: false })
        .limit(120),
      supabase.from('data_quality_flags').select('*').order('created_at', { ascending: false }).limit(80),
    ])

    if (productsRes.error || storesRes.error || entriesRes.error || flagsRes.error) {
      setMessage({ type: 'error', text: productsRes.error?.message || storesRes.error?.message || entriesRes.error?.message || flagsRes.error?.message })
    }

    setProducts(productsRes.data || [])
    setStores(storesRes.data || [])
    setEntries(entriesRes.data || [])
    setFlags(flagsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const activeProducts = useMemo(() => products.filter(p => p.is_active !== false && !p.merged_into), [products])
  const activeStores = useMemo(() => stores.filter(s => s.is_active !== false && !s.merged_into), [stores])

  const filteredProducts = useMemo(() => {
    const q = normalize(query)
    return activeProducts.filter(p => !q || normalize(`${p.name} ${p.category} ${p.subcategory} ${p.canonical_name}`).includes(q)).slice(0, 80)
  }, [activeProducts, query])

  const filteredStores = useMemo(() => {
    const q = normalize(query)
    return activeStores.filter(s => !q || normalize(`${s.name} ${s.chain} ${s.sector} ${s.address}`).includes(q)).slice(0, 80)
  }, [activeStores, query])

  const suspectEntries = useMemo(() => entries.filter(entry => {
    if (!entry.product_id) return true
    if (!entry.store_id) return true
    if (!entry.unit_price || Number(entry.unit_price) <= 0) return true
    if (Number(entry.price) > 1000000) return true
    if (Number(entry.quantity) <= 0) return true
    return false
  }), [entries])

  const possibleProductDuplicates = useMemo(() => {
    const groups = new Map()
    for (const p of activeProducts) {
      const key = normalize(p.name).split(' ').slice(0, 2).join(' ')
      if (!key) continue
      groups.set(key, [...(groups.get(key) || []), p])
    }
    return [...groups.values()].filter(group => group.length > 1).slice(0, 10)
  }, [activeProducts])

  const possibleStoreDuplicates = useMemo(() => {
    const groups = new Map()
    for (const s of activeStores) {
      const key = normalize(`${s.name} ${s.sector}`).split(' ').slice(0, 3).join(' ')
      if (!key) continue
      groups.set(key, [...(groups.get(key) || []), s])
    }
    return [...groups.values()].filter(group => group.length > 1).slice(0, 10)
  }, [activeStores])

  async function updateProduct(product, patch) {
    setSaving(true)
    setMessage(null)
    const { error } = await supabase
      .from('products')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', product.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Producto actualizado.' })
    await loadData()
  }

  async function updateStore(store, patch) {
    setSaving(true)
    setMessage(null)
    const { error } = await supabase
      .from('stores')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', store.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Negocio actualizado.' })
    await loadData()
  }

  async function merge(kind) {
    if (!selectedSource || !selectedTarget || selectedSource === selectedTarget) {
      setMessage({ type: 'error', text: 'Selecciona origen y destino diferentes.' })
      return
    }
    setSaving(true)
    setMessage(null)
    const fn = kind === 'producto' ? 'merge_products' : 'merge_stores'
    const params = kind === 'producto'
      ? { p_source_id: selectedSource, p_target_id: selectedTarget }
      : { p_source_id: selectedSource, p_target_id: selectedTarget }
    const { error } = await supabase.rpc(fn, params)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setSelectedSource('')
    setSelectedTarget('')
    setMessage({ type: 'ok', text: `${kind === 'producto' ? 'Producto' : 'Negocio'} fusionado correctamente.` })
    await loadData()
  }

  async function updateEntryStatus(entry, status) {
    setSaving(true)
    const patch = { validation_status: status }
    if (status === 'approved') patch.validated_at = new Date().toISOString()
    const { error } = await supabase.from('price_entries').update(patch).eq('id', entry.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Reporte actualizado.' })
    await loadData()
  }

  if (!isValidator) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Calidad de datos</h1>
        <p className="mt-2 text-sm text-slate-500">Solo administradores o validadores pueden entrar a esta sección.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-200">Admin</p>
        <h1 className="mt-2 text-2xl font-black">Calidad de datos</h1>
        <p className="mt-2 text-sm text-slate-200">Corrige productos, negocios duplicados y reportes que afectan ranking, reportes y beneficios.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{activeProducts.length}</p><p className="text-[11px] text-slate-300">Productos</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{activeStores.length}</p><p className="text-[11px] text-slate-300">Negocios</p></div>
          <div className="rounded-2xl bg-white/10 p-3"><p className="text-lg font-black">{suspectEntries.length}</p><p className="text-[11px] text-slate-300">Alertas</p></div>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Tab active={tab === 'productos'} onClick={() => setTab('productos')}>Productos</Tab>
        <Tab active={tab === 'negocios'} onClick={() => setTab('negocios')}>Negocios</Tab>
        <Tab active={tab === 'reportes'} onClick={() => setTab('reportes')}>Reportes</Tab>
        <Tab active={tab === 'sugerencias'} onClick={() => setTab('sugerencias')}>Duplicados</Tab>
      </div>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
          {message.text}
        </div>
      )}

      <input
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Buscar por nombre, sector o categoría..."
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
      />

      {loading ? (
        <div className="rounded-3xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Cargando datos...</div>
      ) : null}

      {tab === 'productos' && (
        <section className="space-y-3">
          <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Fusionar productos duplicados</h2>
            <p className="mt-1 text-xs text-slate-500">El origen se desactiva y sus reportes pasan al destino.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={selectedSource} onChange={e => setSelectedSource(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">Producto origen</option>
                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">Producto destino correcto</option>
                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button disabled={saving} onClick={() => merge('producto')} className="mt-3 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Fusionar producto</button>
          </div>

          {filteredProducts.map(product => (
            <ProductCard key={product.id} product={product} saving={saving} onSave={updateProduct} />
          ))}
        </section>
      )}

      {tab === 'negocios' && (
        <section className="space-y-3">
          <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Fusionar negocios duplicados</h2>
            <p className="mt-1 text-xs text-slate-500">Útil cuando el mismo supermercado aparece dos veces con distintas distancias.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={selectedSource} onChange={e => setSelectedSource(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">Negocio duplicado</option>
                {activeStores.map(s => <option key={s.id} value={s.id}>{s.name} · {s.sector}</option>)}
              </select>
              <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                <option value="">Negocio correcto</option>
                {activeStores.map(s => <option key={s.id} value={s.id}>{s.name} · {s.sector}</option>)}
              </select>
            </div>
            <button disabled={saving} onClick={() => merge('negocio')} className="mt-3 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Fusionar negocio</button>
          </div>

          {filteredStores.map(store => <StoreCard key={store.id} store={store} saving={saving} onSave={updateStore} />)}
        </section>
      )}

      {tab === 'reportes' && (
        <section className="space-y-3">
          <h2 className="font-black text-slate-900">Reportes que necesitan revisión</h2>
          {suspectEntries.length === 0 && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">No hay alertas graves por ahora.</div>}
          {suspectEntries.map(entry => (
            <div key={entry.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-900">{entry.product_name}</h3>
                  <p className="text-sm text-slate-500">{entry.store_name} · {entry.sector}</p>
                  <p className="mt-1 text-xs text-slate-400">{money(entry.price)} · {entry.quantity} {entry.unit} · unitario {money(entry.unit_price)}</p>
                </div>
                <Badge tone={entry.validation_status === 'approved' ? 'green' : entry.validation_status === 'rejected' ? 'red' : 'amber'}>{entry.validation_status}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(status => (
                  <button key={status} onClick={() => updateEntryStatus(entry, status)} className="rounded-xl border border-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">{status}</button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'sugerencias' && (
        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Posibles productos duplicados</h2>
            <div className="mt-3 space-y-2">
              {possibleProductDuplicates.length === 0 && <p className="text-sm text-slate-500">No hay grupos obvios.</p>}
              {possibleProductDuplicates.map((group, index) => (
                <div key={index} className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                  {group.map(p => p.name).join(' · ')}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="font-black text-slate-900">Posibles negocios duplicados</h2>
            <div className="mt-3 space-y-2">
              {possibleStoreDuplicates.length === 0 && <p className="text-sm text-slate-500">No hay grupos obvios.</p>}
              {possibleStoreDuplicates.map((group, index) => (
                <div key={index} className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                  {group.map(s => `${s.name} (${s.sector})`).join(' · ')}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function ProductCard({ product, saving, onSave }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: product.name || '',
    category: product.category || '',
    subcategory: product.subcategory || '',
    default_unit: product.default_unit || 'unidad',
  })

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-slate-900">{product.name}</h3>
          <p className="text-sm text-slate-500">{product.category || 'Sin categoría'} · {product.default_unit || 'unidad'}</p>
          <p className="mt-1 text-[11px] text-slate-400">{product.canonical_name || product.normalized_key}</p>
        </div>
        <button onClick={() => setEditing(!editing)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{editing ? 'Cerrar' : 'Editar'}</button>
      </div>
      {editing && (
        <div className="mt-4 grid gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Nombre" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Categoría" />
            <select value={form.default_unit} onChange={e => setForm({ ...form, default_unit: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
              {UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </div>
          <button disabled={saving} onClick={() => onSave(product, form)} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar producto</button>
        </div>
      )}
    </div>
  )
}

function StoreCard({ store, saving, onSave }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: store.name || '',
    chain: store.chain || '',
    sector: store.sector || '',
    address: store.address || '',
    latitude: store.latitude || '',
    longitude: store.longitude || '',
  })

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-slate-900">{store.name}</h3>
          <p className="text-sm text-slate-500">{store.sector || 'Sin sector'} · {store.chain || 'Independiente'}</p>
          <p className="mt-1 text-[11px] text-slate-400">{store.address || 'Sin dirección'} {store.latitude && store.longitude ? `· ${store.latitude}, ${store.longitude}` : ''}</p>
        </div>
        <button onClick={() => setEditing(!editing)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{editing ? 'Cerrar' : 'Editar'}</button>
      </div>
      {editing && (
        <div className="mt-4 grid gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Nombre" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.chain} onChange={e => setForm({ ...form, chain: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Cadena" />
            <input value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Sector" />
          </div>
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Dirección" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Latitud" />
            <input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Longitud" />
          </div>
          <button disabled={saving} onClick={() => onSave(store, {
            ...form,
            latitude: form.latitude === '' ? null : Number(form.latitude),
            longitude: form.longitude === '' ? null : Number(form.longitude),
          })} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar negocio</button>
        </div>
      )}
    </div>
  )
}
