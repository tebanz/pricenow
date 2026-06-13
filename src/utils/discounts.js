export const DISCOUNT_TYPES = [
  { value: 'monto', label: 'Monto' },
  { value: 'porcentaje', label: 'Porcentaje' },
  { value: 'precio_promocional', label: 'Precio promocional' },
]

export const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'debito', label: 'Debito' },
  { value: 'credito', label: 'Credito' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'prepago', label: 'Prepago' },
  { value: 'billetera_digital', label: 'Billetera digital' },
  { value: 'tarjeta_tienda', label: 'Tarjeta de tienda' },
  { value: 'junaeb_baes', label: 'JUNAEB/BAES' },
  { value: 'otro', label: 'Otro' },
]

export function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find(method => method.value === value)?.label || value || 'Sin metodo'
}

export function discountTypeLabel(value) {
  return DISCOUNT_TYPES.find(type => type.value === value)?.label || value || 'Descuento'
}

export function calculateDiscountFinalPrice(normalPrice, discountType, discountValue) {
  const price = Number(normalPrice)
  const value = Number(discountValue)
  if (!Number.isFinite(price) || price <= 0) return null
  if (!Number.isFinite(value) || value < 0) return price

  if (discountType === 'monto') return Math.max(0, Math.round(price - value))
  if (discountType === 'porcentaje') return Math.max(0, Math.round(price * (1 - value / 100)))
  if (discountType === 'precio_promocional') return Math.max(0, Math.round(value))
  return price
}

export function effectivePrice(row = {}) {
  const finalPrice = Number(row.final_price)
  if (Number.isFinite(finalPrice) && finalPrice > 0) return finalPrice
  const price = Number(row.price)
  return Number.isFinite(price) && price > 0 ? price : null
}

export function hasOffer(row = {}) {
  if (row.has_discount) return true
  const normalPrice = Number(row.normal_price || row.price)
  const finalPrice = Number(row.final_price)
  return Number.isFinite(normalPrice) && Number.isFinite(finalPrice) && finalPrice > 0 && finalPrice < normalPrice
}

export function paymentConditionLabel(row = {}) {
  if (!row.requires_specific_payment_method || !row.payment_method) return ''
  return paymentMethodLabel(row.payment_method)
}
