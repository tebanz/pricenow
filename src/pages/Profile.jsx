import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCLP } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfWeek() {
  const date = startOfToday()
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date
}

function startOfMonth() {
  const date = startOfToday()
  date.setDate(1)
  return date
}

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSince(value, since) {
  const date = toDate(value)
  return date && date >= since
}

function dateKey(value) {
  const date = toDate(value)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function statusBadge(status) {
  const map = {
    pending: <span className="badge-pending">Pendiente</span>,
    approved: <span className="badge-approved">Aprobado</span>,
    rejected: <span className="badge-rejected">Rechazado</span>,
  }
  return map[status] || null
}

function calculateStreak(entries) {
  const activeDays = new Set(entries.map(entry => dateKey(entry.created_at)).filter(Boolean))
  let streak = 0
  const cursor = startOfToday()

  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

function levelFromPoints(points) {
  if (points >= 1000) return { name: 'Diamante', next: null, min: 1000, color: 'text-sky-600', bg: 'bg-sky-50' }
  if (points >= 500) return { name: 'Oro', next: 1000, min: 500, color: 'text-amber-600', bg: 'bg-amber-50' }
  if (points >= 200) return { name: 'Plata', next: 500, min: 200, color: 'text-slate-600', bg: 'bg-slate-100' }
  return { name: 'Bronce', next: 200, min: 0, color: 'text-orange-700', bg: 'bg-orange-50' }
}

function ProgressBar({ value, max }) {
  const pct = max > 0 ? clampPct((value / max) * 100) : 0
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

function MissionCard({ title, description, value, max, reward }) {
  const done = value >= max
  return (
    <div className={`rounded-2xl border p-4 ${done ? 'border-success-200 bg-success-50/50' : 'border-slate-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-slate-800 text-sm">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${done ? 'bg-success-100 text-success-600' : 'bg-slate-100 text-slate-500'}`}>
          {Math.min(value, max)}/{max}
        </span>
      </div>
      <ProgressBar value={value} max={max} />
      <p className="text-[11px] text-slate-400 mt-2">Recompensa: {reward}</p>
    </div>
  )
}

export default function Profile() {
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadProfileData() {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('price_entries')
        .select(`
          id,
          product_name,
          store_name,
          price,
          unit_price,
          unit,
          validation_status,
          receipt_photo_url,
          purchase_latitude,
          purchase_longitude,
          purchase_date,
          created_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500)

      if (fetchError) {
        setError(fetchError.message)
        setEntries([])
      } else {
        setEntries(data || [])
      }

      setLoading(false)
    }

    loadProfileData()
  }, [user.id])

  const summary = useMemo(() => {
    const approved = entries.filter(entry => entry.validation_status === 'approved')
    const pending = entries.filter(entry => entry.validation_status === 'pending')
    const rejected = entries.filter(entry => entry.validation_status === 'rejected')

    const today = startOfToday()
    const week = startOfWeek()
    const month = startOfMonth()

    const sentToday = entries.filter(entry => isSince(entry.created_at, today)).length
    const approvedWeek = approved.filter(entry => isSince(entry.created_at, week)).length
    const approvedMonth = approved.filter(entry => isSince(entry.created_at, month)).length

    const withLocation = approved.filter(entry => entry.purchase_latitude != null && entry.purchase_longitude != null).length
    const withReceipt = approved.filter(entry => !!entry.receipt_photo_url).length

    const basePoints = approved.length * 10
    const locationPoints = withLocation * 5
    const receiptPoints = withReceipt * 5
    const streak = calculateStreak(entries)
    const streakPoints = streak >= 3 ? 20 : 0
    const points = basePoints + locationPoints + receiptPoints + streakPoints

    const totalValidated = approved.length + rejected.length
    const approvalRate = totalValidated > 0 ? Math.round((approved.length / totalValidated) * 100) : null

    const topStores = Object.values(approved.reduce((acc, entry) => {
      const name = entry.store_name || 'Tienda sin nombre'
      acc[name] ||= { name, count: 0 }
      acc[name].count += 1
      return acc
    }, {})).sort((a, b) => b.count - a.count).slice(0, 3)

    const topProducts = Object.values(approved.reduce((acc, entry) => {
      const name = entry.product_name || 'Producto sin nombre'
      acc[name] ||= { name, count: 0 }
      acc[name].count += 1
      return acc
    }, {})).sort((a, b) => b.count - a.count).slice(0, 3)

    return {
      total: entries.length,
      approved: approved.length,
      pending: pending.length,
      rejected: rejected.length,
      sentToday,
      approvedWeek,
      approvedMonth,
      withLocation,
      withReceipt,
      points,
      approvalRate,
      streak,
      topStores,
      topProducts,
      recent: entries.slice(0, 6),
    }
  }, [entries])

  const level = levelFromPoints(summary.points)
  const nextLevelProgress = level.next
    ? Math.round(((summary.points - level.min) / (level.next - level.min)) * 100)
    : 100

  if (loading) return <Spinner />

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Mi perfil</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Revisa tus aportes, puntos y metas de participación.
        </p>
      </div>

      {error && (
        <div className="card border-danger-200 bg-danger-50/40">
          <p className="text-sm text-danger-600">No se pudo cargar tu perfil: {error}</p>
        </div>
      )}

      <section className={`rounded-3xl p-5 ${level.bg} border border-white shadow-sm`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">Usuario</p>
            <h3 className="text-lg font-bold text-slate-900">{profile?.username || user?.email}</h3>
            <p className="text-xs text-slate-500 mt-1">Rol: {profile?.role || 'user'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Nivel</p>
            <p className={`text-lg font-black ${level.color}`}>{level.name}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-xs text-slate-500">Puntos PriceNow</p>
              <p className="text-3xl font-black text-brand-600">{summary.points}</p>
            </div>
            {level.next ? (
              <p className="text-xs text-slate-500">Faltan {level.next - summary.points} pts</p>
            ) : (
              <p className="text-xs text-slate-500">Nivel máximo actual</p>
            )}
          </div>
          <ProgressBar value={nextLevelProgress} max={100} />
          <p className="text-[11px] text-slate-500 mt-2">
            Fórmula actual: +10 por precio aprobado, +5 con ubicación, +5 con foto. Se puede ajustar cuando actives cupones reales.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <p className="text-2xl font-bold text-success-500">{summary.approved}</p>
          <p className="text-xs text-slate-500 mt-0.5">Aprobados</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-warning-600">{summary.pending}</p>
          <p className="text-xs text-slate-500 mt-0.5">Pendientes</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-brand-500">{summary.streak}</p>
          <p className="text-xs text-slate-500 mt-0.5">Racha</p>
        </div>
      </div>

      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-900">Metas activas</h3>
            <p className="text-xs text-slate-500">Las recompensas reales se pueden conectar a cupones después.</p>
          </div>
        </div>
        <div className="space-y-3">
          <MissionCard
            title="Meta diaria"
            description="Ingresa al menos 1 precio hoy."
            value={summary.sentToday}
            max={1}
            reward="+10 pts cuando sea aprobado"
          />
          <MissionCard
            title="Meta semanal"
            description="Consigue 5 precios aprobados esta semana."
            value={summary.approvedWeek}
            max={5}
            reward="Bono semanal de participación"
          />
          <MissionCard
            title="Meta mensual"
            description="Consigue 20 precios aprobados este mes."
            value={summary.approvedMonth}
            max={20}
            reward="Acceso a cupón destacado cuando esté disponible"
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-xs text-slate-500">Con ubicación</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{summary.withLocation}</p>
          <p className="text-[11px] text-slate-400 mt-1">Ayuda al mapa y negocios cercanos.</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Con foto</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{summary.withReceipt}</p>
          <p className="text-[11px] text-slate-400 mt-1">Aumenta la confianza del dato.</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Tasa aprobación</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{summary.approvalRate == null ? '—' : `${summary.approvalRate}%`}</p>
          <p className="text-[11px] text-slate-400 mt-1">Solo sobre datos validados.</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Total enviados</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{summary.total}</p>
          <p className="text-[11px] text-slate-400 mt-1">Historial de participación.</p>
        </div>
      </section>

      <section className="card">
        <h3 className="font-bold text-slate-900 mb-3">Beneficios</h3>
        <div className="space-y-2">
          <div className="rounded-2xl bg-brand-50 border border-brand-100 p-4">
            <p className="font-bold text-brand-700 text-sm">Cupones por puntos</p>
            <p className="text-xs text-brand-700/70 mt-1">
              Próximamente podrás canjear puntos por descuentos en negocios asociados.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
            <p className="font-bold text-slate-800 text-sm">Pase PriceNow</p>
            <p className="text-xs text-slate-500 mt-1">
              Base preparada para niveles, metas semanales, recompensas y productos destacados.
            </p>
          </div>
        </div>
      </section>

      {(summary.topStores.length > 0 || summary.topProducts.length > 0) && (
        <section className="card">
          <h3 className="font-bold text-slate-900 mb-3">Tu actividad destacada</h3>
          {summary.topStores.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Negocios donde más aportaste</p>
              <div className="space-y-2">
                {summary.topStores.map(store => (
                  <div key={store.name} className="flex justify-between text-sm">
                    <span className="text-slate-700 truncate">{store.name}</span>
                    <span className="font-semibold text-brand-600">{store.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.topProducts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Productos más reportados</p>
              <div className="space-y-2">
                {summary.topProducts.map(product => (
                  <div key={product.name} className="flex justify-between text-sm">
                    <span className="text-slate-700 truncate">{product.name}</span>
                    <span className="font-semibold text-brand-600">{product.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Últimos aportes</h3>
          <Link to="/add" className="text-xs font-semibold text-brand-500">Ingresar precio</Link>
        </div>

        {summary.recent.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-3xl mb-2">🛒</p>
            <p className="text-sm text-slate-500">Todavía no has ingresado precios.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {summary.recent.map(entry => (
              <div key={entry.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{entry.product_name}</p>
                  <p className="text-xs text-slate-400 truncate">{entry.store_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-brand-500 text-sm">{formatCLP(entry.price)}</p>
                  {statusBadge(entry.validation_status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
