import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/UI/Spinner'
import Benefits from './Benefits'

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

function transactionLabel(reason) {
  const map = {
    price_entry_approved: 'Precio aprobado',
    coupon_redeemed: 'Cupón canjeado',
    manual_adjustment: 'Ajuste manual',
  }
  return map[reason] || reason
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

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
        active ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

const DEFAULT_PREFERENCES = {
  favoriteSector: '',
  homeReference: '',
  compactMode: false,
  nearbyFirst: true,
  showEconomicTips: true,
  weeklyGoal: 5,
  savedLocation: null,
}

function loadPreferences(userId) {
  try {
    const raw = localStorage.getItem(`pricenow_preferences_${userId}`)
    return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function formatLocation(location) {
  if (!location?.lat || !location?.lng) return 'Sin ubicación guardada'
  return `${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}`
}

const USERNAME_CHANGE_DAYS = 90

function usernameChangeInfo(profile) {
  const lastChanged = profile?.username_last_changed_at ? new Date(profile.username_last_changed_at) : null
  if (!lastChanged || Number.isNaN(lastChanged.getTime())) {
    return { locked: false, daysLeft: 0, nextDate: null, label: 'Puedes cambiar tu usuario una vez. Después quedará bloqueado por 90 días.' }
  }

  const nextDate = new Date(lastChanged)
  nextDate.setDate(nextDate.getDate() + USERNAME_CHANGE_DAYS)
  const now = new Date()
  const diffMs = nextDate.getTime() - now.getTime()
  const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

  if (daysLeft <= 0) {
    return { locked: false, daysLeft: 0, nextDate, label: 'Ya puedes cambiar tu nombre de usuario nuevamente.' }
  }

  return {
    locked: true,
    daysLeft,
    nextDate,
    label: `Podrás cambiar tu usuario nuevamente en ${daysLeft} día${daysLeft === 1 ? '' : 's'}.`,
  }
}

function cleanUsername(value) {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_\.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
}


function initialsFromProfile(profile, user) {
  const base = profile?.full_name || profile?.username || user?.email || 'PN'
  return base
    .split(/\s+|_|-|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'PN'
}

function avatarSeed(profile, user) {
  return encodeURIComponent(profile?.username || user?.email || 'PriceNow')
}

export default function Profile() {
  const { user, profile, isValidator } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'resumen'
  const [entries, setEntries] = useState([])
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [profileForm, setProfileForm] = useState({ username: '', full_name: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [preferences, setPreferences] = useState(() => loadPreferences(user?.id))
  const [preferencesMessage, setPreferencesMessage] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)

  useEffect(() => {
    setProfileForm({
      username: profile?.username || '',
      full_name: profile?.full_name || '',
    })
  }, [profile?.username, profile?.full_name])

  useEffect(() => {
    setAvatarUrl(profile?.avatar_url || '')
  }, [profile?.avatar_url])

  useEffect(() => {
    if (!user?.id) return
    setPreferences(loadPreferences(user.id))
  }, [user?.id])

  useEffect(() => {
    async function loadProfileData() {
      setLoading(true)
      setError(null)

      const [entriesResult, walletResult, transactionsResult] = await Promise.all([
        supabase
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
          .limit(500),
        supabase
          .from('user_points')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('point_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (entriesResult.error) {
        setError(entriesResult.error.message)
        setEntries([])
      } else {
        setEntries(entriesResult.data || [])
      }

      setWallet(walletResult.data || { current_points: 0, lifetime_points: 0 })
      setTransactions(transactionsResult.data || [])
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
    const streak = calculateStreak(entries)

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
      approvalRate,
      streak,
      topStores,
      topProducts,
      recent: entries.slice(0, 6),
    }
  }, [entries])

  const points = wallet?.current_points || 0
  const lifetimePoints = wallet?.lifetime_points || 0
  const level = levelFromPoints(lifetimePoints)
  const usernameInfo = usernameChangeInfo(profile)
  const currentUsername = profile?.username || ''
  const proposedUsername = cleanUsername(profileForm.username || '')
  const usernameChanged = proposedUsername && proposedUsername !== currentUsername
  const nextLevelProgress = level.next
    ? Math.round(((lifetimePoints - level.min) / (level.next - level.min)) * 100)
    : 100

  function changeTab(tab) {
    setSearchParams(tab === 'resumen' ? {} : { tab })
  }

  function savePreferences(nextPreferences = preferences) {
    localStorage.setItem(`pricenow_preferences_${user.id}`, JSON.stringify(nextPreferences))
    setPreferences(nextPreferences)
    setPreferencesMessage('Preferencias guardadas en este dispositivo.')
  }

  function updatePreference(field, value) {
    const next = { ...preferences, [field]: value }
    savePreferences(next)
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0]
    if (!file || !user?.id) return

    if (!file.type.startsWith('image/')) {
      setProfileMessage({ type: 'error', text: 'Selecciona una imagen válida para tu foto de perfil.' })
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage({ type: 'error', text: 'La imagen debe pesar menos de 2 MB.' })
      return
    }

    setAvatarUploading(true)
    setProfileMessage(null)

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const filePath = `${user.id}/avatar-${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { cacheControl: '3600', upsert: true })

    if (uploadError) {
      setProfileMessage({ type: 'error', text: `No se pudo subir la imagen: ${uploadError.message}` })
      setAvatarUploading(false)
      return
    }

    const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(filePath)
    const publicUrl = publicData?.publicUrl

    if (!publicUrl) {
      setProfileMessage({ type: 'error', text: 'No se pudo obtener la URL pública de la imagen.' })
      setAvatarUploading(false)
      return
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateError) {
      setProfileMessage({ type: 'error', text: `No se pudo guardar la foto: ${updateError.message}` })
    } else {
      setAvatarUrl(publicUrl)
      setProfileMessage({ type: 'success', text: 'Foto de perfil actualizada.' })
    }

    setAvatarUploading(false)
    event.target.value = ''
  }

  async function saveProfile(e) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileMessage(null)

    const cleanName = cleanUsername(profileForm.username || '')
    const changedUsername = cleanName && cleanName !== (profile?.username || '')

    if (!cleanName) {
      setProfileMessage({ type: 'error', text: 'El nombre de usuario no puede quedar vacío.' })
      setProfileSaving(false)
      return
    }

    if (changedUsername && usernameInfo.locked) {
      setProfileMessage({ type: 'error', text: `Por seguridad, el usuario solo se puede cambiar una vez cada ${USERNAME_CHANGE_DAYS} días. ${usernameInfo.label}` })
      setProfileSaving(false)
      return
    }

    const payload = {
      full_name: profileForm.full_name.trim(),
      updated_at: new Date().toISOString(),
    }

    if (changedUsername) {
      payload.username = cleanName
      payload.username_last_changed_at = new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id)

    if (updateError) {
      setProfileMessage({ type: 'error', text: updateError.message })
    } else {
      setProfileForm(prev => ({ ...prev, username: cleanName }))
      setProfileMessage({ type: 'success', text: changedUsername ? 'Perfil actualizado. El nombre de usuario quedó bloqueado por 90 días.' : 'Perfil actualizado.' })
    }

    setProfileSaving(false)
  }

  function saveCurrentLocation() {
    if (!navigator.geolocation) {
      setPreferencesMessage('Tu navegador no permite guardar ubicación.')
      return
    }

    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const savedLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 0),
          savedAt: new Date().toISOString(),
        }
        savePreferences({ ...preferences, savedLocation })
        setLocationLoading(false)
      },
      () => {
        setPreferencesMessage('No se pudo obtener la ubicación. Puedes mantener tu sector preferido manual.')
        setLocationLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  }

  if (loading) return <Spinner />

  const tabs = [
    ['resumen', 'Resumen'],
    ['beneficios', 'Beneficios · Prox.'],
    ['preferencias', 'Preferencias'],
    ['configuracion', 'Configuración'],
  ]

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Mi perfil</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Gestiona tu identidad, puntos, futuros beneficios y preferencias de PriceNow.
        </p>
      </div>

      {error && (
        <div className="card border-danger-200 bg-danger-50/40">
          <p className="text-sm text-danger-600">No se pudo cargar tu perfil: {error}</p>
        </div>
      )}

      <section className={`relative overflow-hidden rounded-[2rem] p-5 ${level.bg} border border-white shadow-sm`}>
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/55 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="shrink-0">
            <label className="group relative block h-20 w-20 cursor-pointer overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-500 shadow-lg shadow-brand-500/20 ring-4 ring-white">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Foto de perfil" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-black text-white">
                  {initialsFromProfile(profile, user)}
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-slate-950/55 py-1 text-center text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                Cambiar
              </span>
              <input type="file" accept="image/*" onChange={uploadAvatar} className="hidden" />
            </label>
            {avatarUploading && <p className="mt-2 text-center text-[10px] font-bold text-brand-600">Subiendo...</p>}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Usuario</p>
                <h3 className="truncate text-xl font-black text-slate-950">{profile?.full_name || profile?.username || user?.email}</h3>
                <p className="mt-1 truncate text-xs text-slate-500">@{profile?.username || avatarSeed(profile, user)} · {profile?.role || 'user'}</p>
              </div>
              <div className="shrink-0 rounded-2xl bg-white/70 px-3 py-2 text-right">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Nivel</p>
                <p className={`text-base font-black ${level.color}`}>{level.name}</p>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-500">Puntos disponibles</p>
                  <p className="text-3xl font-black text-brand-600">{points}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Históricos</p>
                  <p className="font-black text-slate-800">{lifetimePoints}</p>
                </div>
              </div>
              <ProgressBar value={nextLevelProgress} max={100} />
              <p className="mt-2 text-[11px] text-slate-500">
                Sube de nivel con aportes aprobados y acumula puntos para futuros beneficios.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(([id, label]) => (
          <TabButton key={id} id={id} active={activeTab === id} onClick={changeTab}>{label}</TabButton>
        ))}
      </div>

      {activeTab === 'beneficios' && (
        <div className="-mx-4">
          <Benefits />
        </div>
      )}

      {activeTab === 'resumen' && (
        <>
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
                <p className="text-xs text-slate-500">Los puntos se entregan cuando el admin aprueba los reportes.</p>
              </div>
            </div>
            <div className="space-y-3">
              <MissionCard
                title="Meta diaria"
                description="Ingresa al menos 1 precio hoy."
                value={summary.sentToday}
                max={1}
                reward="Puntos cuando sea aprobado"
              />
              <MissionCard
                title="Meta semanal"
                description={`Consigue ${preferences.weeklyGoal || 5} precios aprobados esta semana.`}
                value={summary.approvedWeek}
                max={Number(preferences.weeklyGoal || 5)}
                reward="Avance de nivel y puntos disponibles"
              />
              <MissionCard
                title="Meta mensual"
                description="Consigue 20 precios aprobados este mes."
                value={summary.approvedMonth}
                max={20}
                reward="Preparado para beneficios destacados"
              />
            </div>
          </section>

          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900">Beneficios y cupones</h3>
              <button type="button" onClick={() => changeTab('beneficios')} className="text-xs font-semibold text-brand-500">Ver modulo futuro</button>
            </div>
            <div className="rounded-2xl bg-brand-50 border border-brand-100 p-4">
              <p className="font-bold text-brand-700 text-sm">Proximamente</p>
              <p className="text-xs text-brand-700/70 mt-1">
                Muy pronto podras canjear puntos por descuentos, cupones y beneficios en negocios asociados.
              </p>
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

          {transactions.length > 0 && (
            <section className="card">
              <h3 className="font-bold text-slate-900 mb-3">Movimientos de puntos</h3>
              <div className="space-y-2">
                {transactions.slice(0, 6).map(transaction => (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 truncate">{transactionLabel(transaction.reason)}</p>
                      <p className="text-xs text-slate-400 truncate">{new Date(transaction.created_at).toLocaleDateString('es-CL')}</p>
                    </div>
                    <span className={`font-black ${transaction.points >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                      {transaction.points > 0 ? '+' : ''}{transaction.points}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

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

          <section className="card">
            <div className="mb-3">
              <h3 className="font-bold text-slate-900">Últimos aportes</h3>
              <p className="text-xs text-slate-500 mt-0.5">Historial reciente de precios enviados.</p>
            </div>
            {summary.recent.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no tienes precios ingresados.</p>
            ) : (
              <div className="space-y-2">
                {summary.recent.map(entry => (
                  <div key={entry.id} className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{entry.product_name}</p>
                        <p className="text-xs text-slate-400 truncate">{entry.store_name} · {entry.purchase_date}</p>
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${
                        entry.validation_status === 'approved'
                          ? 'bg-success-50 text-success-600'
                          : entry.validation_status === 'rejected'
                            ? 'bg-danger-50 text-danger-600'
                            : 'bg-warning-50 text-warning-600'
                      }`}>
                        {entry.validation_status === 'approved' ? 'Aprobado' : entry.validation_status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === 'preferencias' && (
        <div className="space-y-4">
          <section className="card">
            <h3 className="font-bold text-slate-900 mb-1">Ubicaciones y zona preferida</h3>
            <p className="text-xs text-slate-500 mb-4">Sirve para ordenar precios cercanos y reducir información innecesaria.</p>
            <div className="space-y-3">
              <div>
                <label className="input-label">Sector preferido</label>
                <input
                  className="input-field"
                  value={preferences.favoriteSector}
                  onChange={e => updatePreference('favoriteSector', e.target.value)}
                  placeholder="Ej: Santa Filomena, Centro, República de Chile"
                />
              </div>
              <div>
                <label className="input-label">Referencia opcional</label>
                <input
                  className="input-field"
                  value={preferences.homeReference}
                  onChange={e => updatePreference('homeReference', e.target.value)}
                  placeholder="Ej: cerca de Av. X / población Y"
                />
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-xs text-slate-500">Ubicación guardada en este dispositivo</p>
                <p className="font-semibold text-slate-800 text-sm mt-1">{formatLocation(preferences.savedLocation)}</p>
                {preferences.savedLocation?.accuracy && (
                  <p className="text-xs text-slate-400 mt-0.5">Precisión aprox.: {preferences.savedLocation.accuracy} m</p>
                )}
                <button type="button" onClick={saveCurrentLocation} disabled={locationLoading} className="btn-secondary w-full mt-3">
                  {locationLoading ? 'Guardando ubicación...' : 'Guardar mi ubicación actual'}
                </button>
              </div>
              {preferencesMessage && <p className="text-xs text-brand-600">{preferencesMessage}</p>}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'configuracion' && (
        <div className="space-y-4">
          <section className="card">
            <h3 className="font-bold text-slate-900 mb-1">Editar perfil</h3>
            <p className="text-xs text-slate-500 mb-4">Ajusta cómo se muestra tu cuenta dentro de PriceNow.</p>
            <form onSubmit={saveProfile} className="space-y-3">
              <div>
                <label className="input-label">Nombre público</label>
                <input
                  className="input-field"
                  value={profileForm.full_name}
                  onChange={e => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Tu nombre o apodo"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-slate-700">Usuario</label>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${usernameInfo.locked ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {usernameInfo.locked ? `${usernameInfo.daysLeft} días` : 'Disponible'}
                  </span>
                </div>
                <input
                  className="input-field"
                  value={profileForm.username}
                  onChange={e => setProfileForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="usuario"
                  disabled={usernameInfo.locked && !usernameChanged}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {usernameInfo.label} Puedes editar tu nombre público cuando quieras.
                </p>
              </div>
              {profileMessage && (
                <p className={`text-sm ${profileMessage.type === 'error' ? 'text-danger-600' : 'text-success-600'}`}>
                  {profileMessage.text}
                </p>
              )}
              <button type="submit" disabled={profileSaving} className="btn-primary w-full">
                {profileSaving ? 'Guardando...' : 'Guardar perfil'}
              </button>
            </form>
          </section>


          {isValidator && (
            <section className="card border-warning-100 bg-warning-50/40">
              <h3 className="font-bold text-slate-900 mb-1">Herramientas de administración</h3>
              <p className="text-xs text-slate-500 mb-3">Acceso rápido para revisar y validar aportes de la comunidad.</p>
              <Link to="/validate" className="btn-secondary w-full">Ir al panel de validación</Link>
            </section>
          )}

          <section className="card">
            <h3 className="font-bold text-slate-900 mb-1">Personalización</h3>
            <p className="text-xs text-slate-500 mb-4">Preferencias guardadas localmente en este dispositivo.</p>
            <div className="space-y-3">
              <label className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Modo compacto</p>
                  <p className="text-xs text-slate-500">Muestra tarjetas más resumidas cuando sea posible.</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!preferences.compactMode}
                  onChange={e => updatePreference('compactMode', e.target.checked)}
                  className="mt-1"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Priorizar precios cercanos</p>
                  <p className="text-xs text-slate-500">Da más importancia a negocios cerca de tu zona.</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!preferences.nearbyFirst}
                  onChange={e => updatePreference('nearbyFirst', e.target.checked)}
                  className="mt-1"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Consejos económicos</p>
                  <p className="text-xs text-slate-500">Permite mostrar explicaciones breves sobre variaciones de precios.</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!preferences.showEconomicTips}
                  onChange={e => updatePreference('showEconomicTips', e.target.checked)}
                  className="mt-1"
                />
              </label>

              <div className="rounded-2xl border border-slate-100 p-3">
                <label className="input-label">Meta semanal personalizada</label>
                <select
                  className="input-field"
                  value={preferences.weeklyGoal}
                  onChange={e => updatePreference('weeklyGoal', Number(e.target.value))}
                >
                  <option value={3}>3 precios aprobados</option>
                  <option value={5}>5 precios aprobados</option>
                  <option value={10}>10 precios aprobados</option>
                </select>
              </div>
            </div>
          </section>

          <section className="card bg-slate-900 text-white border-slate-900">
            <h3 className="font-bold">Beneficios en preparacion</h3>
            <p className="text-sm text-white/70 mt-1">
              Beneficios y cupones quedan como modulo futuro mientras PriceNow mantiene la navegacion principal enfocada en precios.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
