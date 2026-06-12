import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useAuth } from '../../context/AuthContext'

function BrandMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/20">
      <div className="flex h-6 w-6 items-center justify-center rounded-xl bg-white text-sm font-black text-blue-700">P</div>
    </div>
  )
}

export default function Layout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-40 bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-600 text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <span className="block truncate text-lg font-black leading-none tracking-tight">PriceNow</span>
              <p className="text-[11px] font-semibold leading-none text-white/70">Precios reales cerca de ti</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden max-w-[160px] truncate text-xs font-bold text-white/80 sm:block">{profile?.username}</span>
            <button onClick={signOut} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold transition hover:bg-white/20">Salir</button>
          </div>
        </div>
      </header>
      <main className="flex-1 pb-36 page-enter">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
