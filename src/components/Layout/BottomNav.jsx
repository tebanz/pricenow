import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  {
    to: '/',
    label: 'Inicio',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      </svg>
    ),
  },
  {
    to: '/add',
    label: 'Ingresar',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
      </svg>
    ),
    highlight: true,
  },
  {
    to: '/ranking',
    label: 'Ranking',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M7 20h10v-2H7v2zm3.31-6.9L8.9 11.69 12 8.59l3.1 3.1-1.41 1.41L13 12.41V17h-2v-4.59l-.69.69zM12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06l1.46-1.46C4.3 14.53 4 13.3 4 12c0-4.42 3.58-8 8-8s8 3.58 8 8c0 1.3-.3 2.53-.84 3.6l1.46 1.46C21.5 15.58 22 13.85 22 12c0-5.52-4.48-10-10-10z"/>
      </svg>
    ),
  },
  {
    to: '/report',
    label: 'Reportes',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
      </svg>
    ),
  },
  {
    to: '/benefits',
    label: 'Beneficios',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.04 0-1.95.53-2.49 1.33L12 4l-.51-.67C10.95 2.53 10.04 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm6 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM4 19v-5h7v5H4zm0-7V8h7v4H4zm16 7h-7v-5h7v5zm0-7h-7V8h7v4z"/>
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'Perfil',
    icon: (active) => (
      <svg className={`w-5 h-5 ${active ? 'fill-brand-500' : 'fill-slate-400'}`} viewBox="0 0 24 24">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    ),
  },
]

export default function BottomNav() {
  const { isValidator } = useAuth()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 pb-safe">
      <div className="flex justify-around items-center max-w-lg mx-auto overflow-x-auto">
        {navItems.map(({ to, label, icon, highlight }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center py-2 px-2 min-w-[58px] flex-1 transition-colors ${
                isActive ? 'text-brand-500' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {highlight ? (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center -mt-5 shadow-lg transition-colors ${
                    isActive ? 'bg-brand-600' : 'bg-brand-500'
                  }`}>
                    <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
                    </svg>
                  </div>
                ) : (
                  icon(isActive)
                )}
                <span className={`text-[10px] font-medium mt-0.5 ${highlight ? 'mt-1' : ''}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {isValidator && (
          <NavLink
            to="/validate"
            className={({ isActive }) =>
              `flex flex-col items-center py-2 px-2 min-w-[58px] flex-1 transition-colors ${
                isActive ? 'text-warning-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <svg className={`w-5 h-5 ${isActive ? 'fill-warning-600' : 'fill-slate-400'}`} viewBox="0 0 24 24">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
                </svg>
                <span className="text-[10px] font-medium mt-0.5">Validar</span>
              </>
            )}
          </NavLink>
        )}
      </div>
    </nav>
  )
}
