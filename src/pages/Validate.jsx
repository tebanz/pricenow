import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  formatCLP,
  formatUnitPrice,
  SECTORES_RANCAGUA,
  UNIDADES,
} from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'all', label: 'Todas' },
]

const STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

const STATUS_BADGES = {
  pending: 'badge-pending',
  approved: 'badge-approved',
  rejected: 'badge-rejected',
}

export default function Validate() {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null)
  const [rejectReason, setRejectReason] = useState({})
  const [showReject, setShowReject] = useState(null)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [editEntry, setEditEntry] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [error, setError] = useState(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('price_entries')
      .select(`
        id, product_name, brand, quantity, unit,
        price, unit_price, store_name, sector,
        purchase_date, receipt_photo_url, notes,
        validation_status, rejection_reason, created_at,
        profiles!user_id (username)
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (statusFilter !== 'all') {
      query = query.eq('validation_status', statusFilter)
    }

    const { data, error } = await query

    if (error) {
      setError(error.message)
      setEntries([])
    } else {
      setEntries(data ?? [])
    }

    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadEntries() }, [loadEntries])

  function statusBadge(status) {
    return (
      <span className={STATUS_BADGES[status] ?? 'badge-pending'}>
        {STATUS_LABELS[status] ?? status}
      </span>
    )
  }

  async function approve(id) {
    setProcessing(id)
    setError(null)

    const { error } = await supabase
      .from('price_entries')
      .update({
        validation_status: 'approved',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', id)
      .eq('validation_status', 'pending')

    if (error) setError(error.message)
    await loadEntries()
    setProcessing(null)
  }

  async function reject(id) {
    const reason = rejectReason[id]?.trim()
    if (!reason) { alert('Escribe un motivo de rechazo.'); return }

    setProcessing(id)
    setError(null)

    const { error } = await supabase
      .from('price_entries')
      .update({
        validation_status: 'rejected',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
      .eq('validation_status', 'pending')

    if (error) setError(error.message)
    await loadEntries()
    setProcessing(null)
    setShowReject(null)
  }

  function openEdit(entry) {
    setEditEntry(entry)
    setEditForm({
      product_name: entry.product_name ?? '',
      brand: entry.brand ?? '',
      quantity: String(entry.quantity ?? ''),
      unit: entry.unit ?? 'unidad',
      price: String(entry.price ?? ''),
      store_name: entry.store_name ?? '',
      sector: entry.sector ?? '',
      purchase_date: entry.purchase_date ?? new Date().toISOString().slice(0, 10),
      notes: entry.notes ?? '',
      validation_status: entry.validation_status ?? 'pending',
      rejection_reason: entry.rejection_reason ?? '',
    })
  }

  function closeEdit() {
    setEditEntry(null)
    setEditForm(null)
  }

  function updateEditField(name, value) {
    setEditForm(prev => ({ ...prev, [name]: value }))
  }

  function validateEditForm() {
    if (!editForm.product_name.trim()) return 'El producto es obligatorio.'
    if (!editForm.quantity || parseFloat(editForm.quantity) <= 0) return 'La cantidad debe ser mayor a 0.'
    if (!editForm.price || parseFloat(editForm.price) <= 0) return 'El precio debe ser mayor a 0.'
    if (!editForm.store_name.trim()) return 'La tienda es obligatoria.'
    if (!editForm.sector) return 'El sector es obligatorio.'
    if (!editForm.purchase_date) return 'La fecha es obligatoria.'
    if (editForm.validation_status === 'rejected' && !editForm.rejection_reason.trim()) {
      return 'Si dejas la solicitud como rechazada, debes escribir motivo.'
    }
    return null
  }

  async function saveEdit() {
    const validationError = validateEditForm()
    if (validationError) { alert(validationError); return }

    setProcessing(editEntry.id)
    setError(null)

    const payload = {
      product_name: editForm.product_name.trim(),
      brand: editForm.brand.trim() || null,
      quantity: parseFloat(editForm.quantity),
      unit: editForm.unit,
      price: parseFloat(editForm.price),
      store_name: editForm.store_name.trim(),
      sector: editForm.sector,
      purchase_date: editForm.purchase_date,
      notes: editForm.notes.trim() || null,
      validation_status: editForm.validation_status,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
      rejection_reason:
        editForm.validation_status === 'rejected'
          ? editForm.rejection_reason.trim()
          : null,
    }

    const { error } = await supabase
      .from('price_entries')
      .update(payload)
      .eq('id', editEntry.id)

    if (error) {
      setError(error.message)
    } else {
      closeEdit()
      await loadEntries()
    }

    setProcessing(null)
  }

  async function getPhotoUrl(path) {
    const { data } = await supabase.storage
      .from('receipts')
      .createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (loading) return <Spinner />

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-slate-900">Panel de validación</h2>
        <span className="badge-pending">{entries.length} registros</span>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Revisa, aprueba, rechaza o corrige aportes de la comunidad.
      </p>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-5">
        {STATUS_FILTERS.map(filter => (
          <button
            key={filter.value}
            onClick={() => setStatusFilter(filter.value)}
            className={`text-xs font-semibold rounded-xl px-2 py-2 border transition-colors ${
              statusFilter === filter.value
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-slate-600 font-semibold">No hay registros para este filtro.</p>
          <p className="text-slate-400 text-sm mt-1">Cambia el filtro para ver otras solicitudes.</p>
        </div>
      )}

      <div className="space-y-4">
        {entries.map(entry => (
          <div key={entry.id} className="card border border-slate-200 space-y-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 truncate">
                  {entry.product_name}
                  {entry.brand && <span className="text-slate-400 font-normal"> · {entry.brand}</span>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  por @{entry.profiles?.username ?? 'usuario'} · {entry.purchase_date}
                </p>
              </div>
              {statusBadge(entry.validation_status)}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-400">Precio</p>
                <p className="font-bold text-brand-500">{formatCLP(entry.price)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-400">Precio unitario</p>
                <p className="font-bold text-slate-700 text-xs">
                  {formatUnitPrice(entry.unit_price, entry.unit)}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-400">Cantidad</p>
                <p className="font-semibold text-slate-700">{entry.quantity} {entry.unit}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-400">Tienda</p>
                <p className="font-semibold text-slate-700 text-xs truncate">{entry.store_name}</p>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              <span className="font-medium">Sector:</span> {entry.sector}
              {entry.notes && <span className="ml-3"><span className="font-medium">Nota:</span> {entry.notes}</span>}
              {entry.rejection_reason && (
                <p className="mt-1 text-danger-500">
                  <span className="font-medium">Motivo rechazo:</span> {entry.rejection_reason}
                </p>
              )}
            </div>

            {entry.receipt_photo_url && (
              <button
                onClick={() => getPhotoUrl(entry.receipt_photo_url)}
                className="flex items-center gap-2 text-brand-500 text-sm font-medium"
              >
                Ver foto de boleta
              </button>
            )}

            {showReject === entry.id && entry.validation_status === 'pending' && (
              <textarea
                placeholder="Motivo del rechazo (obligatorio)"
                value={rejectReason[entry.id] ?? ''}
                onChange={e => setRejectReason(prev => ({ ...prev, [entry.id]: e.target.value }))}
                rows={2}
                className="input-field text-sm resize-none"
              />
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => openEdit(entry)}
                className="flex-1 bg-slate-100 text-slate-700 font-semibold py-2.5 rounded-xl text-sm active:scale-95 transition-transform"
              >
                Editar
              </button>

              {entry.validation_status === 'pending' && (
                <>
                  <button
                    onClick={() => approve(entry.id)}
                    disabled={processing === entry.id}
                    className="flex-1 bg-success-500 text-white font-semibold py-2.5 rounded-xl text-sm active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {processing === entry.id ? '…' : '✓ Aprobar'}
                  </button>

                  {showReject === entry.id ? (
                    <button
                      onClick={() => reject(entry.id)}
                      disabled={processing === entry.id}
                      className="flex-1 btn-danger text-sm py-2.5"
                    >
                      Confirmar rechazo
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowReject(entry.id)}
                      className="flex-1 bg-slate-100 text-slate-600 font-semibold py-2.5 rounded-xl text-sm active:scale-95 transition-transform"
                    >
                      ✕ Rechazar
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {editEntry && editForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Editar solicitud</h3>
              <button onClick={closeEdit} className="text-slate-400 text-xl">×</button>
            </div>

            <div>
              <label className="input-label">Estado</label>
              <select
                value={editForm.validation_status}
                onChange={e => updateEditField('validation_status', e.target.value)}
                className="input-field"
              >
                <option value="pending">Pendiente</option>
                <option value="approved">Aprobada</option>
                <option value="rejected">Rechazada</option>
              </select>
            </div>

            <div>
              <label className="input-label">Producto</label>
              <input
                value={editForm.product_name}
                onChange={e => updateEditField('product_name', e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="input-label">Marca</label>
              <input
                value={editForm.brand}
                onChange={e => updateEditField('brand', e.target.value)}
                className="input-field"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Cantidad</label>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={editForm.quantity}
                  onChange={e => updateEditField('quantity', e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="input-label">Unidad</label>
                <select
                  value={editForm.unit}
                  onChange={e => updateEditField('unit', e.target.value)}
                  className="input-field"
                >
                  {UNIDADES.map(u => (
                    <option key={u.value} value={u.value}>{u.label.split(' →')[0]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="input-label">Precio total</label>
              <input
                type="number"
                min="1"
                step="1"
                value={editForm.price}
                onChange={e => updateEditField('price', e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="input-label">Tienda</label>
              <input
                value={editForm.store_name}
                onChange={e => updateEditField('store_name', e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="input-label">Sector</label>
              <select
                value={editForm.sector}
                onChange={e => updateEditField('sector', e.target.value)}
                className="input-field"
              >
                <option value="" disabled>Seleccionar sector…</option>
                {SECTORES_RANCAGUA.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="input-label">Fecha de compra</label>
              <input
                type="date"
                value={editForm.purchase_date}
                onChange={e => updateEditField('purchase_date', e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="input-label">Notas</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={e => updateEditField('notes', e.target.value)}
                className="input-field resize-none"
              />
            </div>

            {editForm.validation_status === 'rejected' && (
              <div>
                <label className="input-label">Motivo de rechazo</label>
                <textarea
                  rows={2}
                  value={editForm.rejection_reason}
                  onChange={e => updateEditField('rejection_reason', e.target.value)}
                  className="input-field resize-none"
                />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={closeEdit}
                className="flex-1 bg-slate-100 text-slate-600 font-semibold py-3 rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={processing === editEntry.id}
                className="flex-1 btn-primary"
              >
                {processing === editEntry.id ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
