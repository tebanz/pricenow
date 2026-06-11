import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function HomeIcon({ active }) {
  return (
    <svg className={`w-5 h-5 ${active ? 'fill-brand-600' : 'fill-slate-400'}`} viewBox="0 0 24 24">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  )
}

function PricesIcon({ active }) {
  return (
    <svg className={`w-5 h-5 ${active ? 'fill-brand-600' : 'fill-slate-400'}`} viewBox="0 0 24 24">
      <path d="M4 19h16v2H4v-2zm2-2h3V9H6v8zm5 0h3V4h-3v13zm5 0h3v-6h-3v6z" />
    </svg>
  )
}

function ProfileIcon({ active }) {
  return (
    <svg className={`w-5 h-5 ${active ? 'fill-brand-600' : 'fill-slate-400'}`} viewBox="0 0 24 24">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

function ValidateIcon({ active }) {
  return (
    <svg className={`w-5 h-5 ${active ? 'fill-warning-600' : 'fill-slate-400'}`} viewBox="0 0 24 24">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-8 h-8 fill-white" viewBox="0 0 24 24">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  )
}

function NavItem({ to, label, icon: Icon, end = false, warning = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 min-w-0 h-16 transition-colors ${
          isActive ? (warning ? 'text-warning-600' : 'text-brand-600') : 'text-slate-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon active={isActive} />
          <span className="text-[10px] font-semibold leading-tight truncate max-w-[58px]">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function BottomNav() {
  const { isValidator } = useAuth()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none overflow-visible">
      <div className="relative max-w-lg mx-auto px-4 pb-safe">
        <NavLink
          to="/add"
          className={({ isActive }) =>
            `pointer-events-auto absolute z-40 left-1/2 -translate-x-1/2 -top-8 w-17 h-17 rounded-full shadow-2xl border-4 border-slate-50 flex items-center justify-center active:scale-95 transition-transform ${
              isActive ? 'bg-brand-700' : 'bg-brand-500'
            }`
          }
          aria-label="Ingresar precio"
        >
          <PlusIcon />
        </NavLink>

        <div className={`pointer-events-auto relative z-10 bg-white/95 backdrop-blur border border-slate-200 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] rounded-t-3xl px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] grid items-end overflow-visible ${isValidator ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <NavItem to="/" label="Inicio" icon={HomeIcon} end />
          <NavItem to="/ranking" label="Precios" icon={PricesIcon} />

          <div className="h-16 flex items-end justify-center pb-1">
            <span className="text-[10px] font-semibold text-brand-600 leading-tight">Ingresar</span>
          </div>

          <NavItem to="/profile" label="Perfil" icon={ProfileIcon} />

          {isValidator && (
            <NavItem to="/validate" label="Validar" icon={ValidateIcon} warning />
          )}
        </div>
      </div>
    </nav>
  )
}
