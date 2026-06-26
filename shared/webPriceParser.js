const PROVIDER_CONFIG = {
  jumbo: {
    label: 'Jumbo',
    hosts: ['jumbo.cl', 'www.jumbo.cl'],
    productPath: /\/[^?#]+\/p(?:[?#]|$)/i,
  },
  unimarc: {
    label: 'Unimarc',
    hosts: ['unimarc.cl', 'www.unimarc.cl'],
    productPath: /\/product\//i,
  },
  tottus: {
    label: 'Tottus',
    hosts: ['tottus.cl', 'www.tottus.cl'],
    productPath: /\/tottus-cl\/articulo\//i,
  },
  lider: {
    label: 'Lider',
    hosts: ['lider.cl', 'www.lider.cl'],
    productPath: /\/(supermercado|catalogo)\/product\//i,
  },
}

const PRICE_KEYS = [
  'finalPrice', 'sellingPrice', 'salePrice', 'currentPrice', 'bestPrice',
  'price', 'Price', 'lowPrice', 'spotPrice', 'offerPrice', 'value',
]
const NORMAL_PRICE_KEYS = [
  'normalPrice', 'listPrice', 'originalPrice', 'oldPrice', 'highPrice', 'ListPrice',
]
const NAME_KEYS = ['productName', 'displayName', 'itemName', 'title', 'name']
const ID_KEYS = ['productId', 'productID', 'skuId', 'sku', 'itemId', 'id', 'gtin13', 'gtin', 'mpn']
const URL_KEYS = ['link', 'linkText', 'url', 'productUrl', 'canonicalUrl']
const IMAGE_KEYS = ['image', 'imageUrl', 'imageURL', 'thumbnail', 'thumbnailUrl']
const CATEGORY_KEYS = ['category', 'categoryName', 'department', 'departmentName']

export function providerConfig(provider) {
  return PROVIDER_CONFIG[provider] || null
}

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
}

export function stripTags(value = '') {
  return decodeHtml(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeWebText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parseCLP(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.round(value)
  }
  if (typeof value === 'object') {
    for (const key of ['value', 'amount', 'price', 'sellingPrice']) {
      const parsed = parseCLP(value[key])
      if (parsed != null) return parsed
    }
    return null
  }
  const text = decodeHtml(String(value)).trim()
  if (!text) return null
  const match = text.match(/-?\d[\d.\s]*(?:,\d+)?/)
  if (!match) return null
  let numeric = match[0].replace(/\s/g, '')
  if (numeric.includes(',') && numeric.includes('.')) {
    numeric = numeric.replace(/\./g, '').replace(',', '.')
  } else if (numeric.includes(',')) {
    const decimalPart = numeric.split(',')[1]
    numeric = decimalPart?.length === 3 ? numeric.replace(',', '') : numeric.replace(',', '.')
  } else {
    numeric = numeric.replace(/\./g, '')
  }
  const parsed = Number(numeric)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed)
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value)) {
    return Number(value.replace(',', '.'))
  }
  return null
}

function maybeCents(value, key = '') {
  const numeric = numericValue(value)
  if (numeric == null || numeric <= 0) return null
  const normalizedKey = key.toLowerCase()
  if ((normalizedKey.includes('cent') || normalizedKey === 'bestprice') && numeric >= 10000) {
    return Math.round(numeric / 100)
  }
  return Math.round(numeric)
}

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return null
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key]
  }
  return null
}

function firstPrice(object, keys) {
  if (!object || typeof object !== 'object') return null
  for (const key of keys) {
    const value = object[key]
    if (value == null || value === '') continue
    const direct = maybeCents(value, key) ?? parseCLP(value)
    if (direct != null) return direct
  }
  return null
}

function nestedObjects(object) {
  if (!object || typeof object !== 'object') return []
  return [
    object.offers,
    object.offer,
    object.commertialOffer,
    object.commercialOffer,
    object.priceRange,
    object.priceDefinition,
    object.price,
  ].flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
}

function resolvePrice(object, keys) {
  const own = firstPrice(object, keys)
  if (own != null) return own
  for (const nested of nestedObjects(object)) {
    const price = firstPrice(nested, keys)
    if (price != null) return price
  }
  return null
}

function resolveString(object, keys) {
  const value = firstValue(object, keys)
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (Array.isArray(value)) return value.find(item => typeof item === 'string') || ''
  if (value && typeof value === 'object') {
    return String(value.name || value.value || value.url || '').trim()
  }
  return ''
}

function absoluteUrl(value, baseUrl) {
  if (!value) return baseUrl || ''
  try {
    return new URL(String(value), baseUrl).toString()
  } catch {
    return baseUrl || ''
  }
}

function availabilityStatus(value = '') {
  const key = normalizeWebText(value)
  if (!key) return 'unknown'
  if (key.includes('outofstock') || key.includes('agotado') || key.includes('sin stock') || key.includes('sold out')) return 'out_of_stock'
  if (key.includes('instock') || key.includes('en stock') || key.includes('disponible')) return 'in_stock'
  return 'unknown'
}

export function parsePackageFromName(name = '') {
  const text = decodeHtml(name)
  const pack = text.match(/(?:pack|caja)?\s*(\d+)\s*(?:un(?:idades?)?|u)\s*(?:de|x)?\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos?|l|lt|litros?|ml|cc)\b/i)
  if (pack) {
    const count = Number(pack[1])
    const size = Number(pack[2].replace(',', '.'))
    const rawUnit = pack[3].toLowerCase()
    if (rawUnit.startsWith('kg') || rawUnit.startsWith('kilo')) return { quantity: count * size, unit: 'kg', package_text: pack[0] }
    if (['g', 'gr'].includes(rawUnit) || rawUnit.startsWith('gram')) return { quantity: count * size, unit: 'g', package_text: pack[0] }
    if (rawUnit === 'l' || rawUnit === 'lt' || rawUnit.startsWith('litro')) return { quantity: count * size, unit: 'litro', package_text: pack[0] }
    return { quantity: count * size, unit: 'ml', package_text: pack[0] }
  }

  const size = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos?|l|lt|litros?|ml|cc)\b/i)
  if (size) {
    const quantity = Number(size[1].replace(',', '.'))
    const rawUnit = size[2].toLowerCase()
    if (rawUnit.startsWith('kg') || rawUnit.startsWith('kilo')) return { quantity, unit: 'kg', package_text: size[0] }
    if (['g', 'gr'].includes(rawUnit) || rawUnit.startsWith('gram')) return { quantity, unit: 'g', package_text: size[0] }
    if (rawUnit === 'l' || rawUnit === 'lt' || rawUnit.startsWith('litro')) return { quantity, unit: 'litro', package_text: size[0] }
    return { quantity, unit: 'ml', package_text: size[0] }
  }

  const units = text.match(/(\d+)\s*(?:un(?:idades?)?|u)\b/i)
  if (units) return { quantity: Number(units[1]), unit: 'unidad', package_text: units[0] }
  return { quantity: 1, unit: 'unidad', package_text: '' }
}

export function calculateParsedUnitPrice(finalPrice, quantity, unit) {
  const price = Number(finalPrice)
  const qty = Number(quantity)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) return null
  if (unit === 'g' || unit === 'ml') return Math.round((price / qty) * 1000)
  return Math.round(price / qty)
}

function unitLabel(unit) {
  if (unit === 'g' || unit === 'kg') return 'kg'
  if (unit === 'ml' || unit === 'litro') return 'litro'
  return unit || 'unidad'
}

function cleanProductName(value = '') {
  return stripTags(value)
    .replace(/\b(agregar|similares|agotado|oferta|exclusivo\s+\w+|club\s+\w+)\b/gi, ' ')
    .replace(/\$\s*\d[\d.\s]*(?:,\d+)?/g, ' ')
    .replace(/\b\d+\s*%\s*(?:dcto\.?|descuento)?\b/gi, ' ')
    .replace(/\([^)]*(?:por|x)\s+(?:kg|lt|l|unidad|un)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedCandidate(input, context) {
  const name = cleanProductName(input.name)
  const finalPrice = parseCLP(input.final_price)
  if (!name || name.length < 3 || finalPrice == null) return null

  const packageInfo = parsePackageFromName(`${name} ${input.package_text || ''}`)
  const quantity = Number(input.quantity) > 0 ? Number(input.quantity) : packageInfo.quantity
  const unit = input.unit || packageInfo.unit
  const normalPrice = parseCLP(input.normal_price)
  const sourceId = String(input.source_product_id || normalizeWebText(`${name}-${input.source_url || context.sourceUrl}`)).slice(0, 240)
  const sourceUrl = absoluteUrl(input.source_url, context.sourceUrl)
  const imageUrl = absoluteUrl(input.image_url, context.sourceUrl)
  const stockStatus = input.stock_status || 'unknown'
  const finalNormal = normalPrice && normalPrice >= finalPrice ? normalPrice : null

  return {
    provider: context.provider,
    chain_name: context.chainName,
    source_product_id: sourceId,
    source_url: sourceUrl,
    name,
    normalized_name: normalizeWebText(name),
    brand: cleanProductName(input.brand || ''),
    category: cleanProductName(input.category || context.category || ''),
    package_text: input.package_text || packageInfo.package_text || '',
    quantity,
    unit,
    image_url: imageUrl && imageUrl !== context.sourceUrl ? imageUrl : '',
    normal_price: finalNormal,
    final_price: finalPrice,
    unit_price: parseCLP(input.unit_price) || calculateParsedUnitPrice(finalPrice, quantity, unit),
    unit_label: input.unit_label || unitLabel(unit),
    promotion_text: cleanProductName(input.promotion_text || ''),
    stock_status: stockStatus,
    raw_data: input.raw_data || {},
  }
}

function productFromObject(object, context) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const name = resolveString(object, NAME_KEYS)
  const finalPrice = resolvePrice(object, PRICE_KEYS)
  if (!name || finalPrice == null) return null

  const normalPrice = resolvePrice(object, NORMAL_PRICE_KEYS)
  const offer = Array.isArray(object.offers) ? object.offers[0] : object.offers || object.offer || {}
  const brandValue = object.brand || object.brandName || object.manufacturer
  const sourceId = resolveString(object, ID_KEYS) || resolveString(offer, ID_KEYS)
  const sourceUrl = resolveString(object, URL_KEYS) || resolveString(offer, URL_KEYS)
  const imageValue = firstValue(object, IMAGE_KEYS)
  const imageUrl = Array.isArray(imageValue) ? imageValue[0] : (imageValue?.url || imageValue)
  const availability = resolveString(offer, ['availability', 'stockStatus']) || resolveString(object, ['availability', 'stockStatus'])
  const promotion = resolveString(object, ['promotionName', 'promotionText', 'discountName', 'teaser'])

  return normalizedCandidate({
    name,
    source_product_id: sourceId,
    source_url: sourceUrl,
    brand: typeof brandValue === 'object' ? brandValue?.name : brandValue,
    category: resolveString(object, CATEGORY_KEYS),
    image_url: imageUrl,
    normal_price: normalPrice,
    final_price: finalPrice,
    promotion_text: promotion,
    stock_status: availabilityStatus(availability),
    raw_data: object,
  }, context)
}

function collectProductObjects(root, context) {
  const output = []
  const seen = new WeakSet()

  function visit(value, depth = 0) {
    if (depth > 14 || value == null) return
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    const type = String(value['@type'] || value.type || '').toLowerCase()
    const looksLikeProduct = type.includes('product') || NAME_KEYS.some(key => value[key])
    if (looksLikeProduct) {
      const candidate = productFromObject(value, context)
      if (candidate) output.push(candidate)
    }

    for (const [key, child] of Object.entries(value)) {
      if (['raw_data', 'description', 'ingredients', 'specifications'].includes(key)) continue
      visit(child, depth + 1)
    }
  }

  visit(root)
  return output
}

function parseJsonScripts(html, context) {
  const output = []
  const patterns = [
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(html))) {
      const raw = decodeHtml(match[1]).trim()
      if (!raw || raw.length > 8_000_000) continue
      try {
        output.push(...collectProductObjects(JSON.parse(raw), context))
      } catch {
        // Algunos sitios incluyen scripts no JSON validos. El fallback HTML sigue disponible.
      }
    }
  }
  return output
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match ? decodeHtml(match[1]) : ''
}

function parseAnchorCards(html, context) {
  const output = []
  const config = providerConfig(context.provider)
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match

  while ((match = anchorPattern.exec(html))) {
    const tag = `<a ${match[1]}>`
    const href = attr(tag, 'href')
    if (!href || (config?.productPath && !config.productPath.test(href))) continue
    const bodyText = stripTags(match[2])
    const labelled = attr(tag, 'aria-label') || attr(tag, 'title')
    const combined = `${labelled} ${bodyText}`.replace(/\s+/g, ' ').trim()
    const prices = [...combined.matchAll(/\$\s*([\d.]+(?:,\d+)?)/g)].map(price => parseCLP(price[1])).filter(Boolean)
    if (!prices.length) continue

    const nameSource = labelled || bodyText
    const name = cleanProductName(nameSource)
    const slug = href.split('/').filter(Boolean).slice(-2).join('-')
    const finalPrice = prices[0]
    const normalPrice = prices.find(value => value > finalPrice) || null
    output.push(normalizedCandidate({
      name,
      source_product_id: slug || href,
      source_url: href,
      normal_price: normalPrice,
      final_price: finalPrice,
      promotion_text: /oferta|dcto|descuento|club/i.test(combined) ? combined.match(/(?:oferta|\d+%\s*dcto\.?|club\s+\w+)/i)?.[0] : '',
      stock_status: /agotado|sin stock/i.test(combined) ? 'out_of_stock' : 'unknown',
      raw_data: { text: combined },
    }, context))
  }
  return output.filter(Boolean)
}

function dedupe(candidates, maxProducts) {
  const seen = new Map()
  for (const candidate of candidates.filter(Boolean)) {
    const key = candidate.source_product_id || `${candidate.normalized_name}-${candidate.final_price}`
    const existing = seen.get(key)
    if (!existing || (existing.stock_status === 'out_of_stock' && candidate.stock_status !== 'out_of_stock')) {
      seen.set(key, candidate)
    }
  }
  return [...seen.values()].slice(0, maxProducts)
}


function visibleLines(value = '') {
  const text = String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<\/?(?:article|section|li|div|p|h\d|br|tr|td|a|button|span)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtml(text)
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function likelyProductName(value = '') {
  return cleanProductName(value)
    .replace(/^(?:precio|oferta|descuento|desde)\s*/i, '')
    .replace(/\bpor\s+[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .&-]{1,30}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseOfficialCatalogText({ text, provider, sourceUrl, category = '', maxProducts = 100 }) {
  const config = providerConfig(provider)
  if (!config) throw new Error('Proveedor no soportado.')
  const lines = visibleLines(text)
  const output = []
  const context = { provider, chainName: config.label, sourceUrl, category }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!/\$\s*\d/.test(line) || line.length > 700) continue

    const prices = [...line.matchAll(/\$\s*([\d.]+(?:,\d+)?)/g)]
      .map(match => parseCLP(match[1]))
      .filter(Boolean)
    if (!prices.length) continue

    const beforePrice = line.split(/\$\s*\d/)[0].trim()
    const previous = lines.slice(Math.max(0, index - 3), index)
      .filter(item => !/^(?:precio|oferta|agregar|envio|despacho|unidad|un\.?|kg|gr|ml|lt)$/i.test(item))
      .join(' ')
    const nameSource = beforePrice.length >= 3 ? beforePrice : previous
    const name = likelyProductName(nameSource)
    if (!name || name.length < 3 || /^\d/.test(name) || /total|subtotal|carro|despacho|envio/i.test(name)) continue

    const finalPrice = prices[0]
    const normalPrice = prices.find(price => price > finalPrice) || null
    const packageInfo = parsePackageFromName(`${name} ${line}`)
    const candidate = normalizedCandidate({
      name,
      source_product_id: `manual-${index}-${normalizeWebText(name).slice(0, 100)}`,
      source_url: sourceUrl,
      normal_price: normalPrice,
      final_price: finalPrice,
      quantity: packageInfo.quantity,
      unit: packageInfo.unit,
      package_text: packageInfo.package_text,
      promotion_text: /(?:oferta|dcto|descuento|-\d+%)/i.test(line)
        ? (line.match(/(?:oferta|\d+%\s*dcto\.?|descuento|-\d+%)/i)?.[0] || '')
        : '',
      stock_status: /agotado|sin stock/i.test(line) ? 'out_of_stock' : 'unknown',
      raw_data: { capture_type: 'visible_text', line },
    }, context)
    if (candidate) output.push(candidate)
  }

  return dedupe(output, Math.max(1, Math.min(Number(maxProducts) || 100, 200)))
}

export function parseOfficialCatalogHtml({ html, provider, sourceUrl, category = '', maxProducts = 100 }) {
  const config = providerConfig(provider)
  if (!config) throw new Error('Proveedor no soportado.')
  const context = {
    provider,
    chainName: config.label,
    sourceUrl,
    category,
  }
  const fromJson = parseJsonScripts(html, context)
  const fromAnchors = parseAnchorCards(html, context)
  return dedupe([...fromJson, ...fromAnchors], Math.max(1, Math.min(Number(maxProducts) || 100, 200)))
}

export function isAllowedProviderUrl(provider, value) {
  const config = providerConfig(provider)
  if (!config) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && config.hosts.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function providerLabel(provider) {
  return providerConfig(provider)?.label || provider
}
