import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode]   = useState('login')   // 'login' | 'register'
  const [form, setForm]   = useState({ email: '', password: '', username: '' })
  const [error, setError] = useState(null)
  const [info,  setInfo]  = useState(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    setInfo(null)
    setLoading(true)

    if (mode === 'login') {
      const { error: err } = await signIn({ email: form.email, password: form.password })
      if (err) setError(err.message)
    } else {
      if (!form.username.trim()) {
        setError('El nombre de usuario es obligatorio.')
        setLoading(false)
        return
      }
      if (form.password.length < 8) {
        setError('La contraseña debe tener al menos 8 caracteres.')
        setLoading(false)
        return
      }
      const { error: err } = await signUp({
        email: form.email,
        password: form.password,
        username: form.username.trim().toLowerCase().replace(/\s+/g, '_'),
      })
      if (err) {
        setError(err.message)
      } else {
        setInfo('✅ Cuenta creada. Revisa tu correo para confirmar antes de ingresar.')
        setMode('login')
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-500 to-brand-700 flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-8 text-white">
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
          <span className="text-3xl font-bold">₱</span>
        </div>
        <h1 className="text-3xl font-bold text-center">PriceNow</h1>
        <p className="text-white/80 text-center mt-2 text-sm leading-relaxed max-w-xs">
          Observatorio ciudadano de precios en Rancagua.<br/>
          Juntos controlamos la canasta básica.
        </p>
      </div>

      {/* Formulario */}
      <div className="bg-white rounded-t-3xl px-6 pt-8 pb-10 shadow-2xl">
        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
          {['login', 'register'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setInfo(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === m
                  ? 'bg-white text-brand-500 shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              {m === 'login' ? 'Iniciar sesión' : 'Registrarse'}
            </button>
          ))}
        </div>

        {info && (
          <div className="bg-success-50 border border-success-500/30 text-success-600 text-sm rounded-xl p-3 mb-4">
            {info}
          </div>
        )}

        {error && (
          <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="input-label">Nombre de usuario</label>
              <input
                name="username"
                type="text"
                placeholder="ej: juan_rancagua"
                value={form.username}
                onChange={handleChange}
                maxLength={30}
                className="input-field"
                autoComplete="username"
              />
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
            <label className="input-label">Contraseña</label>
            <input
              name="password"
              type="password"
              placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : '••••••••'}
              value={form.password}
              onChange={handleChange}
              className="input-field"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !form.email || !form.password}
            className="btn-primary w-full mt-2"
          >
            {loading
              ? 'Procesando…'
              : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </button>
        </div>

        {mode === 'register' && (
          <p className="text-xs text-slate-400 text-center mt-4 leading-relaxed">
            Al registrarte aceptas que tus aportes de precios sean públicos
            bajo la iniciativa ciudadana PriceNow Rancagua.
          </p>
        )}
      </div>
    </div>
  )
}
