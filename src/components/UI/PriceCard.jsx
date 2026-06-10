import { formatCLP, formatUnitPrice } from '../../utils/priceCalc'
import Badge from './Badge'

export default function PriceCard({ entry, isLowest = false }) {
  if (!entry) return null

  return (
    <div className={`card flex items-center justify-between gap-3 ${isLowest ? 'border-success-500/40 bg-success-50/30' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">
          {entry.product_name}
          {entry.brand && <span className="font-normal text-slate-400"> · {entry.brand}</span>}
        </p>
        <p className="text-xs text-slate-400 truncate">{entry.store_name} · {entry.sector}</p>
      </div>

      <div className="text-right shrink-0">
        <p className="font-bold text-brand-500">{formatCLP(entry.price ?? entry.precio_minimo)}</p>
        {(entry.unit_price || entry.precio_minimo_unitario) && (
          <p className="text-xs text-slate-400">
            {formatUnitPrice(entry.unit_price ?? entry.precio_minimo_unitario, entry.unit)}
          </p>
        )}
        {isLowest && <Badge status="lowest">Más barato</Badge>}
      </div>
    </div>
  )
}
