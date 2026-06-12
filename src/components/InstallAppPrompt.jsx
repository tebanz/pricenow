import { useEffect, useState } from 'react'

const DISMISSED_KEY = 'pricenow_install_prompt_dismissed'

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      if (localStorage.getItem(DISMISSED_KEY) === 'true') return
      setInstallEvent(event)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  async function installApp() {
    if (!installEvent) return
    await installEvent.prompt()
    setInstallEvent(null)
    setVisible(false)
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setVisible(false)
  }

  if (!visible || !installEvent) return null

  return (
    <div className="fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-lg rounded-3xl border border-blue-100 bg-white p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-slate-900">Instalar PriceNow</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Accede mas rapido desde tu celular y conserva la experiencia de app.</p>
        </div>
        <button type="button" onClick={dismiss} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">Cerrar</button>
      </div>
      <button type="button" onClick={installApp} className="mt-3 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white">
        Instalar
      </button>
    </div>
  )
}
