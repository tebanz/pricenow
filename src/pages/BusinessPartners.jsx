import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS = [
  ['prospect', 'Prospecto'],
  ['contacted', 'Contactado'],
  ['active', 'Activo'],
  ['paused', 'Pausado'],
  ['rejected', 'Descartado'],
]

const PLANS = [
  ['basic', 'Básico'],
  ['marketing', 'Marketing'],
  ['intelligence', 'Inteligencia comercial'],
  ['advisory', 'Asesoría financiera'],
]

function statusStyle(status) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700'
  if (status === 'contacted') return 'bg-blue-50 text-blue-700'
  if (status === 'paused') return 'bg-amber-50 text-amber-700'
  if (status === 'rejected') return 'bg-red-50 text-red-700'
  return 'bg-slate-100 text-slate-600'
}

export default function BusinessPartners() {
  const { user, isValidator } = useAuth()
  const [partners, setPartners] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState({
    store_id: '',
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    sector: '',
    address: '',
    status: 'prospect',
    marketing_plan: 'basic',
    notes: '',
  })

  async function load() {
    setLoading(true)
    const [partnersRes, storesRes] = await Promise.all([
      supabase.from('business_partners').select('*, stores(name, sector, address)').order('created_at', { ascending: false }).limit(200),
      supabase.from('stores').select('id, name, sector, address').eq('is_active', true).order('name', { ascending: true }).limit(300),
    ])
    if (partnersRes.error || storesRes.error) {
      setMessage({ type: 'error', text: partnersRes.error?.message || storesRes.error?.message })
    }
    setPartners(partnersRes.data || [])
    setStores(storesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return partners.filter(partner => !q || `${partner.name} ${partner.sector} ${partner.status} ${partner.marketing_plan}`.toLowerCase().includes(q))
  }, [partners, query])

  function selectStore(storeId) {
    const store = stores.find(item => item.id === storeId)
    setForm(prev => ({
      ...prev,
      store_id: storeId,
      name: store?.name || prev.name,
      sector: store?.sector || prev.sector,
      address: store?.address || prev.address,
    }))
  }

  async function savePartner(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const payload = {
      ...form,
      store_id: form.store_id || null,
      created_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('business_partners').insert(payload)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setForm({ store_id: '', name: '', contact_name: '', phone: '', email: '', sector: '', address: '', status: 'prospect', marketing_plan: 'basic', notes: '' })
    setMessage({ type: 'ok', text: 'Negocio asociado guardado.' })
    await load()
  }

  async function updatePartner(id, patch) {
    setSaving(true)
    const { error } = await supabase.from('business_partners').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Negocio actualizado.' })
    await load()
  }

  if (!isValidator) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Negocios asociados</h1>
        <p className="mt-2 text-sm text-slate-500">Solo administradores o validadores pueden entrar a esta sección.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-100">Comercial</p>
        <h1 className="mt-2 text-2xl font-black">Negocios asociados</h1>
        <p className="mt-2 text-sm text-blue-50">Organiza acuerdos, contactos, cupones futuros y servicios de marketing o asesoría.</p>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <form onSubmit={savePartner} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="font-black text-slate-900">Agregar negocio</h2>
        <div className="mt-3 grid gap-2">
          <select value={form.store_id} onChange={e => selectStore(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
            <option value="">Vincular tienda existente opcional</option>
            {stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.sector}</option>)}
          </select>
          <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Nombre del negocio" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Contacto" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Teléfono" />
          </div>
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Email" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Sector" />
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              {STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <select value={form.marketing_plan} onChange={e => setForm({ ...form, marketing_plan: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
            {PLANS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="min-h-[90px] rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Notas: acuerdo, próxima reunión, propuesta comercial..." />
          <button disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Guardar negocio</button>
        </div>
      </form>

      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar negocio, estado o plan..." className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" />

      {loading && <div className="rounded-3xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Cargando...</div>}

      <div className="space-y-3">
        {filtered.map(partner => (
          <div key={partner.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-slate-900">{partner.name}</h3>
                <p className="text-sm text-slate-500">{partner.sector || 'Sin sector'} · {partner.contact_name || 'Sin contacto'}</p>
                <p className="mt-1 text-xs text-slate-400">{partner.phone || partner.email || 'Sin datos de contacto'}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusStyle(partner.status)}`}>{STATUS.find(([v]) => v === partner.status)?.[1] || partner.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUS.map(([value, label]) => (
                <button key={value} onClick={() => updatePartner(partner.id, { status: value })} className="rounded-xl border border-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">{label}</button>
              ))}
            </div>
            <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
              Plan: {PLANS.find(([v]) => v === partner.marketing_plan)?.[1] || partner.marketing_plan}. {partner.notes || 'Sin notas.'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
