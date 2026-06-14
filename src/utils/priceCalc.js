/**
 * Calcula el precio unitario normalizado
 * - g  → precio por kg
 * - ml → precio por litro
 * - otros → precio por unidad base
 */
export function calcUnitPrice(price, quantity, unit) {
  if (!price || !quantity || quantity <= 0) return null
  const p = parseFloat(price)
  const q = parseFloat(quantity)

  switch (unit) {
    case 'g': return (p / q) * 1000
    case 'ml': return (p / q) * 1000
    default: return p / q
  }
}

export function unitLabel(unit) {
  const map = {
    unidad: 'unid.',
    kg: 'kg',
    g: 'kg',
    litro: 'litro',
    ml: 'litro',
    metro: 'metro',
    par: 'par',
    caja: 'caja',
  }
  return map[unit] ?? unit
}

export function formatCLP(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '—'
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(Math.round(Number(amount)))
}

export function formatUnitPrice(amount, unit) {
  if (amount == null || Number.isNaN(Number(amount))) return '—'
  return `${formatCLP(amount)} / ${unitLabel(unit)}`
}

export function pctChange(current, previous) {
  if (!previous || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export function priceChangeDisplay(pct) {
  if (pct == null) return { arrow: '—', color: 'text-slate-400', label: '—' }
  if (pct > 0) return { arrow: '↑', color: 'text-danger-500', label: `+${pct.toFixed(1)}%` }
  if (pct < 0) return { arrow: '↓', color: 'text-success-500', label: `${pct.toFixed(1)}%` }
  return { arrow: '→', color: 'text-slate-500', label: '0%' }
}

export const UNIDADES = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'g', label: 'Gramo (g) → se normaliza a kg' },
  { value: 'litro', label: 'Litro (L)' },
  { value: 'ml', label: 'Mililitro (ml) → se normaliza a litro' },
  { value: 'metro', label: 'Metro' },
  { value: 'par', label: 'Par' },
  { value: 'caja', label: 'Caja' },
]
