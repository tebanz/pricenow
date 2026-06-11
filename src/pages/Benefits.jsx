import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function money(value) {
  return Number(value || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function statusLabel(value) {
  return {
    active: 'Activo',
    inactive: 'Inactivo',
    expired: 'Vencido',
  }[value] || value
}

export default function Benefits() {
  const { user, isValidator } = useAuth()
  const [wallet, setWallet] = useState(null)
  const [coupons, setCoupons] = useState([])
  const [redemptions, setRedemptions] = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    business_name: '',
    partner_id: '',
    points_cost: 100,
    discount_type: 'percent',
    discount_value: 10,
    conditions: '',
    expires_at: '',
    is_active: true,
  })

  async function load() {
    setLoading(true)
    const [walletRes, couponsRes, redemptionsRes, partnersRes] = await Promise.all([
      supabase.from('user_points').select('*').eq('user_id', user?.id).maybeSingle(),
      supabase.from('coupons').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('coupon_redemptions').select('*, coupons(title, business_name, points_cost)').eq('user_id', user?.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('business_partners').select('id, name, status').in('status', ['active', 'contacted']).order('name').limit(200),
    ])
    if (walletRes.error || couponsRes.error || redemptionsRes.error || partnersRes.error) {
      setMessage({ type: 'error', text: walletRes.error?.message || couponsRes.error?.message || redemptionsRes.error?.message || partnersRes.error?.message })
    }
    setWallet(walletRes.data || { balance: 0 })
    setCoupons(couponsRes.data || [])
    setRedemptions(redemptionsRes.data || [])
    setPartners(partnersRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.id])

  const availableCoupons = useMemo(() => coupons.filter(coupon => coupon.is_active !== false), [coupons])

  async function redeem(coupon) {
    setMessage(null)
    if (Number(wallet?.balance || 0) < Number(coupon.points_cost || 0)) {
      setMessage({ type: 'error', text: 'No tienes puntos suficientes para canjear este beneficio.' })
      return
    }
    const code = `PN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const { error } = await supabase.from('coupon_redemptions').insert({
      user_id: user.id,
      coupon_id: coupon.id,
      points_spent: coupon.points_cost,
      redemption_code: code,
      status: 'redeemed',
    })
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: `Cupón canjeado. Código: ${code}` })
    await load()
  }

  async function createCoupon(event) {
    event.preventDefault()
    setMessage(null)
    const partner = partners.find(item => item.id === form.partner_id)
    const payload = {
      title: form.title,
      description: form.description,
      business_name: partner?.name || form.business_name,
      points_cost: Number(form.points_cost || 0),
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value || 0),
      conditions: form.conditions,
      expires_at: form.expires_at || null,
      is_active: form.is_active,
      created_by: user?.id || null,
    }
    const { error } = await supabase.from('coupons').insert(payload)
    if (error) return setMessage({ type: 'error', text: error.message })
    setForm({ title: '', description: '', business_name: '', partner_id: '', points_cost: 100, discount_type: 'percent', discount_value: 10, conditions: '', expires_at: '', is_active: true })
    setMessage({ type: 'ok', text: 'Beneficio creado.' })
    await load()
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-fuchsia-100">PriceNow Club</p>
        <h1 className="mt-2 text-2xl font-black">Beneficios</h1>
        <p className="mt-2 text-sm text-fuchsia-50">Canjea tus puntos por descuentos, cupones y ventajas en negocios asociados.</p>
        <div className="mt-4 rounded-3xl bg-white/15 p-4 backdrop-blur">
          <p className="text-sm text-fuchsia-100">Puntos disponibles</p>
          <p className="text-3xl font-black">{wallet?.balance ?? 0}</p>
        </div>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      {isValidator && (
        <form onSubmit={createCoupon} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-black text-slate-900">Crear beneficio</h2>
          <div className="mt-3 grid gap-2">
            <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Título del beneficio" />
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="min-h-[80px] rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Descripción" />
            <select value={form.partner_id} onChange={e => setForm({ ...form, partner_id: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <option value="">Sin negocio asociado / escribir manual</option>
              {partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
            {!form.partner_id && <input value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Nombre del negocio" />}
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min="0" value={form.points_cost} onChange={e => setForm({ ...form, points_cost: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Puntos" />
              <select value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
                <option value="percent">%</option>
                <option value="amount">$</option>
                <option value="gift">Regalo</option>
              </select>
              <input type="number" min="0" value={form.discount_value} onChange={e => setForm({ ...form, discount_value: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Valor" />
            </div>
            <input type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" />
            <textarea value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} className="min-h-[70px] rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Condiciones del beneficio" />
            <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">Crear beneficio</button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="font-black text-slate-900">Cupones disponibles</h2>
        {loading && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">Cargando...</div>}
        {availableCoupons.length === 0 && !loading && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">Todavía no hay beneficios disponibles.</div>}
        {availableCoupons.map(coupon => (
          <div key={coupon.id} className="relative overflow-hidden rounded-[2rem] border border-violet-100 bg-white p-4 shadow-sm">
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-violet-100" />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-violet-500">{coupon.business_name || 'PriceNow'}</p>
                  <h3 className="mt-1 text-lg font-black text-slate-900">{coupon.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{coupon.description || 'Beneficio disponible para usuarios PriceNow.'}</p>
                </div>
                <div className="rounded-2xl bg-violet-50 px-3 py-2 text-center">
                  <p className="text-sm font-black text-violet-700">{coupon.points_cost || 0}</p>
                  <p className="text-[10px] font-bold text-violet-500">pts</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">{coupon.conditions || 'Sujeto a disponibilidad del negocio.'}</p>
                <button onClick={() => redeem(coupon)} className="rounded-2xl bg-violet-600 px-4 py-2 text-xs font-bold text-white">Canjear</button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-black text-slate-900">Mis canjes</h2>
        {redemptions.length === 0 && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">Aún no has canjeado beneficios.</div>}
        {redemptions.map(redemption => (
          <div key={redemption.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="font-black text-slate-900">{redemption.coupons?.title || 'Cupón'}</p>
            <p className="text-sm text-slate-500">Código: <span className="font-black text-slate-800">{redemption.redemption_code}</span></p>
            <p className="text-xs text-slate-400">Puntos usados: {redemption.points_spent || redemption.coupons?.points_cost || 0}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
