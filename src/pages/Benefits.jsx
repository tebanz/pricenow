const UPCOMING_BENEFITS = [
  'Cupones por puntos',
  'Descuentos en negocios locales',
  'Beneficios para usuarios activos',
  'Promociones de comercios asociados',
]

export default function Benefits() {
  return (
    <div className="space-y-5 px-4 py-5 pb-32">
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-700 via-indigo-600 to-slate-950 p-5 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-100">En proxima actualizacion</p>
          <h1 className="mt-2 text-2xl font-black">Beneficios y cupones</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-blue-50">
            Muy pronto podras canjear puntos por descuentos, cupones y beneficios en negocios asociados.
          </p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Modulo futuro</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">Esta funcion vendra en una proxima actualizacion de EdePrecios.</p>
          </div>
          <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Prox.</span>
        </div>

        <div className="mt-4 grid gap-2">
          {UPCOMING_BENEFITS.map(item => (
            <div key={item} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-800">{item}</p>
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-500">Proximamente</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
