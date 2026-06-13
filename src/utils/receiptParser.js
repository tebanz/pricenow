export const RECEIPT_PARSER_VERSION = 'receipt-parser-v2'

export const RECEIPT_TYPES = {
  ITEMIZED: 'itemized_receipt',
  SUMMARY: 'summary_receipt',
  PAYMENT: 'payment_voucher',
  UNKNOWN: 'unknown_document',
}

const ADMIN_LINE_PATTERNS = [
  /\b(direccion|domicilio|calle|avda|avenida|pasaje|camino|local|mall|piso)\b/i,
  /\b(rut|giro|razon social|sii|folio|boleta|factura|documento)\b/i,
  /\b(fecha|hora)\b/i,
  /\b(aprobacion|aprobado|comprobante|voucher|terminal|version|autorizacion|auth|cajero|caja|sucursal|cuotas?)\b/i,
  /\b(telefono|fono|whatsapp|web|www|\.cl|\.com)\b/i,
  /\b(total|subtotal|sub total|vuelto|cambio|efectivo|redcompra|debito|credito|tarjeta|propina|iva|neto)\b/i,
  /\b(codigo|cod\.?|transaccion|operacion|numero de pedido|pedido|referencia)\b/i,
]

const ADDRESS_PATTERN = /\b(direccion|calle|avda|avenida|pasaje|camino)\b/i
const DATE_PATTERN = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/
const RUT_PATTERN = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/
const LONG_CODE_PATTERN = /\b(?:\d[ -]?){8,}\b/
const CARD_LIKE_PATTERN = /\b(?:\d[ -]?){12,19}\b/
const PRODUCT_PRICE_PATTERN = /\$?\s*-?\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\$?\s*-?\d{3,6}/g
const DISCOUNT_PATTERN = /\b(descuento|dcto|dscto|desc|rebaja|promocion)\b/i
const GENERAL_DISCOUNT_PATTERN = /\b(total|general|global|subtotal|sub total|neto|iva)\b/i
const VOUCHER_PATTERN = /\b(comprobante|voucher|aprobacion|aprobado|terminal|autorizacion|tarjeta|redcompra|cuotas?|transaccion|operacion)\b/i
const SUMMARY_PATTERN = /\b(neto|iva|subtotal|sub total|total)\b/i
const TOTAL_PATTERN = /\b(total|monto total|total venta)\b/i
const NET_PATTERN = /\b(neto|monto neto)\b/i
const TAX_PATTERN = /\b(iva|impuesto)\b/i
const SUBTOTAL_PATTERN = /\b(subtotal|sub total)\b/i
const PAYMENT_PATTERNS = [
  ['junaeb_baes', /\b(junaeb|baes|sodexo|edenred)\b/i],
  ['debito', /\b(debito|redcompra)\b/i],
  ['credito', /\b(credito|credit)\b/i],
  ['efectivo', /\b(efectivo|cash)\b/i],
  ['transferencia', /\btransferencia\b/i],
  ['prepago', /\bprepago\b/i],
  ['billetera_digital', /\b(billetera|mercado pago|mach|tenpo)\b/i],
  ['tarjeta_tienda', /\b(cmr|ripley|paris|tarjeta tienda|tarjeta de tienda)\b/i],
]

export function normalizeReceiptText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function sanitizeReceiptText(text = '') {
  return text
    .replace(CARD_LIKE_PATTERN, '[numero protegido]')
    .replace(/\b(?:aut|auth|autorizacion|codigo|cod)\s*[:#-]?\s*[a-z0-9-]{4,}\b/gi, match => match.replace(/[:#-]?\s*[a-z0-9-]{4,}$/i, ' [protegido]'))
    .replace(/\b(?:cuenta|tarjeta)\s*[:#-]?\s*[\d* -]{4,}\b/gi, match => match.replace(/[:#-]?\s*[\d* -]{4,}$/i, ' [protegido]'))
}

function plainLineText(line) {
  if (typeof line === 'string') return line
  return line?.text || line?.symbols?.map(symbol => symbol.text).join('') || ''
}

export function extractReceiptOcrLines(source = '') {
  if (typeof source === 'string') {
    return source
      .split(/\r?\n/)
      .map((text, index) => ({ text, index, confidence: null, bbox: null, words: [] }))
  }

  const blocks = Array.isArray(source?.blocks) ? source.blocks : []
  const nestedLines = blocks
    .flatMap(block => block.paragraphs || block.lines || [])
    .flatMap(node => node.lines || [node])
    .filter(Boolean)

  const sourceLines = Array.isArray(source?.lines) && source.lines.length
    ? source.lines
    : nestedLines

  if (sourceLines.length) {
    return sourceLines.map((line, index) => ({
      text: plainLineText(line),
      index,
      confidence: normalizeConfidence(line.confidence ?? line.conf ?? null),
      bbox: line.bbox || line.boundingBox || null,
      words: Array.isArray(line.words) ? line.words.map(word => ({
        text: plainLineText(word),
        confidence: normalizeConfidence(word.confidence ?? word.conf ?? null),
        bbox: word.bbox || word.boundingBox || null,
      })) : [],
    }))
  }

  return (source?.text || '')
    .split(/\r?\n/)
    .map((text, index) => ({ text, index, confidence: null, bbox: null, words: [] }))
}

function normalizeConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric)
}

export function isAdministrativeReceiptLine(line = '') {
  const normalized = normalizeReceiptText(line)
  if (!normalized) return true
  if (ADMIN_LINE_PATTERNS.some(pattern => pattern.test(normalized))) return true
  if (DATE_PATTERN.test(line) || TIME_PATTERN.test(line) || RUT_PATTERN.test(line)) return true
  if (LONG_CODE_PATTERN.test(line)) return true
  return false
}

function parseSignedAmount(raw = '', maxDigits = 7) {
  const negative = /-/.test(raw)
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits || digits.length > maxDigits) return null
  const amount = Number(digits)
  if (!Number.isFinite(amount)) return null
  return negative ? -amount : amount
}

function amountLooksLikeDateRutFolioOrCode(line, match) {
  const start = match.index
  const end = start + match.raw.length
  const before = line.slice(Math.max(0, start - 3), start)
  const after = line.slice(end, Math.min(line.length, end + 3))
  const normalized = normalizeReceiptText(line)
  const value = Math.abs(match.value)

  if (DATE_PATTERN.test(line) || TIME_PATTERN.test(line) || RUT_PATTERN.test(line)) return true
  if (/\b(folio|codigo|cod|terminal|autorizacion|aprobacion|transaccion|operacion)\b/.test(normalized)) return true
  if (/[/:]/.test(before) || /[/:]/.test(after)) return true
  if (/\d/.test(before) && /\d/.test(after)) return true
  if (value >= 1900 && value <= 2099 && /\b(fecha|ano|año)\b/.test(normalized)) return true
  return false
}

export function extractReceiptPrices(line = '', options = {}) {
  const { allowLargeTotal = false, requireCurrency = false } = options
  const matches = []

  for (const match of line.matchAll(PRODUCT_PRICE_PATTERN)) {
    const raw = match[0]
    const hasCurrency = raw.includes('$')
    if (requireCurrency && !hasCurrency) continue

    const value = parseSignedAmount(raw, allowLargeTotal ? 8 : 7)
    if (value == null) continue
    const candidate = { raw, value, index: match.index ?? 0, hasCurrency }
    if (amountLooksLikeDateRutFolioOrCode(line, candidate)) continue

    const absolute = Math.abs(value)
    if (absolute < 50) continue
    if (!allowLargeTotal && absolute > 1000000) continue
    if (allowLargeTotal && absolute > 20000000) continue

    matches.push(candidate)
  }

  return matches
}

function priceIsNearEnd(line, price) {
  const end = price.index + price.raw.length
  return line.slice(end).replace(/[^\p{L}\p{N}]/gu, '').length <= 3 || end >= line.length - 10
}

function cleanProductName(line = '', prices = []) {
  let cleaned = line
  prices.forEach(price => {
    cleaned = cleaned.replace(price.raw, ' ')
  })
  return cleaned
    .replace(/\b\d+(?:[,.]\d+)?\s*(x|un|und|u|kg|g|gr|lt|l)\b/gi, ' ')
    .replace(/\b(cod|sku|plu)\s*[:#-]?\s*\w+\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectQuantity(line = '') {
  const unitMatch = line.match(/\b(\d+(?:[,.]\d+)?)\s*(un|und|u|kg|g|gr|lt|l)\b/i)
  if (unitMatch) {
    const quantity = Number(unitMatch[1].replace(',', '.'))
    return {
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit: normalizeUnit(unitMatch[2]),
    }
  }

  const multiplierMatch = line.match(/\b(\d+(?:[,.]\d+)?)\s*x\s*(\$?\s*\d{2,6}(?:[.\s]\d{3})?)\b/i)
  if (multiplierMatch) {
    const quantity = Number(multiplierMatch[1].replace(',', '.'))
    return {
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit: 'unidad',
      unitPrice: parseSignedAmount(multiplierMatch[2]),
    }
  }

  return { quantity: 1, unit: 'unidad', unitPrice: null }
}

function normalizeUnit(unit = '') {
  const normalized = normalizeReceiptText(unit)
  if (['kg', 'g', 'gr'].includes(normalized)) return normalized === 'kg' ? 'kg' : 'g'
  if (['lt', 'l'].includes(normalized)) return 'litro'
  return 'unidad'
}

function detectPaymentMethod(text = '') {
  const found = PAYMENT_PATTERNS.find(([, pattern]) => pattern.test(text))
  return found?.[0] || ''
}

function detectReceiptDate(text = '') {
  const match = text.match(DATE_PATTERN)
  if (!match) return ''
  const day = Number(match[1])
  const month = Number(match[2])
  const rawYear = Number(match[3])
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  if (!day || !month || month > 12 || day > 31) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function guessReceiptStoreName(lines = []) {
  return lines.slice(0, 10).find(line => {
    const text = line.text || ''
    const normalized = normalizeReceiptText(text)
    if (normalized.length < 3) return false
    if (ADDRESS_PATTERN.test(text) || isAdministrativeReceiptLine(text)) return false
    if (!/[a-záéíóúñ]/i.test(text)) return false
    return true
  })?.text || ''
}

function guessReceiptAddress(lines = []) {
  return lines.find(line => ADDRESS_PATTERN.test(line.text || ''))?.text || ''
}

function detectAmountByLabel(lines = [], pattern) {
  const line = lines.find(candidate => pattern.test(candidate.text || ''))
  if (!line) return null
  const prices = extractReceiptPrices(line.text, { allowLargeTotal: true })
  return prices.map(price => Math.abs(price.value)).filter(Boolean).at(-1) || null
}

function detectTotalAmount(lines = []) {
  const totalLines = lines.filter(line => TOTAL_PATTERN.test(line.text || ''))
  const last = totalLines.at(-1)
  if (!last) return null
  const prices = extractReceiptPrices(last.text, { allowLargeTotal: true })
  return prices.map(price => Math.abs(price.value)).filter(Boolean).at(-1) || null
}

function receiptSimilarity(a = '', b = '') {
  const A = new Set(normalizeReceiptText(a).split(' ').filter(Boolean))
  const B = new Set(normalizeReceiptText(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let same = 0
  A.forEach(token => { if (B.has(token)) same += 1 })
  return same / Math.max(A.size, B.size)
}

function suggestReceiptProduct(name, products = []) {
  return products
    .map(product => ({ ...product, score: receiptSimilarity(name, `${product.name} ${product.category || ''} ${product.subcategory || ''}`) }))
    .sort((a, b) => b.score - a.score)[0] || null
}

function confidenceForLine({ line, productName, prices, nearEndPrice }) {
  let score = 0
  const letters = (productName.match(/\p{L}/gu) || []).length
  const tokens = normalizeReceiptText(productName).split(' ').filter(Boolean)

  if (letters >= 4) score += 2
  if (tokens.length >= 1) score += 1
  if (tokens.length >= 2) score += 1
  if (prices.length > 0) score += 1
  if (nearEndPrice) score += 3
  if (nearEndPrice?.hasCurrency) score += 1
  if (/[.\s]\d{3}/.test(nearEndPrice?.raw || '')) score += 1
  if (/\b\d+(?:[,.]\d+)?\s*(un|und|u|kg|g|gr|lt|l)\b/i.test(line.text || '')) score += 1
  if (line.confidence == null || line.confidence >= 72) score += 1
  if (line.confidence != null && line.confidence < 50) score -= 3
  if (/^\d/.test(productName) || productName.length < 3) score -= 2
  if (LONG_CODE_PATTERN.test(line.text || '')) score -= 4

  if (score >= 7) return 'alta'
  if (score >= 5) return 'media'
  return 'baja'
}

function parseProductLine(line, products = []) {
  const text = line.text || ''
  if (isAdministrativeReceiptLine(text)) return null

  const prices = extractReceiptPrices(text)
  if (!prices.length) return null

  const nearEndPrice = [...prices].reverse().find(price => price.value > 0 && priceIsNearEnd(text, price))
  if (!nearEndPrice) return null
  if (Math.abs(nearEndPrice.value) > 1000000) return null

  const quantityInfo = detectQuantity(text)
  const productName = cleanProductName(text, prices)
  if (!/[a-záéíóúñ]/i.test(productName)) return null
  if (normalizeReceiptText(productName).length < 3) return null

  const confidence = confidenceForLine({ line, productName, prices, nearEndPrice })
  if (confidence !== 'alta') return null

  const finalPrice = prices.length === 1 && quantityInfo.unitPrice && quantityInfo.quantity > 1
    ? Math.round(quantityInfo.unitPrice * quantityInfo.quantity)
    : Math.abs(nearEndPrice.value)
  const firstPositive = prices.find(price => price.value > 0)
  const normalPrice = prices.length >= 2 && firstPositive ? Math.abs(firstPositive.value) : finalPrice
  const discount = normalPrice > finalPrice ? normalPrice - finalPrice : 0
  const suggestion = suggestReceiptProduct(productName, products)

  return {
    local_id: `${line.index}-${normalizeReceiptText(productName) || 'item'}`,
    line_index: line.index,
    original_text: text,
    product_name: suggestion?.score >= 0.34 ? suggestion.name : productName,
    suggested_product_id: suggestion?.score >= 0.34 ? suggestion.id : null,
    suggested_product_name: suggestion?.score >= 0.34 ? suggestion.name : '',
    quantity: quantityInfo.quantity,
    unit: suggestion?.default_unit || quantityInfo.unit || 'unidad',
    normal_price: normalPrice,
    discount_amount: discount,
    final_price: finalPrice,
    discount_source: discount > 0 ? 'receipt' : null,
    include_in_report: true,
    confidence,
    ocr_confidence: line.confidence,
    bbox: line.bbox,
    words: line.words || [],
    discarded: false,
  }
}

export function classifyReceiptDocument(lines = [], productCandidates = []) {
  const normalizedText = normalizeReceiptText(lines.map(line => line.text).join(' '))
  const voucherSignals = lines.filter(line => VOUCHER_PATTERN.test(line.text || '')).length
  const summarySignals = lines.filter(line => SUMMARY_PATTERN.test(line.text || '')).length
  const hasTotal = TOTAL_PATTERN.test(normalizedText)
  const hasNetTaxSummary = NET_PATTERN.test(normalizedText) || TAX_PATTERN.test(normalizedText) || SUBTOTAL_PATTERN.test(normalizedText)
  const hasProductCandidates = productCandidates.length > 0

  if (hasProductCandidates) {
    return { receipt_type: RECEIPT_TYPES.ITEMIZED, parser_confidence: 'alta' }
  }

  if (voucherSignals >= 2 || (VOUCHER_PATTERN.test(normalizedText) && /\b(aprobacion|terminal|cuotas?|autorizacion)\b/.test(normalizedText))) {
    return { receipt_type: RECEIPT_TYPES.PAYMENT, parser_confidence: 'media' }
  }

  if (hasTotal && (hasNetTaxSummary || summarySignals >= 2)) {
    return { receipt_type: RECEIPT_TYPES.SUMMARY, parser_confidence: 'media' }
  }

  return { receipt_type: RECEIPT_TYPES.UNKNOWN, parser_confidence: 'baja' }
}

function reconcileItemsWithTotals(items, meta) {
  if (!items.length) return { items, warning: '', parserConfidence: meta.parser_confidence }

  const detectedSum = items.reduce((sum, item) => sum + Number(item.final_price || 0), 0)
  const targets = [meta.subtotal_amount, meta.net_amount, meta.total_amount]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)

  if (!targets.length || !detectedSum) return { items, warning: '', parserConfidence: meta.parser_confidence }

  const bestDifference = Math.min(...targets.map(target => Math.abs(detectedSum - target) / target))
  if (bestDifference <= 0.15) return { items, warning: '', parserConfidence: meta.parser_confidence }

  return {
    items: items.map(item => ({ ...item, confidence: 'media', include_in_report: false })),
    warning: 'La suma de productos detectados no coincide con el total de la boleta. Revisa las líneas antes de incluirlas.',
    parserConfidence: 'media',
  }
}

export function parseReceiptOcr(source = '', products = []) {
  const rawText = typeof source === 'string' ? source : source?.text || ''
  const sanitizedText = sanitizeReceiptText(rawText)
  const lines = extractReceiptOcrLines(source)
    .map(line => ({ ...line, text: sanitizeReceiptText(line.text || '').replace(/\s+/g, ' ').trim() }))
    .filter(line => line.text)

  const initialProducts = []
  let generalDiscountAmount = 0
  let hasGeneralDiscount = false

  lines.forEach(line => {
    const text = line.text
    const isDiscountLine = DISCOUNT_PATTERN.test(text)
    const isGeneralDiscountLine = isDiscountLine && GENERAL_DISCOUNT_PATTERN.test(text)
    const prices = extractReceiptPrices(text)

    if (isDiscountLine && !isGeneralDiscountLine && initialProducts.length) {
      const discount = Math.abs(prices.at(-1)?.value || 0)
      const last = initialProducts[initialProducts.length - 1]
      if (discount > 0 && discount < Number(last.normal_price || last.final_price || 0)) {
        last.discount_amount = discount
        last.final_price = Math.max(0, Number(last.normal_price || last.final_price) - discount)
        last.discount_source = 'receipt'
        return
      }
    }

    if (isDiscountLine || isGeneralDiscountLine) {
      const discount = Math.abs(prices.at(-1)?.value || 0)
      if (discount > 0) generalDiscountAmount += discount
      hasGeneralDiscount = true
      return
    }

    const product = parseProductLine(line, products)
    if (product) initialProducts.push(product)
  })

  const classification = classifyReceiptDocument(lines, initialProducts)
  const baseMeta = {
    store_name: guessReceiptStoreName(lines),
    store_address: guessReceiptAddress(lines),
    purchase_date: detectReceiptDate(sanitizedText),
    net_amount: detectAmountByLabel(lines, NET_PATTERN),
    tax_amount: detectAmountByLabel(lines, TAX_PATTERN),
    subtotal_amount: detectAmountByLabel(lines, SUBTOTAL_PATTERN),
    total_amount: detectTotalAmount(lines),
    payment_method: detectPaymentMethod(sanitizedText),
    general_discount_amount: generalDiscountAmount || null,
    has_general_discount: hasGeneralDiscount,
    receipt_type: classification.receipt_type,
    has_itemized_products: classification.receipt_type === RECEIPT_TYPES.ITEMIZED,
    parser_confidence: classification.parser_confidence,
    parser_version: RECEIPT_PARSER_VERSION,
    reconciliation_warning: '',
  }

  if (classification.receipt_type !== RECEIPT_TYPES.ITEMIZED) {
    return {
      sanitizedText,
      lines,
      items: [],
      meta: {
        ...baseMeta,
        possible_products_count: 0,
        confident_products_count: 0,
      },
    }
  }

  const reconciled = reconcileItemsWithTotals(initialProducts, baseMeta)
  const items = reconciled.items
  const meta = {
    ...baseMeta,
    parser_confidence: reconciled.parserConfidence,
    reconciliation_warning: reconciled.warning,
    possible_products_count: items.length,
    confident_products_count: items.filter(item => item.confidence === 'alta').length,
  }

  return { sanitizedText, lines, items, meta }
}
