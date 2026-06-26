import { Component, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCLP, formatUnitPrice } from '../utils/priceCalc'
import { parseOfficialCatalogHtml, parseOfficialCatalogText } from '../../shared/webPriceParser.js'

const PROVIDERS = {
  jumbo: {
    label: 'Jumbo',
    defaultUrl: 'https://www.jumbo.cl/despensa/arroz-quinoa-cuscus/arroz',
  },
  unimarc: {
    label: 'Unimarc',
    defaultUrl: 'https://www.unimarc.cl/category/despensa/arroz-y-legumbres/arroz',
  },
  tottus: {
    label: 'Tottus',
    defaultUrl: 'https://www.tottus.cl/tottus-cl/lista/CATG27292/Arroz',
  },
  lider: {
    label: 'Lider',
    defaultUrl: 'https://www.lider.cl/supermercado',
  },
}

const LOCATION_SCOPES = [
  { value: 'online_unverified', label: 'Ubicacion web no confirmada' },
  { value: 'online_national', label: 'Precio online nacional' },
  { value: 'commune_confirmed', label: 'Comuna confirmada manualmente' },
  { value: 'branch_confirmed', label: 'Sucursal confirmada manualmente' },
]

const WEB_PRICE_MIGRATION_MESSAGE = 'Debes ejecutar migration_web_price_observations.sql en Supabase.'

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scopeLabel(value) {
  return LOCATION_SCOPES.find(scope => scope.value === value)?.label || safeText(value, 'Alcance sin dato')
}

function observationProduct(row = {}) {
  const product = row.product || row.web_catalog_products
  return Array.isArray(product) ? product[0] : product
}

function statusClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700'
  if (status === 'rejected') return 'bg-red-50 text-red-700'
  if (status === 'stale') return 'bg-amber-50 text-amber-700'
  return 'bg-blue-50 text-blue-700'
}

function isWebPriceMigrationMissing(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || /web_price_observations|web_catalog_products|web_price_import_runs|schema cache|relation .* does not exist/i.test(message)
}

function safeText(value, fallback = 'Sin dato') {
  if (value === null || value === undefined) return fallback
  const text = value.toString().trim()
  return text || fallback
}

function safeDateTime(value) {
  if (!value) return 'Fecha sin dato'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha sin dato'
  return date.toLocaleString('es-CL')
}

function safeStatus(value) {
  const status = safeText(value, 'candidate')
  return ['candidate', 'approved', 'rejected', 'stale'].includes(status) ? status : 'candidate'
}

class WebPricesErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('EdePrecios web prices page crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-6">
          <div className="rounded-[2rem] border border-red-100 bg-red-50 p-5 text-red-800 shadow-sm">
            <p className="font-black">No pudimos cargar Precios web</p>
            <p className="mt-2 text-sm">La pagina encontro un dato inesperado. Reintenta o revisa la configuracion de Supabase.</p>
            <p className="mt-2 rounded-2xl bg-white/70 p-3 text-xs font-semibold">{this.state.error.message || 'Error inesperado.'}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function WebPricesAdminContent() {
  const { isAdmin, user } = useAuth()
  const [provider, setProvider] = useState('jumbo')
  const [sourceUrl, setSourceUrl] = useState(PROVIDERS.jumbo.defaultUrl)
  const [category, setCategory] = useState('Arroz')
  const [maxProducts, setMaxProducts] = useState('60')
  const [city, setCity] = useState('Rancagua')
  const [commune, setCommune] = useState('Rancagua')
  const [locationScope, setLocationScope] = useState('online_unverified')
  const [locationConfirmed, setLocationConfirmed] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [approveOnSave, setApproveOnSave] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [stores, setStores] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [sourceMeta, setSourceMeta] = useState(null)
  const [manualContent, setManualContent] = useState('')
  const [manualFileName, setManualFileName] = useState('')

  async function loadStores() {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('id,name,chain,chain_name,branch_name,city,commune,is_active')
        .eq('is_active', true)
        .order('name')
        .limit(1000)

      if (error) {
        console.error('EdePrecios web prices stores load failed:', error)
        setMessage({ type: 'error', text: error.message || 'No se pudieron cargar las sucursales.' })
        setStores([])
        return
      }

      setStores(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('EdePrecios web prices stores load crashed:', error)
      setMessage({ type: 'error', text: error.message || 'No se pudieron cargar las sucursales.' })
      setStores([])
    }
  }

  async function loadRecent() {
    try {
      const { data, error } = await supabase
        .from('web_price_observations')
        .select(`
          id, chain_name, city, commune, location_scope, location_verified,
          normal_price, final_price, unit_price, unit_label, promotion_text,
          stock_status, source_url, captured_at, review_status,
          product:web_catalog_products!web_price_observations_web_product_id_fkey(id,name,brand,category,package_text,quantity,unit,provider)
        `)
        .order('captured_at', { ascending: false })
        .limit(40)

      if (error) {
        console.error('EdePrecios web prices recent load failed:', error)
        setRecent([])
        setMessage({
          type: 'error',
          text: isWebPriceMigrationMissing(error)
            ? WEB_PRICE_MIGRATION_MESSAGE
            : error.message || 'No se pudieron cargar las observaciones web.',
        })
        return
      }

      setRecent(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('EdePrecios web prices recent load crashed:', error)
      setRecent([])
      setMessage({
        type: 'error',
        text: isWebPriceMigrationMissing(error)
          ? WEB_PRICE_MIGRATION_MESSAGE
          : error.message || 'No se pudieron cargar las observaciones web.',
      })
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    loadStores()
    loadRecent()
  }, [isAdmin])

  useEffect(() => {
    setSourceUrl(PROVIDERS[provider]?.defaultUrl || '')
    setCandidates([])
    setSourceMeta(null)
    setMessage(null)
    setSelectedStoreId('')
  }, [provider])

  const matchingStores = useMemo(() => {
    const chain = normalize(PROVIDERS[provider]?.label)
    return (Array.isArray(stores) ? stores : []).filter(Boolean).filter(store => {
const storeChain = normalize(
  store?.chain_name ?? store?.chain ?? store?.name
)

const storeCity = normalize(
  store?.city ?? store?.commune
)
      const sameChain = storeChain.includes(chain) || chain.includes(storeChain)
      const sameCity = !city || storeCity === normalize(city) || normalize(store.commune) === normalize(commune)
      return sameChain && sameCity
    })
  }, [stores, provider, city, commune])

  function updateCandidate(index, patch) {
    setCandidates(current => (Array.isArray(current) ? current : []).filter(Boolean).map((candidate, candidateIndex) => (
      candidateIndex === index ? { ...candidate, ...patch } : candidate
    )))
  }

  async function fetchCatalog(event) {
    event?.preventDefault()
    setLoading(true)
    setMessage(null)
    setCandidates([])
    setSourceMeta(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      setLoading(false)
      setMessage({ type: 'error', text: 'Tu sesion vencio. Vuelve a iniciar sesion.' })
      return
    }

    try {
      const response = await fetch('/api/supermarket-web-prices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          source_url: sourceUrl,
          category,
          max_products: Number(maxProducts),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar el catalogo oficial.')

      const nextCandidates = Array.isArray(data.candidates) ? data.candidates : []
      setSourceMeta(data)
      setCandidates(nextCandidates.filter(Boolean).map(candidate => ({ ...candidate, selected: false })))
      setMessage({
        type: nextCandidates.length ? 'ok' : 'warning',
        text: nextCandidates.length
          ? `${nextCandidates.length} productos encontrados. Revisa precios y alcance territorial antes de guardar.`
          : 'La pagina respondio, pero no se detectaron productos compatibles. Prueba una URL de categoria o producto.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  function selectAll(value) {
    setCandidates(current => (Array.isArray(current) ? current : []).filter(Boolean).map(candidate => ({ ...candidate, selected: value })))
  }

  async function readManualFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 8_000_000) {
      setMessage({ type: 'error', text: 'El archivo supera 8 MB.' })
      event.target.value = ''
      return
    }
    const text = await file.text()
    setManualContent(text)
    setManualFileName(file.name)
    setMessage({ type: 'ok', text: `Archivo ${file.name} cargado. Presiona Procesar captura.` })
  }

  function processManualContent() {
    if (!manualContent.trim()) {
      setMessage({ type: 'error', text: 'Pega texto visible o carga un archivo HTML, JSON o TXT.' })
      return
    }

    try {
      const parserInput = {
        provider,
        sourceUrl,
        category,
        maxProducts: Number(maxProducts),
      }
      const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(manualContent) || /<script/i.test(manualContent)
      let products = looksLikeHtml
        ? parseOfficialCatalogHtml({ ...parserInput, html: manualContent })
        : parseOfficialCatalogText({ ...parserInput, text: manualContent })

      if (!products.length && looksLikeHtml) {
        products = parseOfficialCatalogText({ ...parserInput, text: manualContent })
      }

      const capturedAt = new Date().toISOString()
      setSourceMeta({
        provider,
        chain_name: PROVIDERS[provider].label,
        source_url: sourceUrl,
        candidates: products,
        count: products.length,
        location_detected: null,
        location_note: 'Captura asistida desde el navegador. Confirma manualmente que la pagina estaba configurada para Rancagua antes de aprobar.',
        fetched_at: capturedAt,
        capture_mode: 'manual_browser',
      })
      setCandidates((Array.isArray(products) ? products : []).filter(Boolean).map(candidate => ({ ...candidate, selected: false })))
      setMessage({
        type: products.length ? 'ok' : 'warning',
        text: products.length
          ? `${products.length} productos detectados en la captura. Revisa cada uno antes de guardar.`
          : 'No se detectaron productos. Copia el contenido visible que incluya nombre, formato y precio, o guarda la pagina como HTML.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'No se pudo procesar la captura.' })
    }
  }

  function validatedLocation() {
    if (locationScope === 'online_unverified') return { city: null, commune: null, verified: false, storeId: null }
    if (locationScope === 'online_national') return { city: null, commune: null, verified: true, storeId: null }
    if (!locationConfirmed) throw new Error('Confirma manualmente el alcance territorial antes de guardar como Rancagua.')
    if (locationScope === 'branch_confirmed' && !selectedStoreId) throw new Error('Selecciona la sucursal confirmada.')
    return {
      city: city.trim() || null,
      commune: commune.trim() || city.trim() || null,
      verified: true,
      storeId: locationScope === 'branch_confirmed' ? selectedStoreId : null,
    }
  }

  async function saveSelected() {
    const selected = (Array.isArray(candidates) ? candidates : []).filter(candidate => candidate?.selected)
    if (!selected.length) {
      setMessage({ type: 'error', text: 'Selecciona al menos un producto.' })
      return
    }

    let location
    try {
      location = validatedLocation()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }

    if (approveOnSave && locationScope === 'online_unverified') {
      setMessage({ type: 'error', text: 'Los precios con ubicacion no confirmada deben quedar como candidatos.' })
      return
    }

    setSaving(true)
    setMessage(null)
    let saved = 0
    let failed = 0
    const capturedAt = sourceMeta?.fetched_at || new Date().toISOString()
    const day = capturedAt.slice(0, 10)

    for (const candidate of selected) {
      const productPayload = {
        provider,
        source_product_id: candidate.source_product_id,
        source_url: candidate.source_url || sourceUrl,
        name: candidate.name,
        normalized_name: candidate.normalized_name || normalize(candidate.name),
        brand: candidate.brand || null,
        category: candidate.category || category || null,
        package_text: candidate.package_text || null,
        quantity: Number(candidate.quantity) > 0 ? Number(candidate.quantity) : 1,
        unit: candidate.unit || 'unidad',
        image_url: candidate.image_url || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }

      // eslint-disable-next-line no-await-in-loop
      const { data: product, error: productError } = await supabase
        .from('web_catalog_products')
        .upsert(productPayload, { onConflict: 'provider,source_product_id' })
        .select('id')
        .single()

      if (productError || !product?.id) {
        failed += 1
        continue
      }

      const observationKey = [
        provider,
        candidate.source_product_id,
        locationScope,
        location.city || 'sin-ciudad',
        location.storeId || 'sin-sucursal',
        day,
      ].join(':')

      const reviewStatus = approveOnSave ? 'approved' : 'candidate'
      const observationPayload = {
        web_product_id: product.id,
        chain_name: PROVIDERS[provider].label,
        store_id: location.storeId,
        city: location.city,
        commune: location.commune,
        location_scope: locationScope,
        location_verified: location.verified,
        normal_price: Number(candidate.normal_price) > 0 ? Number(candidate.normal_price) : null,
        final_price: Number(candidate.final_price),
        unit_price: Number(candidate.unit_price) > 0 ? Number(candidate.unit_price) : null,
        unit_label: candidate.unit_label || null,
        promotion_text: candidate.promotion_text || null,
        stock_status: candidate.stock_status || 'unknown',
        source_url: candidate.source_url || sourceUrl,
        captured_at: capturedAt,
        review_status: reviewStatus,
        reviewed_by: reviewStatus === 'approved' ? user?.id : null,
        reviewed_at: reviewStatus === 'approved' ? new Date().toISOString() : null,
        observation_key: observationKey,
        raw_data: {
          parser: 'official-html-v1',
          provider,
          source_page: sourceMeta?.source_url || sourceUrl,
          location_note: sourceMeta?.location_note || null,
        },
        updated_at: new Date().toISOString(),
      }

      // eslint-disable-next-line no-await-in-loop
      const { error: observationError } = await supabase
        .from('web_price_observations')
        .upsert(observationPayload, { onConflict: 'observation_key' })

      if (observationError) failed += 1
      else saved += 1
    }

    await supabase.from('web_price_import_runs').insert({
      provider,
      source_url: sourceMeta?.source_url || sourceUrl,
      target_city: location.city,
      target_commune: location.commune,
      location_scope: locationScope,
      candidates_found: Array.isArray(candidates) ? candidates.length : 0,
      imported_count: saved,
      status: failed ? (saved ? 'partial' : 'failed') : 'completed',
      error_message: failed ? `${failed} productos no se guardaron.` : null,
      started_by: user?.id,
      completed_at: new Date().toISOString(),
    })

    setSaving(false)
    setMessage({
      type: saved ? 'ok' : 'error',
      text: `${saved} precios guardados. ${failed} con error. ${approveOnSave ? 'Se publicaron los aprobados.' : 'Quedaron pendientes de revision.'}`,
    })
    setCandidates(current => (Array.isArray(current) ? current : []).filter(Boolean).map(candidate => ({ ...candidate, selected: false })))
    await loadRecent()
  }

  async function changeReviewStatus(row, reviewStatus) {
    const payload = {
      review_status: reviewStatus,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('web_price_observations').update(payload).eq('id', row.id)
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'ok', text: reviewStatus === 'approved' ? 'Precio web aprobado.' : 'Precio web rechazado.' })
      await loadRecent()
    }
  }

  const candidateRows = (Array.isArray(candidates) ? candidates : []).filter(Boolean)
  const recentRows = (Array.isArray(recent) ? recent : []).filter(Boolean)

  if (!isAdmin) {
    return <div className="mx-auto max-w-3xl rounded-3xl bg-white p-5 shadow-sm">Solo admins pueden importar precios web.</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-36">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-blue-800 to-indigo-700 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-blue-100">EdePrecios</p>
        <h1 className="mt-2 text-2xl font-black">Precios web oficiales</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-blue-50">
          Consulta paginas publicas de catalogo, revisa cada producto y guarda observaciones separadas de los precios presenciales.
        </p>
      </section>

      {message && (
        <div className={`rounded-2xl border p-3 text-sm font-semibold ${
          message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700'
            : message.type === 'warning' ? 'border-amber-100 bg-amber-50 text-amber-800'
              : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>{message.text}</div>
      )}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <form onSubmit={fetchCatalog} className="space-y-4">
          <div>
            <h2 className="font-black text-slate-900">1. Consultar una pagina oficial</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Usa una URL de categoria o producto. El servidor respeta robots.txt, limita dominios y nunca evade inicio de sesion, CAPTCHA ni bloqueos.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Cadena
              <select value={provider} onChange={event => setProvider(event.target.value)} className="input-field normal-case tracking-normal">
                {Object.entries(PROVIDERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400 sm:col-span-2">
              URL oficial
              <input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} className="input-field normal-case tracking-normal" />
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Maximo
              <select value={maxProducts} onChange={event => setMaxProducts(event.target.value)} className="input-field normal-case tracking-normal">
                <option value="20">20</option>
                <option value="60">60</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Categoria sugerida
              <input value={category} onChange={event => setCategory(event.target.value)} className="input-field normal-case tracking-normal" />
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Ciudad objetivo
              <input value={city} onChange={event => setCity(event.target.value)} className="input-field normal-case tracking-normal" />
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Comuna objetivo
              <input value={commune} onChange={event => setCommune(event.target.value)} className="input-field normal-case tracking-normal" />
            </label>
          </div>

          <button disabled={loading || !sourceUrl.trim()} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
            {loading ? 'Consultando sitio oficial...' : 'Buscar precios en la web oficial'}
          </button>

          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-slate-800">Captura asistida si el sitio bloquea al servidor</summary>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Abre la pagina oficial en tu navegador con la zona correcta, copia el contenido visible de los productos o guarda la pagina como HTML. La captura se procesa localmente y siempre queda sujeta a revision.
            </p>
            <div className="mt-3 grid gap-3">
              <input type="file" accept=".html,.htm,.json,.txt,text/html,application/json,text/plain" onChange={readManualFile} className="block w-full text-xs text-slate-600" />
              {manualFileName && <p className="text-xs font-bold text-slate-500">Archivo: {manualFileName}</p>}
              <textarea value={manualContent} onChange={event => {
                setManualContent(event.target.value)
                setManualFileName('')
              }} rows={7} placeholder="Pega aqui el texto visible, HTML o JSON de la pagina oficial…" className="input-field min-h-40 resize-y font-mono text-xs normal-case tracking-normal" />
              <button type="button" onClick={processManualContent} disabled={!manualContent.trim() || !sourceUrl.trim()} className="w-fit rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
                Procesar captura
              </button>
            </div>
          </details>
        </form>
      </section>

      {sourceMeta && (
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-black">Alcance territorial pendiente de revision</p>
          <p className="mt-1 leading-relaxed">{safeText(sourceMeta.location_note, 'Revisa manualmente el alcance territorial antes de guardar.')}</p>
          {sourceMeta.source_url && <a href={sourceMeta.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-black text-blue-700 underline">Abrir fuente oficial</a>}
        </section>
      )}

      {candidateRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">2. Revisar productos</h2>
              <p className="text-xs text-slate-500">Selecciona solo datos que puedas verificar en la fuente.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => selectAll(true)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Seleccionar todos</button>
              <button type="button" onClick={() => selectAll(false)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Limpiar</button>
            </div>
          </div>

          {candidateRows.map((candidate, index) => (
            <article key={`${safeText(candidate.source_product_id, 'producto')}-${index}`} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={candidate.selected} onChange={event => updateCandidate(index, { selected: event.target.checked })} className="mt-1 h-5 w-5" />
                <div className="min-w-0 flex-1">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400 sm:col-span-2">
                      Producto
                      <input value={candidate.name || ''} onChange={event => updateCandidate(index, { name: event.target.value })} className="input-field normal-case tracking-normal" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                      Marca
                      <input value={candidate.brand || ''} onChange={event => updateCandidate(index, { brand: event.target.value })} className="input-field normal-case tracking-normal" />
                    </label>
                    <label className="grid gap-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                      Categoria
                      <input value={candidate.category || ''} onChange={event => updateCandidate(index, { category: event.target.value })} className="input-field normal-case tracking-normal" />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Final {formatCLP(candidate.final_price)}</span>
                    {candidate.normal_price && <span className="rounded-full bg-slate-100 px-2 py-1">Normal {formatCLP(candidate.normal_price)}</span>}
                    <span className="rounded-full bg-slate-100 px-2 py-1">{formatUnitPrice(candidate.unit_price, candidate.unit_label || candidate.unit)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1">{candidate.package_text || `${safeText(candidate.quantity, '1')} ${safeText(candidate.unit, 'unidad')}`}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1">{safeText(candidate.stock_status, 'unknown')}</span>
                  </div>
                  {candidate.source_url && <a href={candidate.source_url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs font-bold text-blue-600 underline">Ver producto oficial</a>}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {candidateRows.length > 0 && (
        <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-black text-slate-900">3. Definir alcance y guardar</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
              Alcance del precio
              <select value={locationScope} onChange={event => {
                setLocationScope(event.target.value)
                setLocationConfirmed(false)
                setApproveOnSave(false)
              }} className="input-field normal-case tracking-normal">
                {LOCATION_SCOPES.map(scope => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>

            {locationScope === 'branch_confirmed' && (
              <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
                Sucursal de Rancagua
                <select value={selectedStoreId} onChange={event => setSelectedStoreId(event.target.value)} className="input-field normal-case tracking-normal">
                  <option value="">Selecciona una sucursal</option>
                  {matchingStores.map(store => <option key={store.id} value={store.id}>{safeText(store.name, 'Sucursal sin nombre')}</option>)}
                </select>
              </label>
            )}
          </div>

          {(locationScope === 'commune_confirmed' || locationScope === 'branch_confirmed') && (
            <label className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <input type="checkbox" checked={locationConfirmed} onChange={event => setLocationConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5" />
              <span>Confirmo que revise la fuente oficial y que estos precios corresponden a {locationScope === 'branch_confirmed' ? 'la sucursal seleccionada' : `${commune || city}`}. Esta confirmacion es manual.</span>
            </label>
          )}

          <label className="mt-3 flex items-start gap-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
            <input type="checkbox" checked={approveOnSave} disabled={locationScope === 'online_unverified'} onChange={event => setApproveOnSave(event.target.checked)} className="mt-0.5 h-5 w-5" />
            <span>Aprobar al guardar. Si queda desmarcado, los precios se guardan como candidatos y no aparecen en el ranking.</span>
          </label>

          <button type="button" onClick={saveSelected} disabled={saving || !candidateRows.some(candidate => candidate.selected)} className="mt-4 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar productos seleccionados'}
          </button>
        </section>
      )}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-slate-900">Observaciones recientes</h2>
            <p className="text-xs text-slate-500">Solo las aprobadas se incorporan al ranking.</p>
          </div>
          <button type="button" onClick={loadRecent} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Actualizar</button>
        </div>
        <div className="mt-3 space-y-2">
          {recentRows.map(row => {
            const product = observationProduct(row)
            const reviewStatus = safeStatus(row.review_status)
            const sourceUrl = typeof row.source_url === 'string' ? row.source_url : ''
            return (
              <div key={row.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-slate-900">{safeText(product?.name, 'Producto web')}</p>
                    <p className="text-xs text-slate-500">{safeText(row.chain_name, 'Cadena sin dato')} - {scopeLabel(row.location_scope)} - {safeDateTime(row.captured_at)}</p>
                    <p className="mt-1 text-sm font-black text-blue-700">{formatCLP(row.final_price)} {row.unit_price ? `· ${formatUnitPrice(row.unit_price, row.unit_label || product?.unit)}` : ''}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-black ${statusClass(reviewStatus)}`}>{reviewStatus}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {reviewStatus !== 'approved' && row.location_scope !== 'online_unverified' && (
                    <button type="button" onClick={() => changeReviewStatus(row, 'approved')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">Aprobar</button>
                  )}
                  {reviewStatus !== 'rejected' && (
                    <button type="button" onClick={() => changeReviewStatus(row, 'rejected')} className="rounded-xl bg-red-100 px-3 py-2 text-xs font-black text-red-700">Rechazar</button>
                  )}
                  {sourceUrl ? (
                    <a href={sourceUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-700">Fuente</a>
                  ) : (
                    <span className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-500">Sin fuente</span>
                  )}
                </div>
              </div>
            )
          })}
          {recentRows.length === 0 && <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Todavia no hay precios web guardados.</p>}
        </div>
      </section>
    </div>
  )
}

export default function WebPricesAdmin() {
  return (
    <WebPricesErrorBoundary>
      <WebPricesAdminContent />
    </WebPricesErrorBoundary>
  )
}
