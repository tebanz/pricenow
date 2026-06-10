import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP, formatUnitPrice, SECTORES_RANCAGUA } from '../utils/priceCalc'
import Spinner from '../components/UI/Spinner'

export default function Ranking() {
  const [query,   setQuery]   = useState('')
  const [sector,  setSector]  = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async () => {
    setLoading(true)
    setSearched(true)

    const { data, error } = await supabase.rpc('get_price_ranking', {
      p_product_name: query.trim() || null,
      p_sector:       sector       || null,
      p_limit:        30,
    })

    if (!error && data) setResults(data)
    setLoading(false)
  }, [query, sector])

  // Cargar top 20 al entrar
  useEffect(() => { search() }, []) // eslint-disable-line

  function handleSearch(e) {
    e.preventDefault()
    search()
  }

  // Agrupar resultados por producto
  const grouped = results.reduce((acc, row) => {
    const key = `${row.product_name}__${row.brand ?? ''}`
    if (!acc[key]) acc[key] = { product_name: row.product_name, brand: row.brand, unit: row.unit, stores: [] }
    acc[key].stores.push(row)
    return acc
  }, {})

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Ranking de precios</h2>
      <p className="text-sm text-slate-500 mb-4">Precios más bajos en los últimos 30 días.</p>

      {/* Buscador */}
      <form onSubmit={handleSearch} className="space-y-3 mb-5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Buscar producto…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input-field flex-1"
          />
          <button
            type="submit"
            className="bg-brand-500 text-white px-4 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          >
            Buscar
          </button>
        </div>
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          className="input-field"
        >
          <option value="">Todos los sectores</option>
          {SECTORES_RANCAGUA.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </form>

      {loading && <Spinner />}

      {!loading && searched && results.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-slate-500 text-sm">
            Sin resultados. Intenta con otro producto o sector.
          </p>
        </div>
      )}

      {!loading && Object.values(grouped).map((group, gi) => (
        <div key={gi} className="mb-5">
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="font-bold text-slate-800">{group.product_name}</h3>
            {group.brand && <span className="text-xs text-slate-400">{group.brand}</span>}
          </div>

          <div className="space-y-2">
            {group.stores
              .sort((a, b) => a.precio_minimo_unitario - b.precio_minimo_unitario)
              .map((row, i) => (
                <div
                  key={i}
                  className={`card flex items-center justify-between gap-3 ${
                    i === 0 ? 'border-success-500/40 bg-success-50/30 animate-pulse-green' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i === 0
                        ? 'bg-success-500 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{row.store_name}</p>
                      <p className="text-xs text-slate-400 truncate">{row.sector}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-bold text-brand-500 text-base">{formatCLP(row.precio_minimo)}</p>
                    <p className="text-xs text-slate-400">
                      {formatUnitPrice(row.precio_minimo_unitario, row.unit)}
                    </p>
                    {i === 0 && (
                      <span className="badge-lowest mt-1">
                        <svg className="w-3 h-3 fill-success-600" viewBox="0 0 24 24">
                          <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                        </svg>
                        Más barato
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>

          <p className="text-xs text-slate-400 mt-1 text-right">
            {group.stores[0]?.cantidad_registros ?? 0} registros ·
            última actualización: {group.stores[0]?.ultima_actualizacion ?? '—'}
          </p>
        </div>
      ))}
    </div>
  )
}
