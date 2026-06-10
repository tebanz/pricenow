export default function Spinner({ fullscreen = false }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-brand-500" />
      <p className="text-xs font-medium text-slate-400">Cargando…</p>
    </div>
  )

  if (fullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {content}
      </div>
    )
  }

  return content
}
