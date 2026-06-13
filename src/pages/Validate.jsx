import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { calcUnitPrice } from '../utils/priceCalc'
import { calculateDiscountFinalPrice, DISCOUNT_TYPES, effectivePrice, hasOffer, paymentConditionLabel, PAYMENT_METHODS, paymentMethodLabel } from '../utils/discounts'

const UNITS = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'par', 'caja']
const OPTIONAL_DISCOUNT_COLUMNS = [
  'has_discount',
  'normal_price',
  'final_price',
  'discount_type',
  'discount_amount',
  'discount_percentage',
  'promotion_description',
  'payment_method',
  'payment_condition',
  'requires_specific_payment_method',
  'baes_eligibility_status',
]

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

function hasCoords(row) {
  return row?.latitude != null && row?.longitude != null && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
}

function reportHasCoords(entry) {
  return entry?.purchase_latitude != null && entry?.purchase_longitude != null && Number.isFinite(Number(entry.purchase_latitude)) && Number.isFinite(Number(entry.purchase_longitude))
}

function formatCoords(lat, lng) {
  if (lat == null || lng == null) return 'Sin coordenadas'
  return `${Number(lat).toFixed(7)}, ${Number(lng).toFixed(7)}`
}

function storedDiscountValue(entry) {
  if (entry.discount_type === 'porcentaje') return entry.discount_percentage ?? ''
  if (entry.discount_type === 'precio_promocional') return entry.final_price ?? ''
  return entry.discount_amount ?? ''
}

function SuggestionLine({ label, value, action }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-blue-50 p-3 text-sm text-blue-900">
      <p><b>{label}:</b> {value}</p>
      {action}
    </div>
  )
}

export default function Validate() {
  const { user, isValidator } = useAuth()
  const [tab, setTab] = useState('pending')
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [corrections, setCorrections] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  async function load() {
    setLoading(true)
    setMessage(null)

    const [entriesRes, productsRes, storesRes] = await Promise.all([
      // No usamos embeds con profiles: price_entries puede apuntar a profiles por user_id y validated_by.
      supabase.from('price_entries').select('*').order('created_at', { ascending: false }).limit(180),
      supabase.from('products').select('*').eq('is_active', true).limit(900),
      supabase.from('stores').select('*').eq('is_active', true).limit(900),
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
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds)

      profileMap = Object.fromEntries((profileRows || []).map(row => [row.id, row.username]))
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
    const product = products
      .map(p => ({ ...p, score: sim(entry.product_name, `${p.name} ${p.category || ''} ${p.subcategory || ''}`) }))
      .sort((a, b) => b.score - a.score)[0]
    const store = stores
      .map(s => ({ ...s, score: sim(`${entry.store_name} ${entry.sector}`, `${s.name} ${s.sector || ''} ${s.address || ''}`) }))
      .sort((a, b) => b.score - a.score)[0]
    return { product, store }
  }

  function updateCorrection(entryId, patch) {
    setCorrections(prev => ({ ...prev, [entryId]: { ...(prev[entryId] || {}), ...patch } }))
  }

  function draftFor(entry, product, store) {
    const current = corrections[entry.id] || {}
    const productSuggestion = product?.score >= 0.34 ? product : null
    const storeSuggestion = store?.score >= 0.34 ? store : null
    const hasDiscount = current.has_discount ?? Boolean(entry.has_discount)
    const discountType = current.discount_type ?? entry.discount_type ?? 'monto'
    const discountValue = current.discount_value ?? storedDiscountValue(entry)
    const normalPrice = current.normal_price ?? entry.normal_price ?? entry.price
    const finalPrice = hasDiscount
      ? calculateDiscountFinalPrice(normalPrice, discountType, discountValue)
      : effectivePrice(entry)
    return {
      product_name: current.product_name ?? productSuggestion?.name ?? entry.product_name,
      unit: current.unit ?? productSuggestion?.default_unit ?? entry.unit,
      store_name: current.store_name ?? storeSuggestion?.name ?? entry.store_name,
      sector: current.sector ?? storeSuggestion?.sector ?? entry.sector,
      has_discount: hasDiscount,
      normal_price: normalPrice ?? '',
      discount_type: discountType,
      discount_value: discountValue,
      final_price: current.final_price ?? finalPrice,
      promotion_description: current.promotion_description ?? entry.promotion_description ?? '',
      payment_method: current.payment_method ?? entry.payment_method ?? 'efectivo',
      requires_specific_payment_method: current.requires_specific_payment_method ?? Boolean(entry.requires_specific_payment_method),
      payment_condition: current.payment_condition ?? entry.payment_condition ?? '',
      baes_eligibility_status: current.baes_eligibility_status ?? entry.baes_eligibility_status ?? '',
    }
  }

  function targetStoreForCoords(entry, suggestedStore) {
    if (entry.store_id) {
      const byId = stores.find(store => store.id === entry.store_id)
      if (byId) return byId
    }
    if (suggestedStore?.score >= 0.34) return suggestedStore
    return null
  }

  async function updatePriceEntry(entryId, patch) {
    let nextPatch = { ...patch }
    let result = null

    for (let attempt = 0; attempt < OPTIONAL_DISCOUNT_COLUMNS.length + 1; attempt += 1) {
      result = await supabase.from('price_entries').update(nextPatch).eq('id', entryId)
      if (!result.error) return result

      const message = result.error.message || ''
      const missingColumn = OPTIONAL_DISCOUNT_COLUMNS.find(column => nextPatch[column] !== undefined && new RegExp(column, 'i').test(message))
      if (!missingColumn || !/(column|schema cache|could not find)/i.test(message)) return result

      const { [missingColumn]: _removed, ...fallbackPatch } = nextPatch
      nextPatch = fallbackPatch
    }

    return result
  }

  async function approve(entry, mode = 'raw') {
    const { product, store } = suggestions(entry)
    const draft = draftFor(entry, product, store)
    const patch = {
      validation_status: 'approved',
      validated_by: user?.id || null,
      validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (mode === 'corrected') {
      patch.product_name = draft.product_name.trim()
      patch.unit = draft.unit || entry.unit
      patch.store_name = draft.store_name.trim()
      patch.sector = draft.sector.trim() || entry.sector
      patch.has_discount = Boolean(draft.has_discount)
      patch.normal_price = draft.has_discount ? Number(draft.normal_price || entry.price) : null
      patch.final_price = draft.has_discount ? calculateDiscountFinalPrice(draft.normal_price || entry.price, draft.discount_type, draft.discount_value) : null
      patch.price = draft.has_discount ? Number(draft.normal_price || entry.price) : Number(entry.price)
      patch.unit_price = calcUnitPrice(draft.has_discount ? patch.final_price : patch.price, entry.quantity, patch.unit)
      patch.discount_type = draft.has_discount ? draft.discount_type : null
      patch.discount_amount = draft.has_discount && draft.discount_type === 'monto' ? Number(draft.discount_value) : null
      patch.discount_percentage = draft.has_discount && draft.discount_type === 'porcentaje' ? Number(draft.discount_value) : null
      patch.promotion_description = draft.has_discount ? draft.promotion_description.trim() || null : null
      patch.payment_method = draft.payment_method || null
      patch.requires_specific_payment_method = Boolean(draft.requires_specific_payment_method)
      patch.payment_condition = draft.requires_specific_payment_method ? draft.payment_condition.trim() || paymentMethodLabel(draft.payment_method) : null
      patch.baes_eligibility_status = draft.payment_method === 'junaeb_baes' ? 'eligible' : draft.baes_eligibility_status || null

      if (product?.score >= 0.34 && normalize(draft.product_name) === normalize(product.name)) {
        patch.product_id = product.id
      }
      if (store?.score >= 0.34 && normalize(draft.store_name) === normalize(store.name)) {
        patch.store_id = store.id
      }
    }

    setSaving(true)
    const { error } = await updatePriceEntry(entry.id, patch)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setCorrections(prev => {
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    setMessage({ type: 'ok', text: mode === 'corrected' ? 'Reporte aprobado con correcciones.' : 'Reporte aprobado.' })
    await load()
  }

  async function saveReportCoordsToStore(entry, store) {
    if (!store?.id || !reportHasCoords(entry)) return
    const ok = window.confirm(`Guardar coordenadas del reporte en ${store.name}?`)
    if (!ok) return
    setSaving(true)
    const { error } = await supabase
      .from('stores')
      .update({
        latitude: Number(entry.purchase_latitude),
        longitude: Number(entry.purchase_longitude),
        location_source: 'validated_price_entry',
        is_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', store.id)
    setSaving(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Coordenadas guardadas en el negocio.' })
    await load()
  }

  async function reject(entry) {
    const reason = window.prompt('Motivo del rechazo:', 'Dato incorrecto o incompleto')
    if (reason === null) return
    setSaving(true)
    const { error } = await supabase
      .from('price_entries')
      .update({
        validation_status: 'rejected',
        rejection_reason: reason,
        validated_by: user?.id || null,
        validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
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
            <h1 className="text-2xl font-black text-slate-900">Validacion inteligente</h1>
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
          const draft = draftFor(entry, product, store)
          const productSuggestion = product?.score >= 0.34 ? `${product.name} · ${product.default_unit || 'unidad'} (${Math.round(product.score * 100)}%)` : 'Sin sugerencia clara'
          const storeSuggestion = store?.score >= 0.34 ? `${store.name} · ${store.sector || 'Sin sector'} (${Math.round(store.score * 100)}%)` : 'Sin sugerencia clara'
          const coordsStore = targetStoreForCoords(entry, store)
          const canSaveCoords = coordsStore && !hasCoords(coordsStore) && reportHasCoords(entry)

          return (
            <div key={entry.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-black text-slate-900">{entry.product_name} {entry.brand && <span className="font-normal text-slate-400">· {entry.brand}</span>}</h2>
                  <p className="text-xs text-slate-500">por @{entry.profile_username || 'usuario'} · {entry.purchase_date}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${entry.validation_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : entry.validation_status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{entry.validation_status}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-400">Precio usado</p>
                  <b>{money(effectivePrice(entry))}</b>
                  {hasOffer(entry) && <p className="mt-1 text-[11px] font-black text-emerald-700">Oferta{entry.normal_price || entry.price ? ` · normal ${money(entry.normal_price || entry.price)}` : ''}</p>}
                  {paymentConditionLabel(entry) && <p className="mt-1 text-[11px] font-semibold text-blue-700">Con {paymentConditionLabel(entry)}</p>}
                </div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Unitario</p><b>{money(entry.unit_price)} / {entry.unit}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Producto escrito</p><b>{entry.product_name}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Negocio escrito</p><b>{entry.store_name}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Cantidad</p><b>{entry.quantity} {entry.unit}</b></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Ubicacion reporte</p><b>{reportHasCoords(entry) ? formatCoords(entry.purchase_latitude, entry.purchase_longitude) : 'Sin coordenadas'}</b></div>
              </div>

              <div className="mt-3 grid gap-2">
                <SuggestionLine
                  label="Producto sugerido"
                  value={productSuggestion}
                  action={product?.score >= 0.34 && <button type="button" onClick={() => updateCorrection(entry.id, { product_name: product.name, unit: product.default_unit || entry.unit })} className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-bold text-blue-700">Usar</button>}
                />
                <SuggestionLine
                  label="Negocio sugerido"
                  value={storeSuggestion}
                  action={store?.score >= 0.34 && <button type="button" onClick={() => updateCorrection(entry.id, { store_name: store.name, sector: store.sector || entry.sector })} className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-bold text-blue-700">Usar</button>}
                />
              </div>

              {canSaveCoords && (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p><b>{coordsStore.name}</b> no tiene coordenadas. Este reporte si las trae: {formatCoords(entry.purchase_latitude, entry.purchase_longitude)}.</p>
                  <button disabled={saving} type="button" onClick={() => saveReportCoordsToStore(entry, coordsStore)} className="mt-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Guardar coordenadas en el negocio</button>
                </div>
              )}

              {entry.validation_status === 'pending' && (
                <>
                  <div className="mt-3 grid gap-2 rounded-2xl border border-slate-100 p-3 text-sm sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-bold text-slate-500">Producto corregido
                      <input value={draft.product_name} onChange={e => updateCorrection(entry.id, { product_name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                    </label>
                    <label className="grid gap-1 text-xs font-bold text-slate-500">Unidad
                      <select value={draft.unit} onChange={e => updateCorrection(entry.id, { unit: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900">
                        {UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-bold text-slate-500">Negocio corregido
                      <input value={draft.store_name} onChange={e => updateCorrection(entry.id, { store_name: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                    </label>
                    <label className="grid gap-1 text-xs font-bold text-slate-500">Sector corregido
                      <input value={draft.sector} onChange={e => updateCorrection(entry.id, { sector: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                    </label>
                  </div>

                  <div className="mt-3 grid gap-2 rounded-2xl border border-slate-100 p-3 text-sm">
                    <label className="flex items-center justify-between gap-3 text-sm font-black text-slate-700">
                      Producto con descuento
                      <input type="checkbox" checked={Boolean(draft.has_discount)} onChange={e => updateCorrection(entry.id, { has_discount: e.target.checked })} />
                    </label>
                    {draft.has_discount && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-xs font-bold text-slate-500">Precio normal
                          <input type="number" value={draft.normal_price} onChange={e => updateCorrection(entry.id, { normal_price: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                        </label>
                        <label className="grid gap-1 text-xs font-bold text-slate-500">Tipo descuento
                          <select value={draft.discount_type} onChange={e => updateCorrection(entry.id, { discount_type: e.target.value, discount_value: '' })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900">
                            {DISCOUNT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs font-bold text-slate-500">Valor descuento
                          <input type="number" value={draft.discount_value} onChange={e => updateCorrection(entry.id, { discount_value: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                        </label>
                        <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                          Precio final: {money(calculateDiscountFinalPrice(draft.normal_price, draft.discount_type, draft.discount_value))}
                        </div>
                        <label className="grid gap-1 text-xs font-bold text-slate-500 sm:col-span-2">Descripcion promocion
                          <input value={draft.promotion_description} onChange={e => updateCorrection(entry.id, { promotion_description: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" />
                        </label>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-bold text-slate-500">Metodo de pago
                        <select value={draft.payment_method} onChange={e => updateCorrection(entry.id, { payment_method: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900">
                          {PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                        Exige este metodo
                        <input type="checkbox" checked={Boolean(draft.requires_specific_payment_method)} onChange={e => updateCorrection(entry.id, { requires_specific_payment_method: e.target.checked })} />
                      </label>
                      {draft.requires_specific_payment_method && (
                        <label className="grid gap-1 text-xs font-bold text-slate-500 sm:col-span-2">Condicion de pago
                          <input value={draft.payment_condition} onChange={e => updateCorrection(entry.id, { payment_condition: e.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" placeholder={`Ej: solo con ${paymentMethodLabel(draft.payment_method)}`} />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button disabled={saving} onClick={() => approve(entry, 'corrected')} className="rounded-2xl bg-blue-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Aprobar corrigiendo</button>
                    <button disabled={saving} onClick={() => approve(entry, 'raw')} className="rounded-2xl bg-emerald-600 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Aprobar igual</button>
                    <button disabled={saving} onClick={() => reject(entry)} className="rounded-2xl bg-red-50 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Rechazar</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {!loading && filtered.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">No hay reportes en esta vista.</p>}
      </div>
    </div>
  )
}
