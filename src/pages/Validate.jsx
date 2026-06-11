import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

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

function money(value) {
  return Number(value || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

export default function Validate() {
  const { user, isValidator } = useAuth()
  const [tab, setTab] = useState('pending')
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  async function load() {
    setLoading(true)
    setMessage(null)

    const [entriesRes, productsRes, storesRes] = await Promise.all([
      // No usamos embedding profiles(username) porque price_entries tiene más de una relación con profiles
      // (user_id y validated_by). Eso genera error PGRST201 en Supabase.
      supabase.from('price_entries').select('*').order('created_at', { ascending: false }).limit(150),
      supabase.from('products').select('*').eq('is_active', true).limit(700),
      supabase.from('stores').select('*').eq('is_active', true).limit(700),
    ])

    if (entriesRes.error || productsRes.error || storesRes.error) {
      setMessage({ type: 'error', text: entriesRes.error?.message || productsRes.error?.message || storesRes.error?.message })
      setEntries([])
      setProducts([])
      setStores([])
      setLoading(false)
      return
    }

    const rawEntries = entriesRes.data || []
    const userIds = [...new Set(rawEntries.map(entry => entry.user_id).filter(Boolean))]
    let profileMap = {}

    if (userIds.length) {
      const { data: profileRows, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds)

      if (!profilesError) {
        profileMap = Object.fromEntries((profileRows || []).map(row => [row.id, row.username]))
      }
    }

    setEntries(rawEntries.map(entry => ({
      ...entry,
      profile_username: profileMap[entry.user_id] || 'usuario',
    })))
    setProducts(productsRes.data || [])
    setStores(storesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => entries.filter(e => tab === 'all' || e.validation_status === tab), [entries, tab])

  function suggestions(entry) {
    const product = products.map(p => ({ ...p, score: sim(entry.product_name, p.name) })).sort((a, b) => b.score - a.score)[0]
    const store = stores.map(s => ({ ...s, score: sim(`${entry.store_name} ${entry.sector}`, `${s.name} ${s.sector}`) })).sort((a, b) => b.score - a.score)[0]
    return { product, store }
  }

  async function approve(entry, apply = false) {
    const { product, store } = suggestions(entry)
    const patch = { validation_status: 'approved', validated_by: user?.id || null, validated_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (apply && product?.score >= 0.34) {
      patch.product_id = product.id
      patch.product_name = product.name
      patch.unit = product.default_unit || entry.unit
    }
    if (apply && store?.score >= 0.34) {
      patch.store_id = store.id
      patch.store_name = store.name
      patch.sector = store.sector || entry.sector
    }
    setSaving(true)
    const { error } = await supabase.from('price_entries').update(patch).eq('id', entry.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: apply ? 'Reporte aprobado con correcciones.' : 'Reporte aprobado.' })
    await load()
  }

  async function reject(entry) {
    const reason = window.prompt('Motivo del rechazo:', 'Dato incorrecto o incompleto')
    if (reason === null) return
    setSaving(true)
    const { error } = await supabase.from('price_entries').update({ validation_status: 'rejected', rejection_reason: reason, validated_by: user?.id || null, validated_at: new Date().toISOString() }).eq('id', entry.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Reporte rechazado.' })
    await load()
  }

  if (!isValidator) return <div className="rounded-3xl bg-white p-5 shadow-sm">Solo admin o validador puede entrar.</div>

  return (
    <div className="space-y-5 pb-32">
      <section className="rounded-[2rem] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Validación inteligente</h1>
            <p className="mt-1 text-sm text-slate-500">Aprueba, corrige productos mal escritos y asocia negocios reales antes de guardar datos definitivos.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{filtered.length} registros</span>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-slate-100 p-1 text-xs font-black">
          {['pending','approved','rejected','all'].map(item => <button key={item} onClick={() => setTab(item)} className={`rounded-xl py-2 ${tab === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>{item === 'pending' ? 'Pendientes' : item === 'approved' ? 'Aprobadas' : item === 'rejected' ? 'Rechazadas' : 'Todas'}</button>)}
        </div>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}
      {loading && <div className="rounded-3xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Cargando...</div>}

      <div className="space-y-3">
        {filtered.map(entry => {
          const { product, store } = suggestions(entry)
          return (
            <div key={entry.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-slate-900">{entry.product_name} {entry.brand && <span className="font-normal text-slate-400">· {entry.brand}</span>}</h2>
                  <p className="text-xs text-slate-500">por @{entry.profile_username || 'usuario'} · {entry.purchase_date}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${entry.validation_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : entry.validation_status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{entry.validation_status}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Precio</p><b>{money(entry.price)}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Unitario</p><b>{money(entry.unit_price)} / {entry.unit}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Cantidad</p><b>{entry.quantity} {entry.unit}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Tienda</p><b>{entry.store_name}</b></div>
              </div>

              <div className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm text-blue-800">
                <p><b>Producto sugerido:</b> {product?.score >= 0.34 ? `${product.name} · ${product.default_unit} (${Math.round(product.score * 100)}%)` : 'Sin sugerencia clara'}</p>
                <p className="mt-1"><b>Negocio sugerido:</b> {store?.score >= 0.34 ? `${store.name} · ${store.sector} (${Math.round(store.score * 100)}%)` : 'Sin sugerencia clara'}</p>
              </div>

              {entry.validation_status === 'pending' && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button disabled={saving} onClick={() => approve(entry, true)} className="rounded-2xl bg-blue-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Aprobar corrigiendo</button>
                  <button disabled={saving} onClick={() => approve(entry, false)} className="rounded-2xl bg-emerald-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Aprobar</button>
                  <button disabled={saving} onClick={() => reject(entry)} className="rounded-2xl bg-red-50 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Rechazar</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
