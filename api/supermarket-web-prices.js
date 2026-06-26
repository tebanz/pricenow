import {
  isAllowedProviderUrl,
  parseOfficialCatalogHtml,
  providerConfig,
  providerLabel,
} from '../shared/webPriceParser.js'

const BOT_NAME = 'EdePreciosBot'
const MAX_HTML_BYTES = 6_000_000
const ROBOTS_CACHE_TTL_MS = 30 * 60 * 1000
const robotsCache = new Map()

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
}

function bearerToken(req) {
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function requireAdmin(req) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const token = bearerToken(req)

  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 503, error: 'Supabase no esta configurado en el servidor.' }
  }
  if (!token) return { ok: false, status: 401, error: 'Falta autenticacion.' }

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  const userResponse = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, { headers }, 7000)
  if (!userResponse.ok) return { ok: false, status: 401, error: 'Sesion invalida o vencida.' }
  const user = await userResponse.json().catch(() => null)
  if (!user?.id) return { ok: false, status: 401, error: 'No se pudo validar el usuario.' }

  const profileResponse = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
    { headers },
    7000,
  )
  if (!profileResponse.ok) return { ok: false, status: 403, error: 'No se pudo validar el rol administrador.' }
  const profiles = await profileResponse.json().catch(() => [])
  if (profiles?.[0]?.role !== 'admin') return { ok: false, status: 403, error: 'Solo admins pueden consultar catalogos web.' }

  return { ok: true, user }
}

function wildcardPattern(value) {
  const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}`)
}

function parseRobotsGroups(text = '') {
  const groups = []
  let current = { agents: [], rules: [] }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (current.rules.length) {
        groups.push(current)
        current = { agents: [], rules: [] }
      }
      current.agents.push(value.toLowerCase())
    } else if ((field === 'allow' || field === 'disallow') && current.agents.length) {
      current.rules.push({ type: field, path: value })
    }
  }
  if (current.agents.length || current.rules.length) groups.push(current)
  return groups
}

function robotsAllows(text, targetUrl) {
  const groups = parseRobotsGroups(text)
  const userAgent = BOT_NAME.toLowerCase()
  const exact = groups.filter(group => group.agents.some(agent => userAgent.includes(agent) && agent !== '*'))
  const selected = exact.length ? exact : groups.filter(group => group.agents.includes('*'))
  const path = `${targetUrl.pathname}${targetUrl.search}`
  const matches = []

  selected.forEach(group => {
    group.rules.forEach(rule => {
      if (!rule.path) return
      try {
        if (wildcardPattern(rule.path).test(path)) matches.push(rule)
      } catch {
        // Regla invalida: se ignora y no se bloquea por error de parseo.
      }
    })
  })

  if (!matches.length) return true
  matches.sort((a, b) => b.path.length - a.path.length)
  return matches[0].type === 'allow'
}

async function checkRobots(targetUrl) {
  const origin = targetUrl.origin
  const cached = robotsCache.get(origin)
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
    return { allowed: robotsAllows(cached.text, targetUrl), source: 'cache' }
  }

  try {
    const response = await fetchWithTimeout(`${origin}/robots.txt`, {
      headers: { 'User-Agent': `${BOT_NAME}/1.0 (+EdePrecios)` },
      redirect: 'follow',
    }, 6500)
    if (!response.ok) return { allowed: true, source: `robots-${response.status}` }
    const text = await response.text()
    robotsCache.set(origin, { text, fetchedAt: Date.now() })
    return { allowed: robotsAllows(text, targetUrl), source: 'robots' }
  } catch {
    return { allowed: true, source: 'robots-unavailable' }
  }
}

async function fetchOfficialPage(provider, initialUrl) {
  let current = new URL(initialUrl)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedProviderUrl(provider, current.toString())) throw new Error('La URL o redireccion no pertenece al dominio oficial permitido.')

    const response = await fetchWithTimeout(current.toString(), {
      headers: {
        'User-Agent': `${BOT_NAME}/1.0 (+EdePrecios; catalog review)`,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
      redirect: 'manual',
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('La fuente respondio con una redireccion sin destino.')
      current = new URL(location, current)
      continue
    }

    if (!response.ok) throw new Error(`El sitio oficial respondio ${response.status}.`)
    const contentType = response.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml\+xml|application\/json/i.test(contentType)) {
      throw new Error('La URL no devolvio una pagina de catalogo compatible.')
    }
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_HTML_BYTES) throw new Error('La pagina supera el tamano maximo permitido para una consulta.')
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_HTML_BYTES) throw new Error('La pagina supera el tamano maximo permitido para una consulta.')
    return { text, finalUrl: current.toString(), contentType }
  }
  throw new Error('La fuente excedio el maximo de redirecciones permitidas.')
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      providers: Object.keys({ jumbo: 1, unimarc: 1, tottus: 1, lider: 1 }).map(value => ({
        value,
        label: providerLabel(value),
        hosts: providerConfig(value)?.hosts || [],
      })),
    })
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Metodo no permitido.' })

  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return json(res, auth.status, { error: auth.error })

    const provider = String(req.body?.provider || '').toLowerCase().trim()
    const sourceUrl = String(req.body?.source_url || '').trim()
    const category = String(req.body?.category || '').trim().slice(0, 120)
    const maxProducts = Math.max(1, Math.min(Number(req.body?.max_products) || 80, 200))

    if (!providerConfig(provider)) return json(res, 400, { error: 'Proveedor no soportado.' })
    if (!isAllowedProviderUrl(provider, sourceUrl)) {
      return json(res, 400, { error: 'Usa una URL HTTPS del dominio oficial del proveedor seleccionado.' })
    }

    const targetUrl = new URL(sourceUrl)
    const robots = await checkRobots(targetUrl)
    if (!robots.allowed) {
      return json(res, 403, {
        error: 'La ruta esta bloqueada para rastreo automatizado por robots.txt. No se consulto el catalogo.',
        robots: robots.source,
      })
    }

    const page = await fetchOfficialPage(provider, sourceUrl)
    const products = parseOfficialCatalogHtml({
      html: page.text,
      provider,
      sourceUrl: page.finalUrl,
      category,
      maxProducts,
    })

    return json(res, 200, {
      provider,
      chain_name: providerLabel(provider),
      source_url: page.finalUrl,
      candidates: products,
      count: products.length,
      robots: robots.source,
      location_detected: null,
      location_note: 'La consulta del servidor no comparte la ubicacion ni las cookies del navegador. Revisa el alcance territorial antes de aprobar.',
      fetched_at: new Date().toISOString(),
    })
  } catch (error) {
    const isAbort = error?.name === 'AbortError'
    return json(res, isAbort ? 504 : 502, {
      error: isAbort ? 'El sitio oficial demoro demasiado en responder.' : (error?.message || 'No se pudo consultar el catalogo oficial.'),
    })
  }
}
