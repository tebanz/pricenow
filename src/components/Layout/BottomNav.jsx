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
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
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
]

export default function BottomNav() {
  const { isValidator } = useAuth()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 pb-safe">
      <div className="flex justify-around items-center max-w-lg mx-auto">
        {navItems.map(({ to, label, icon, highlight }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center py-2 px-3 min-w-0 flex-1 transition-colors ${
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
              `flex flex-col items-center py-2 px-3 min-w-0 flex-1 transition-colors ${
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
