import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

function FeatureCard({ icon, title, description }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
      <div className="text-xl">{icon}</div>
      <p className="mt-2 text-sm font-bold text-white">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/70">{description}</p>
    </div>
  )
}

function StepDot({ active }) {
  return <span className={`h-1.5 rounded-full transition-all ${active ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`} />
}

function PasswordStrength({ password }) {
  const score = useMemo(() => {
    let value = 0
    if (password.length >= 8) value += 1
    if (/[A-ZÁÉÍÓÚÑ]/.test(password)) value += 1
    if (/[0-9]/.test(password)) value += 1
    if (/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]/.test(password)) value += 1
    return value
  }, [password])

  if (!password) return null

  const labels = ['Muy débil', 'Básica', 'Buena', 'Fuerte']
  const colors = ['bg-danger-500', 'bg-warning-500', 'bg-brand-500', 'bg-success-500']
  const safeScore = Math.max(1, score)

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(item => (
          <div key={item} className={`h-1.5 flex-1 rounded-full ${item <= safeScore ? colors[safeScore - 1] : 'bg-slate-100'}`} />
        ))}
      </div>
      <p className="mt-1 text-[11px] font-medium text-slate-400">Seguridad: {labels[safeScore - 1]}</p>
    </div>
  )
}

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', username: '' })
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError(null)
    setInfo(null)
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setError(null)
    setInfo(null)
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(null)
    setInfo(null)

    const email = form.email.trim().toLowerCase()
    const password = form.password

    if (!email || !password) {
      setError('Ingresa tu correo y contraseña para continuar.')
      return
    }

    setLoading(true)

    if (mode === 'login') {
      const { error: err } = await signIn({ email, password })
      if (err) setError('No pudimos iniciar sesión. Revisa tus datos e intenta nuevamente.')
    } else {
      const username = form.username.trim().toLowerCase().replace(/\s+/g, '_')
      if (!username) {
        setError('El nombre de usuario es obligatorio.')
        setLoading(false)
        return
      }
      if (password.length < 8) {
        setError('La contraseña debe tener al menos 8 caracteres.')
        setLoading(false)
        return
      }

      const { error: err } = await signUp({ email, password, username })
      if (err) {
        setError(err.message)
      } else {
        setInfo('Cuenta creada. Revisa tu correo para confirmar tu acceso antes de ingresar.')
        setMode('login')
      }
    }

    setLoading(false)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(21,73,168,0.85),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.28),_transparent_32%)]" />
      <div className="absolute left-1/2 top-10 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col lg:grid lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-1 flex-col justify-between px-6 pb-8 pt-8 sm:px-10 lg:px-12 lg:py-12">
          <div>
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 shadow-sm backdrop-blur">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-black text-brand-600">₱</div>
              <div>
                <p className="font-black leading-tight">PriceNow</p>
                <p className="text-[11px] font-medium text-white/60">Rancagua</p>
              </div>
            </div>

            <div className="mt-10 max-w-xl">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-white/80 backdrop-blur">
                Observatorio ciudadano de precios
              </span>
              <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Encuentra mejores precios cerca de ti.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/70 sm:text-lg">
                Compara precios reales, reporta compras verificables, gana puntos y descubre beneficios locales en Rancagua.
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3 lg:max-w-2xl">
            <FeatureCard icon="📍" title="Cerca de ti" description="Usa tu ubicación con permiso para ordenar negocios y precios cercanos." />
            <FeatureCard icon="📊" title="Datos claros" description="Ranking y reportes por unidad estándar, kg, litro o unidad." />
            <FeatureCard icon="🎁" title="Beneficios" description="Suma puntos con aportes aprobados y canjéalos en descuentos." />
          </div>
        </div>

        <div className="relative flex items-end justify-center px-4 pb-5 pt-4 sm:px-8 lg:items-center lg:py-12">
          <form onSubmit={handleSubmit} className="w-full max-w-md rounded-[2rem] border border-white/60 bg-white p-5 text-slate-900 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  {mode === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {mode === 'login'
                    ? 'Ingresa para aportar, comparar y usar beneficios.'
                    : 'Únete a la comunidad que mide precios locales.'}
                </p>
              </div>
              <div className="hidden rounded-2xl bg-brand-50 px-3 py-2 text-center sm:block">
                <p className="text-xs font-bold text-brand-600">Beta</p>
                <p className="text-[10px] text-slate-400">Rancagua</p>
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`rounded-xl px-3 py-3 text-sm font-black transition-all ${mode === 'login' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500'}`}
              >
                Ingresar
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-xl px-3 py-3 text-sm font-black transition-all ${mode === 'register' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500'}`}
              >
                Registrarme
              </button>
            </div>

            {info && <div className="mb-4 rounded-2xl border border-success-500/20 bg-success-50 p-3 text-sm font-medium text-success-600">{info}</div>}
            {error && <div className="mb-4 rounded-2xl border border-danger-500/20 bg-danger-50 p-3 text-sm font-medium text-danger-600">{error}</div>}

            <div className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="input-label">Nombre de usuario</label>
                  <input
                    name="username"
                    type="text"
                    placeholder="ej: vecino_rancagua"
                    value={form.username}
                    onChange={handleChange}
                    maxLength={30}
                    className="input-field"
                    autoComplete="username"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Será visible en tus aportes públicos.</p>
                </div>
              )}

              <div>
                <label className="input-label">Correo electrónico</label>
                <input
                  name="email"
                  type="email"
                  placeholder="tu@correo.cl"
                  value={form.email}
                  onChange={handleChange}
                  className="input-field"
                  autoComplete="email"
                  inputMode="email"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Contraseña</label>
                  <button type="button" onClick={() => setShowPassword(value => !value)} className="text-xs font-bold text-brand-600">
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : 'Tu contraseña'}
                  value={form.password}
                  onChange={handleChange}
                  className="input-field"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                {mode === 'register' && <PasswordStrength password={form.password} />}
              </div>

              <button disabled={loading} className="btn-primary w-full rounded-2xl py-4 text-base shadow-lg shadow-brand-500/20">
                {loading ? 'Procesando...' : mode === 'login' ? 'Entrar a PriceNow' : 'Crear cuenta'}
              </button>
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <StepDot active />
                <StepDot active={mode === 'register'} />
                <StepDot />
              </div>
              <p className="text-sm font-bold text-slate-800">PriceNow funciona mejor con datos reales.</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Tus reportes pasan por validación. Al aprobarse, suman puntos y ayudan a comparar precios por sector.
              </p>
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}
