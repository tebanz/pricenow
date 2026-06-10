import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCLP } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

export default function Home() {
  const { user, profile } = useAuth()
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [statsRes, recentRes] = await Promise.all([
        supabase
          .from('price_entries')
          .select('id, validation_status', { count: 'exact' })
          .eq('user_id', user.id),
        supabase
          .from('price_entries')
          .select('id, product_name, brand, price, unit, store_name, purchase_date, validation_status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (statsRes.data) {
        const all      = statsRes.data
        const approved = all.filter(r => r.validation_status === 'approved').length
        const pending  = all.filter(r => r.validation_status === 'pending').length
        setStats({ total: all.length, approved, pending })
      }
      if (recentRes.data) setRecent(recentRes.data)
      setLoading(false)
    }
    load()
  }, [user.id])

  const statusBadge = (status) => {
    const map = {
      pending:  <span className="badge-pending">Pendiente</span>,
      approved: <span className="badge-approved">Aprobado</span>,
      rejected: <span className="badge-rejected">Rechazado</span>,
    }
    return map[status] ?? null
  }

  if (loading) return <Spinner />

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      {/* Saludo */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Hola, {profile?.username} 👋
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Tus aportes ayudan a la comunidad de Rancagua.
        </p>
      </div>

      {/* Estadísticas del usuario */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: stats?.total ?? 0,    color: 'text-brand-500' },
          { label: 'Aprobados', value: stats?.approved ?? 0, color: 'text-success-500' },
          { label: 'Pendientes', value: stats?.pending ?? 0, color: 'text-warning-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* CTA ingresar precio */}
      <Link to="/add" className="block">
        <div className="bg-brand-500 text-white rounded-2xl p-5 flex items-center justify-between shadow-md active:scale-98 transition-transform">
          <div>
            <p className="font-bold text-base">Ingresar precio</p>
            <p className="text-white/70 text-xs mt-0.5">Comparte lo que pagaste hoy</p>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl">
            ＋
          </div>
        </div>
      </Link>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/ranking" className="card flex items-center gap-3 active:scale-95 transition-transform">
          <div className="w-10 h-10 bg-success-50 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 fill-success-500" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Ranking</p>
            <p className="text-xs text-slate-400">Precios más bajos</p>
          </div>
        </Link>

        <Link to="/report" className="card flex items-center gap-3 active:scale-95 transition-transform">
          <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 fill-brand-500" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Reporte</p>
            <p className="text-xs text-slate-400">Variación semanal</p>
          </div>
        </Link>
      </div>

      {/* Últimos ingresos */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tus últimos ingresos</h3>
        {recent.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-3xl mb-2">🛒</p>
            <p className="text-sm text-slate-500">Aún no has ingresado precios.</p>
            <Link to="/add" className="text-brand-500 text-sm font-semibold mt-2 block">
              Ingresa tu primera compra →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map(entry => (
              <div key={entry.id} className="card flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">
                    {entry.product_name}
                    {entry.brand && <span className="text-slate-400 font-normal"> · {entry.brand}</span>}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{entry.store_name}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-bold text-brand-500">{formatCLP(entry.price)}</span>
                  {statusBadge(entry.validation_status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
