import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  calcUnitPrice, formatUnitPrice, SECTORES_RANCAGUA, UNIDADES
} from '../utils/priceCalc'

const EMPTY_FORM = {
  product_name: '',
  brand: '',
  quantity: '',
  unit: 'unidad',
  price: '',
  store_name: '',
  sector: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

export default function AddPrice() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [form,    setForm]    = useState(EMPTY_FORM)
  const [stores,  setStores]  = useState([])
  const [photo,   setPhoto]   = useState(null)
  const [preview, setPreview] = useState(null)
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // Calcular precio unitario en tiempo real
  const unitPrice = calcUnitPrice(form.price, form.quantity, form.unit)

  useEffect(() => {
    supabase.from('stores').select('id, name, sector').order('name')
      .then(({ data }) => { if (data) setStores(data) })
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  function handleStoreSelect(e) {
    const storeId = e.target.value
    if (storeId === 'other') {
      setForm(prev => ({ ...prev, store_name: '', sector: '' }))
      return
    }
    const store = stores.find(s => s.id === storeId)
    if (store) {
      setForm(prev => ({
        ...prev,
        store_name: store.name,
        sector: store.sector,
        _store_id: store.id,
      }))
    }
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('La foto no puede superar 5 MB.')
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function validate() {
    if (!form.product_name.trim()) return 'El nombre del producto es obligatorio.'
    if (!form.quantity || parseFloat(form.quantity) <= 0) return 'La cantidad debe ser mayor a 0.'
    if (!form.price    || parseFloat(form.price) <= 0)    return 'El precio debe ser mayor a 0.'
    if (!form.store_name.trim()) return 'La tienda es obligatoria.'
    if (!form.sector)            return 'El sector es obligatorio.'
    if (!form.purchase_date)     return 'La fecha de compra es obligatoria.'
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    setError(null)

    let receipt_photo_url = null

    // Subir foto si existe
    if (photo) {
      const ext      = photo.name.split('.').pop()
      const path     = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('receipts')
        .upload(path, photo, { contentType: photo.type, upsert: false })

      if (uploadErr) {
        setError('Error al subir la foto: ' + uploadErr.message)
        setLoading(false)
        return
      }
      receipt_photo_url = path
    }

    const { error: insertErr } = await supabase.from('price_entries').insert({
      user_id:          user.id,
      product_name:     form.product_name.trim(),
      brand:            form.brand.trim() || null,
      quantity:         parseFloat(form.quantity),
      unit:             form.unit,
      price:            parseFloat(form.price),
      unit_price:       unitPrice,
      store_name:       form.store_name.trim(),
      store_id:         form._store_id ?? null,
      sector:           form.sector,
      purchase_date:    form.purchase_date,
      notes:            form.notes.trim() || null,
      receipt_photo_url,
    })

    if (insertErr) {
      setError('Error al guardar: ' + insertErr.message)
    } else {
      setSuccess(true)
      setForm(EMPTY_FORM)
      setPhoto(null)
      setPreview(null)
      setTimeout(() => { setSuccess(false); navigate('/') }, 2000)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-xl font-bold text-slate-800">¡Precio registrado!</h3>
        <p className="text-slate-500 text-sm mt-2">
          Tu aporte está en revisión y pronto aparecerá en el ranking.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Ingresar precio</h2>
      <p className="text-sm text-slate-500 mb-5">Registra lo que pagaste en tu última compra.</p>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Producto */}
        <div>
          <label className="input-label">Producto <span className="text-danger-500">*</span></label>
          <input
            name="product_name"
            type="text"
            placeholder="Ej: Leche entera, Pan marraqueta…"
            value={form.product_name}
            onChange={handleChange}
            maxLength={100}
            className="input-field"
          />
        </div>

        {/* Marca */}
        <div>
          <label className="input-label">Marca <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input
            name="brand"
            type="text"
            placeholder="Ej: Soprole, Carozzi…"
            value={form.brand}
            onChange={handleChange}
            maxLength={60}
            className="input-field"
          />
        </div>

        {/* Cantidad + Unidad */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Cantidad <span className="text-danger-500">*</span></label>
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              placeholder="Ej: 1, 0.5, 500"
              value={form.quantity}
              onChange={handleChange}
              min="0.001"
              step="any"
              className="input-field"
            />
          </div>
          <div>
            <label className="input-label">Unidad <span className="text-danger-500">*</span></label>
            <select name="unit" value={form.unit} onChange={handleChange} className="input-field">
              {UNIDADES.map(u => (
                <option key={u.value} value={u.value}>{u.label.split(' →')[0]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Precio */}
        <div>
          <label className="input-label">Precio total ($) <span className="text-danger-500">*</span></label>
          <input
            name="price"
            type="number"
            inputMode="numeric"
            placeholder="Ej: 1490"
            value={form.price}
            onChange={handleChange}
            min="1"
            step="1"
            className="input-field"
          />
          {unitPrice != null && form.quantity && form.price && (
            <p className="text-xs text-success-600 font-medium mt-1.5 flex items-center gap-1">
              <span>→</span>
              <span>{formatUnitPrice(unitPrice, form.unit)}</span>
            </p>
          )}
        </div>

        {/* Tienda (select con datos o libre) */}
        <div>
          <label className="input-label">Tienda <span className="text-danger-500">*</span></label>
          <select onChange={handleStoreSelect} defaultValue="" className="input-field mb-2">
            <option value="" disabled>Seleccionar tienda conocida…</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value="other">Otra tienda (ingresar manualmente)</option>
          </select>
          <input
            name="store_name"
            type="text"
            placeholder="Nombre de la tienda"
            value={form.store_name}
            onChange={handleChange}
            maxLength={80}
            className="input-field"
          />
        </div>

        {/* Sector */}
        <div>
          <label className="input-label">Sector de Rancagua <span className="text-danger-500">*</span></label>
          <select name="sector" value={form.sector} onChange={handleChange} className="input-field">
            <option value="" disabled>Seleccionar sector…</option>
            {SECTORES_RANCAGUA.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Fecha */}
        <div>
          <label className="input-label">Fecha de compra <span className="text-danger-500">*</span></label>
          <input
            name="purchase_date"
            type="date"
            value={form.purchase_date}
            onChange={handleChange}
            max={new Date().toISOString().slice(0, 10)}
            className="input-field"
          />
        </div>

        {/* Notas */}
        <div>
          <label className="input-label">Notas <span className="text-slate-400 font-normal">(opcional)</span></label>
          <textarea
            name="notes"
            placeholder="Ej: oferta de la semana, precio de feria…"
            value={form.notes}
            onChange={handleChange}
            maxLength={200}
            rows={2}
            className="input-field resize-none"
          />
        </div>

        {/* Foto de boleta */}
        <div>
          <label className="input-label">Foto de boleta <span className="text-slate-400 font-normal">(opcional)</span></label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-colors"
          >
            {preview ? (
              <img src={preview} alt="Vista previa boleta" className="max-h-32 mx-auto rounded-lg object-contain" />
            ) : (
              <div className="text-slate-400">
                <svg className="w-8 h-8 mx-auto mb-1 fill-slate-300" viewBox="0 0 24 24">
                  <path d="M20 4v12H8V4h12m0-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 9.67l1.69 2.26 2.48-3.1L19 15H9zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/>
                </svg>
                <p className="text-sm">Toca para adjuntar foto</p>
                <p className="text-xs text-slate-300 mt-0.5">JPG, PNG · máx. 5 MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          {preview && (
            <button
              onClick={() => { setPhoto(null); setPreview(null) }}
              className="text-xs text-danger-500 mt-1 underline"
            >
              Quitar foto
            </button>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary w-full mt-2"
        >
          {loading ? 'Guardando…' : 'Guardar precio'}
        </button>
      </div>
    </div>
  )
}
