import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/UI/Spinner'

function formatDate(value) {
  if (!value) return 'Sin fecha límite'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusLabel(status) {
  const map = {
    redeemed: 'Canjeado',
    used: 'Usado',
    cancelled: 'Cancelado',
    expired: 'Vencido',
  }
  return map[status] || status
}

function EmptyState({ title, text }) {
  return (
    <div className="card text-center py-8">
      <p className="text-3xl mb-2">🎁</p>
      <p className="font-bold text-slate-800">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{text}</p>
    </div>
  )
}

function CouponCard({ coupon, balance, onRedeem, loading }) {
  const business = coupon.business_partners
  const enoughPoints = balance >= coupon.points_cost
  const availableUntil = coupon.end_date ? `Hasta ${formatDate(coupon.end_date)}` : 'Sin fecha límite'

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-600 truncate">
            {business?.name || 'Beneficio PriceNow'}
          </p>
          <h3 className="font-black text-slate-900 leading-tight mt-1">{coupon.title}</h3>
          <p className="text-sm text-slate-500 mt-1">{coupon.description || 'Beneficio disponible para usuarios PriceNow.'}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-block rounded-full bg-success-50 text-success-600 px-3 py-1 text-xs font-black">
            {coupon.discount_label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-slate-400">Costo</p>
          <p className="font-black text-slate-900 text-base">{coupon.points_cost} pts</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-slate-400">Vigencia</p>
          <p className="font-bold text-slate-700">{availableUntil}</p>
        </div>
      </div>

      {coupon.terms && (
        <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-2xl p-3">
          Condiciones: {coupon.terms}
        </p>
      )}

      <button
        type="button"
        disabled={!enoughPoints || loading}
        onClick={() => onRedeem(coupon)}
        className={`w-full rounded-2xl py-3 font-bold transition-colors ${
          enoughPoints
            ? 'bg-brand-500 text-white hover:bg-brand-600'
            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
        }`}
      >
        {loading ? 'Canjeando...' : enoughPoints ? 'Canjear beneficio' : 'Puntos insuficientes'}
      </button>
    </div>
  )
}

function AdminCouponForm({ onCreated }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [form, setForm] = useState({
    businessName: '',
    sector: '',
    address: '',
    title: '',
    description: '',
    discountLabel: '',
    pointsCost: 100,
    terms: '',
    endDate: '',
    maxRedemptions: '',
  })

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)

    const businessName = form.businessName.trim()
    const title = form.title.trim()
    const discountLabel = form.discountLabel.trim()

    if (!businessName || !title || !discountLabel) {
      setMessage({ type: 'error', text: 'Completa negocio, título y descuento.' })
      setSaving(false)
      return
    }

    const { data: business, error: businessError } = await supabase
      .from('business_partners')
      .insert({
        name: businessName,
        sector: form.sector.trim() || null,
        address: form.address.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (businessError) {
      setMessage({ type: 'error', text: businessError.message })
      setSaving(false)
      return
    }

    const { error: couponError } = await supabase
      .from('coupons')
      .insert({
        business_id: business.id,
        title,
        description: form.description.trim() || null,
        discount_label: discountLabel,
        points_cost: Number(form.pointsCost) || 0,
        terms: form.terms.trim() || null,
        end_date: form.endDate || null,
        max_redemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        created_by: user.id,
      })

    if (couponError) {
      setMessage({ type: 'error', text: couponError.message })
    } else {
      setMessage({ type: 'success', text: 'Beneficio creado correctamente.' })
      setForm({
        businessName: '',
        sector: '',
        address: '',
        title: '',
        description: '',
        discountLabel: '',
        pointsCost: 100,
        terms: '',
        endDate: '',
        maxRedemptions: '',
      })
      onCreated?.()
    }

    setSaving(false)
  }

  return (
    <section className="card">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h3 className="font-bold text-slate-900">Crear beneficio</h3>
          <p className="text-xs text-slate-500 mt-0.5">Disponible solo para admin/validadores.</p>
        </div>
        <span className="text-brand-500 font-black">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="space-y-3 mt-4">
          <input className="input" placeholder="Nombre del negocio" value={form.businessName} onChange={e => updateField('businessName', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Sector" value={form.sector} onChange={e => updateField('sector', e.target.value)} />
            <input className="input" placeholder="Dirección" value={form.address} onChange={e => updateField('address', e.target.value)} />
          </div>
          <input className="input" placeholder="Título del beneficio" value={form.title} onChange={e => updateField('title', e.target.value)} />
          <textarea className="input min-h-[84px]" placeholder="Descripción" value={form.description} onChange={e => updateField('description', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Ej: 10% descuento" value={form.discountLabel} onChange={e => updateField('discountLabel', e.target.value)} />
            <input className="input" type="number" min="0" placeholder="Costo puntos" value={form.pointsCost} onChange={e => updateField('pointsCost', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" type="date" value={form.endDate} onChange={e => updateField('endDate', e.target.value)} />
            <input className="input" type="number" min="1" placeholder="Máx. canjes" value={form.maxRedemptions} onChange={e => updateField('maxRedemptions', e.target.value)} />
          </div>
          <textarea className="input min-h-[72px]" placeholder="Condiciones del beneficio" value={form.terms} onChange={e => updateField('terms', e.target.value)} />

          {message && (
            <p className={`text-sm ${message.type === 'error' ? 'text-danger-600' : 'text-success-600'}`}>
              {message.text}
            </p>
          )}

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? 'Guardando...' : 'Guardar beneficio'}
          </button>
        </form>
      )}
    </section>
  )
}

export default function Benefits() {
  const { user, isValidator } = useAuth()
  const [wallet, setWallet] = useState(null)
  const [coupons, setCoupons] = useState([])
  const [redemptions, setRedemptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [redeemingId, setRedeemingId] = useState(null)
  const [notice, setNotice] = useState(null)

  async function loadBenefits() {
    setLoading(true)

    const [walletResult, couponsResult, redemptionsResult] = await Promise.all([
      supabase.from('user_points').select('*').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('coupons')
        .select('*, business_partners(name, sector, address)')
        .eq('is_active', true)
        .lte('start_date', new Date().toISOString().slice(0, 10))
        .order('points_cost', { ascending: true }),
      supabase
        .from('coupon_redemptions')
        .select('*, coupons(title, discount_label, business_partners(name))')
        .eq('user_id', user.id)
        .order('redeemed_at', { ascending: false })
        .limit(20),
    ])

    const today = new Date().toISOString().slice(0, 10)
    const availableCoupons = (couponsResult.data || []).filter(coupon => !coupon.end_date || coupon.end_date >= today)

    setWallet(walletResult.data || { current_points: 0, lifetime_points: 0 })
    setCoupons(availableCoupons)
    setRedemptions(redemptionsResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadBenefits()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function handleRedeem(coupon) {
    setRedeemingId(coupon.id)
    setNotice(null)

    const { data, error } = await supabase.rpc('redeem_coupon', { p_coupon_id: coupon.id })

    if (error) {
      setNotice({ type: 'error', text: error.message })
    } else if (data?.ok) {
      setNotice({ type: 'success', text: `${data.message} Código: ${data.code}` })
      await loadBenefits()
    } else {
      setNotice({ type: 'error', text: data?.message || 'No se pudo canjear el beneficio.' })
    }

    setRedeemingId(null)
  }

  const balance = wallet?.current_points || 0
  const redeemedCodes = useMemo(() => redemptions.filter(item => item.status === 'redeemed'), [redemptions])

  if (loading) return <Spinner />

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Beneficios</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Canjea puntos por descuentos reales cuando existan negocios asociados.
        </p>
      </div>

      <section className="rounded-3xl p-5 bg-brand-500 text-white shadow-sm">
        <p className="text-sm text-white/80">Puntos disponibles</p>
        <p className="text-4xl font-black mt-1">{balance}</p>
        <p className="text-xs text-white/75 mt-2">
          Puntos históricos ganados: {wallet?.lifetime_points || 0}
        </p>
      </section>

      {notice && (
        <div className={`rounded-2xl p-4 border ${notice.type === 'error' ? 'border-danger-200 bg-danger-50 text-danger-600' : 'border-success-200 bg-success-50 text-success-600'}`}>
          <p className="text-sm font-semibold">{notice.text}</p>
        </div>
      )}

      {isValidator && <AdminCouponForm onCreated={loadBenefits} />}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900">Cupones disponibles</h3>
          <span className="text-xs text-slate-400">{coupons.length}</span>
        </div>

        {coupons.length === 0 ? (
          <EmptyState
            title="Aún no hay beneficios activos"
            text="Cuando cierres acuerdos con negocios, aparecerán aquí para canjearlos con puntos."
          />
        ) : (
          coupons.map(coupon => (
            <CouponCard
              key={coupon.id}
              coupon={coupon}
              balance={balance}
              loading={redeemingId === coupon.id}
              onRedeem={handleRedeem}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-slate-900">Mis canjes</h3>
        {redeemedCodes.length === 0 ? (
          <div className="card">
            <p className="text-sm text-slate-500">Todavía no has canjeado beneficios.</p>
          </div>
        ) : (
          redeemedCodes.map(item => (
            <div key={item.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 text-sm truncate">{item.coupons?.title || 'Beneficio'}</p>
                <p className="text-xs text-slate-400 truncate">{item.coupons?.business_partners?.name || 'PriceNow'} · {statusLabel(item.status)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-brand-600 tracking-wider">{item.code}</p>
                <p className="text-[11px] text-slate-400">-{item.points_spent} pts</p>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
