import { calcUnitPrice } from './priceCalc'
import { effectivePrice, hasOffer } from './discounts'
import {
  getDistanceMeters,
  isValidCoordinate,
  rowMatchesCity,
  rowMatchesSector,
  zoneCity,
  zoneSector,
} from './location'

export function normalizeCompareText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function embedded(value) {
  return Array.isArray(value) ? value[0] : value
}

export function normalizeUnit(unit = '') {
  const key = normalizeCompareText(unit)
  if (['kg', 'kilogramo', 'kilogramos'].includes(key)) return 'kg'
  if (['g', 'gr', 'gramo', 'gramos'].includes(key)) return 'g'
  if (['l', 'lt', 'litro', 'litros'].includes(key)) return 'litro'
  if (['ml', 'cc', 'mililitro', 'mililitros'].includes(key)) return 'ml'
  if (key === 'caja') return 'caja'
  if (key === 'par') return 'par'
  return 'unidad'
}

export function comparableUnit(unit = '') {
  const normalized = normalizeUnit(unit)
  if (normalized === 'g') return 'kg'
  if (normalized === 'ml') return 'litro'
  return normalized
}

export function normalizedPackage(quantity, unit) {
  const numericQuantity = Number(quantity)
  const safeQuantity = Number.isFinite(numericQuantity) && numericQuantity > 0 ? numericQuantity : 1
  const normalizedUnit = normalizeUnit(unit)
  if (normalizedUnit === 'g') return { quantity: safeQuantity / 1000, unit: 'kg' }
  if (normalizedUnit === 'ml') return { quantity: safeQuantity / 1000, unit: 'litro' }
  return { quantity: safeQuantity, unit: comparableUnit(normalizedUnit) }
}

export function formatPackage(quantity, unit) {
  const pack = normalizedPackage(quantity, unit)
  const rounded = Math.round(pack.quantity * 1000) / 1000
  return `${rounded.toString().replace('.', ',')} ${pack.unit}`
}

function productTokens(name = '') {
  const stopwords = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'sin', 'pack', 'bolsa', 'envase'])
  return normalizeCompareText(name)
    .split(' ')
    .filter(token => token && !stopwords.has(token) && !/^\d+(kg|g|ml|l|lt|cc)?$/.test(token))
    .sort()
    .join('_')
}

export function compareKeyFor({ productId, name, brand, quantity, unit }) {
  const pack = normalizedPackage(quantity, unit)
  const base = productId || `${normalizeCompareText(brand)}_${productTokens(name)}`
  return `${base}__${pack.quantity.toFixed(3)}_${pack.unit}`
}

export function formatDate(value) {
  if (!value) return 'Fecha sin dato'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha sin dato'
  return date.toLocaleDateString('es-CL')
}

export function storeKeyFor(row = {}) {
  const base = row.store_id || `${normalizeCompareText(row.store_name)}_${normalizeCompareText(row.branch_name)}`
  return `${base || 'sin_tienda'}__${row.source_channel || 'presencial'}`
}

function storeNameFrom(row = {}, store = {}) {
  return store.name || row.store_name || row.chain_name || 'Supermercado'
}

function branchNameFrom(row = {}, store = {}) {
  return store.branch_name || store.sector || row.sector || row.commune || row.city || ''
}

function coordinatesFrom(row = {}, store = {}) {
  const lat = row.latitude ?? store.latitude
  const lng = row.longitude ?? store.longitude
  return isValidCoordinate(lat, lng) ? { lat: Number(lat), lng: Number(lng) } : { lat: null, lng: null }
}

export function unifyPriceEntry(row = {}) {
  const product = embedded(row.product || row.products) || {}
  const store = embedded(row.store || row.stores) || {}
  if (store?.is_active === false) return null
  if (row.validation_status !== 'approved') return null

  const finalPrice = effectivePrice(row)
  if (!Number.isFinite(Number(finalPrice)) || Number(finalPrice) <= 0) return null

  const name = product.name || row.product_name || 'Producto sin nombre'
  const unit = normalizeUnit(row.unit || product.default_unit)
  const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 1
  const coords = coordinatesFrom(row, store)
  const normalPrice = Number(row.normal_price || row.price)
  const rowHasOffer = hasOffer(row)
  const productId = product.id || row.product_id || null

  return {
    id: `presencial-${row.id}`,
    raw_id: row.id,
    source_channel: 'presencial',
    source_label: 'Precio presencial',
    source_detail: 'Reportado por usuario',
    product_id: productId,
    product_name: name,
    brand: row.brand || '',
    category: product.category || 'Sin categoria',
    format_label: formatPackage(quantity, unit),
    quantity,
    unit,
    compare_key: compareKeyFor({ productId, name, brand: row.brand, quantity, unit }),
    final_price: Number(finalPrice),
    normal_price: rowHasOffer && normalPrice > Number(finalPrice) ? normalPrice : null,
    unit_price: calcUnitPrice(finalPrice, quantity, unit),
    has_offer: rowHasOffer,
    offer_text: '',
    payment_condition: '',
    store_id: row.store_id || store.id || null,
    store_name: storeNameFrom(row, store),
    branch_name: branchNameFrom(row, store),
    chain_name: store.chain_name || store.chain || row.chain_name || '',
    sector: store.sector || '',
    city: row.city || store.city || '',
    commune: row.commune || store.commune || '',
    region: store.region || '',
    latitude: coords.lat,
    longitude: coords.lng,
    date: row.created_at,
    availability: '',
    search_text: '',
  }
}

export function unifyWebObservation(row = {}) {
  const product = embedded(row.product || row.web_catalog_products) || {}
  const store = embedded(row.stores) || {}
  if (store?.is_active === false) return null

  const finalPrice = Number(row.final_price)
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) return null

  const name = product.name || 'Producto web'
  const unit = normalizeUnit(product.unit)
  const quantity = Number(product.quantity) > 0 ? Number(product.quantity) : 1
  const coords = coordinatesFrom(row, store)
  const productId = product.product_id || product.id || null
  const normalPrice = Number(row.normal_price)

  return {
    id: `web-${row.id}`,
    raw_id: row.id,
    source_channel: 'web',
    source_label: 'Precio web',
    source_detail: row.location_scope === 'online_national' ? 'Online Chile' : 'Catalogo oficial',
    product_id: productId,
    product_name: name,
    brand: product.brand || '',
    category: product.category || 'Sin categoria',
    format_label: product.package_text || formatPackage(quantity, unit),
    quantity,
    unit,
    compare_key: compareKeyFor({ productId, name, brand: product.brand, quantity, unit }),
    final_price: finalPrice,
    normal_price: normalPrice > finalPrice ? normalPrice : null,
    unit_price: Number(row.unit_price) > 0 ? Number(row.unit_price) : calcUnitPrice(finalPrice, quantity, unit),
    has_offer: normalPrice > finalPrice,
    offer_text: row.promotion_text || '',
    payment_condition: '',
    store_id: row.store_id || store.id || null,
    store_name: storeNameFrom(row, store),
    branch_name: branchNameFrom(row, store),
    chain_name: store.chain_name || store.chain || row.chain_name || '',
    sector: store.sector || '',
    city: row.city || store.city || '',
    commune: row.commune || store.commune || '',
    region: store.region || '',
    latitude: coords.lat,
    longitude: coords.lng,
    date: row.captured_at,
    availability: row.stock_status || '',
    location_scope: row.location_scope,
    location_verified: Boolean(row.location_verified),
    source_url: row.source_url || '',
    search_text: '',
  }
}

export function enrichSearchText(row = {}) {
  return {
    ...row,
    search_text: normalizeCompareText([
      row.product_name,
      row.brand,
      row.format_label,
      row.category,
      row.store_name,
      row.chain_name,
    ].filter(Boolean).join(' ')),
  }
}

export function filterRowsByTerritory(rows, zoneMode, zone) {
  if (zoneMode === 'all') return rows

  if (zoneMode === 'city') {
    if (!zoneCity(zone)) return rows.filter(row => row.source_channel === 'web' && row.location_scope === 'online_national')
    return rows.filter(row => (
      (row.source_channel === 'web' && row.location_scope === 'online_national') ||
      rowMatchesCity(row, zone)
    ))
  }

  if (zoneMode === 'sector') {
    if (!zoneSector(zone)) return []
    return rows.filter(row => row.source_channel !== 'web' || row.location_scope === 'branch_confirmed')
      .filter(row => rowMatchesSector(row, zone))
  }

  if (zoneMode === 'nearby') {
    if (!isValidCoordinate(zone?.lat, zone?.lng)) return []
    return rows
      .map(row => ({
        ...row,
        distance_m: getDistanceMeters(zone.lat, zone.lng, row.latitude, row.longitude),
      }))
      .filter(row => row.distance_m != null && row.distance_m <= 8000)
  }

  return rows
}

export function filterComparableRows(rows, { query = '', category = 'all', zoneMode = 'nearby', zone = null } = {}) {
  const term = normalizeCompareText(query)
  const filtered = (rows || [])
    .filter(row => !term || row.search_text.includes(term))
    .filter(row => category === 'all' || row.category === category)
  return filterRowsByTerritory(filtered, zoneMode, zone)
}

export function groupRowsByFormat(rows) {
  const groups = new Map()
  ;(rows || []).forEach(row => {
    if (!groups.has(row.compare_key)) {
      groups.set(row.compare_key, {
        key: row.compare_key,
        product_name: row.product_name,
        brand: row.brand,
        format_label: row.format_label,
        category: row.category,
        rows: [],
      })
    }
    groups.get(row.compare_key).rows.push(row)
  })
  return Array.from(groups.values())
    .map(group => ({
      ...group,
      rows: group.rows.slice().sort((a, b) => a.final_price - b.final_price),
      min_price: Math.min(...group.rows.map(row => row.final_price)),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || a.min_price - b.min_price)
}

export function buildListSummary(listItems, rows) {
  const items = (listItems || []).filter(item => Number(item.quantity) > 0)
  const rowPool = rows || []
  const bestItems = []
  const missingItems = []

  items.forEach(item => {
    const matches = rowPool
      .filter(row => row.compare_key === item.compare_key)
      .sort((a, b) => a.final_price - b.final_price)
    if (!matches.length) {
      missingItems.push(item)
      return
    }
    const best = matches[0]
    bestItems.push({
      item,
      row: best,
      subtotal: best.final_price * Number(item.quantity),
    })
  })

  const combinedTotal = bestItems.reduce((sum, item) => sum + item.subtotal, 0)
  const storeOptions = new Map()

  rowPool.forEach(row => {
    const key = storeKeyFor(row)
    if (!storeOptions.has(key)) {
      storeOptions.set(key, {
        store_key: key,
        store_name: row.store_name,
        branch_name: row.branch_name,
        rows_by_product: new Map(),
      })
    }
    const option = storeOptions.get(key)
    const previous = option.rows_by_product.get(row.compare_key)
    if (!previous || row.final_price < previous.final_price) option.rows_by_product.set(row.compare_key, row)
  })

  const singleStoreOptions = Array.from(storeOptions.values())
    .map(store => {
      let total = 0
      const lines = []
      for (const item of items) {
        const row = store.rows_by_product.get(item.compare_key)
        if (!row) return null
        const subtotal = row.final_price * Number(item.quantity)
        total += subtotal
        lines.push({ item, row, subtotal })
      }
      return { ...store, total, lines }
    })
    .filter(Boolean)
    .sort((a, b) => a.total - b.total)

  const singleStoreBest = singleStoreOptions[0] || null
  const maxComparableTotal = bestItems.reduce((sum, best) => {
    const highest = rowPool
      .filter(row => row.compare_key === best.item.compare_key)
      .sort((a, b) => b.final_price - a.final_price)[0]
    return sum + (highest ? highest.final_price * Number(best.item.quantity) : 0)
  }, 0)
  const estimatedSavings = Math.max(0, maxComparableTotal - combinedTotal)

  return {
    bestItems,
    missingItems,
    combinedTotal,
    singleStoreBest,
    estimatedSavings,
  }
}
