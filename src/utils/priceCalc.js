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

export const SECTORES_RANCAGUA = [
  'Centro',
  'Rancagua Norte',
  'Rancagua Sur',
  'Rancagua Oriente',
  'Rancagua Poniente',
  'Alameda',
  'Av. República de Chile',
  'Baquedano',
  'Campos',
  'Carretera del Cobre',
  'Centro Histórico',
  'El Tenis',
  'El Trébol',
  'Kennedy',
  'La Compañía',
  'La Granja',
  'Las Américas',
  'Los Alpes',
  'Los Héroes',
  'Los Libertadores',
  'Manzanal',
  'Membrillar',
  'Millares',
  'Nueva Rancagua',
  'Parque Koke',
  'Recreo',
  'San Joaquín',
  'Santa Julia',
  'Santa María',
  'Santa Elena',
  'Villa Alameda',
  'Villa Alto Jahuel',
  'Villa Araucanía',
  'Villa Bicentenario',
  'Villa Bosques de San Francisco',
  'Villa Brisas del Sur',
  'Villa Chiprodal',
  'Villa Cordillera I',
  'Villa Cordillera II',
  'Villa Córdoba',
  'Villa Coya Pangal',
  'Villa De Blanco',
  'Villa Don Mateo',
  'Villa El Bosque',
  'Villa El Cobre',
  'Villa El Manzanal',
  'Villa El Molino',
  'Villa El Sol',
  'Villa El Sol III',
  'Villa El Trigal',
  'Villa Esperanza',
  'Villa Esperanza Norte',
  'Villa Galilea',
  'Villa Hermosa',
  'Villa Héctor Olivares Solís',
  'Villa La Araucana',
  'Villa La Foresta',
  'Villa La Hacienda',
  'Villa La Reina',
  'Villa Laguna del Inca',
  'Villa Las Cañadas',
  'Villa Las Cumbres',
  'Villa Las Rosas',
  'Villa Los Alpes',
  'Villa Los Castaños',
  'Villa Los Jardines',
  'Villa Los Parques',
  'Villa Los Tilos',
  'Villa Los Tilos 3 y 4',
  'Villa Luna',
  'Villa Magisterio',
  'Villa Magisterio II',
  'Villa María Luisa',
  'Villa Padre Hurtado',
  'Villa Parque María Luisa',
  'Villa Parque Viña Santa Blanca',
  'Villa Portal del Inca',
  'Villa Profesor Almonacid',
  'Villa Pucará',
  'Villa Pucará 1',
  'Villa Rancagua Norte',
  'Villa San Francisco',
  'Villa San Ramón',
  'Villa Santa Blanca',
  'Villa Santa Clara',
  'Villa Santa Filomena',
  'Villa Santa Isabel',
  'Villa Santa Julia',
  'Villa Santa María',
  'Villa Sargento Aldea',
  'Villa Triana',
  'Otro / No aparece mi sector',
]

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
