import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'

export default function Layout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-brand-500 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-sm font-bold">₱</span>
          </div>
          <div>
            <span className="font-bold text-base leading-none">PriceNow</span>
            <p className="text-[10px] text-white/70 leading-none">Rancagua</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-white/80 hidden sm:block">
            {profile?.username}
          </span>
          <button
            onClick={signOut}
            className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Contenido de la página */}
      <main className="flex-1 pb-24 page-enter">
        <Outlet />
      </main>

      {/* Navegación inferior */}
      <BottomNav />
    </div>
  )
}
