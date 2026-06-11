import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function money(value) {
  return Number(value || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

export default function FavoritesAlerts() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [favorites, setFavorites] = useState([])
  const [alerts, setAlerts] = useState([])
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [sector, setSector] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!user?.id) return
    setLoading(true)
    const [productsRes, favoritesRes, alertsRes, entriesRes] = await Promise.all([
      supabase.from('products').select('id, name, category, default_unit').eq('is_active', true).order('name').limit(500),
      supabase.from('user_favorite_products').select('id, product_id, products(id, name, category, default_unit)').eq('user_id', user.id),
      supabase.from('price_alerts').select('*, products(id, name, category, default_unit)').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('price_entries').select('id, product_id, product_name, store_name, sector, unit_price, purchase_date, created_at').eq('validation_status', 'approved').order('created_at', { ascending: false }).limit(300),
    ])
    if (productsRes.error || favoritesRes.error || alertsRes.error || entriesRes.error) {
      setMessage({ type: 'error', text: productsRes.error?.message || favoritesRes.error?.message || alertsRes.error?.message || entriesRes.error?.message })
    }
    setProducts(productsRes.data || [])
    setFavorites(favoritesRes.data || [])
    setAlerts(alertsRes.data || [])
    setEntries(entriesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user?.id])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(product => !q || `${product.name} ${product.category}`.toLowerCase().includes(q)).slice(0, 60)
  }, [products, query])

  const favoriteProductIds = new Set(favorites.map(f => f.product_id))

  const alertMatches = useMemo(() => {
    return alerts.map(alert => {
      const matches = entries
        .filter(entry => {
          if (alert.product_id && entry.product_id !== alert.product_id) return false
          if (alert.sector && entry.sector !== alert.sector) return false
          return Number(entry.unit_price || 0) <= Number(alert.target_unit_price)
        })
        .slice(0, 3)
      return { alert, matches }
    })
  }, [alerts, entries])

  async function addFavorite(productId) {
    const { error } = await supabase.from('user_favorite_products').insert({ user_id: user.id, product_id: productId })
    if (error && !error.message.includes('duplicate')) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'ok', text: 'Producto agregado a favoritos.' })
    await load()
  }

  async function removeFavorite(id) {
    const { error } = await supabase.from('user_favorite_products').delete().eq('id', id)
    if (error) return setMessage({ type: 'error', text: error.message })
    await load()
  }

  async function createAlert(event) {
    event.preventDefault()
    if (!selectedProduct || !targetPrice) return
    const product = products.find(item => item.id === selectedProduct)
    const { error } = await supabase.from('price_alerts').insert({
      user_id: user.id,
      product_id: selectedProduct,
      product_name: product?.name || null,
      target_unit_price: Number(targetPrice),
      sector: sector || null,
    })
    if (error) return setMessage({ type: 'error', text: error.message })
    setSelectedProduct('')
    setTargetPrice('')
    setSector('')
    setMessage({ type: 'ok', text: 'Alerta creada.' })
    await load()
  }

  async function toggleAlert(alert) {
    const { error } = await supabase.from('price_alerts').update({ is_active: !alert.is_active, updated_at: new Date().toISOString() }).eq('id', alert.id)
    if (error) return setMessage({ type: 'error', text: error.message })
    await load()
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="rounded-[2rem] bg-gradient-to-br from-emerald-500 via-teal-500 to-blue-600 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-50">Personalización</p>
        <h1 className="mt-2 text-2xl font-black">Favoritos y alertas</h1>
        <p className="mt-2 text-sm text-emerald-50">Sigue productos importantes y revisa oportunidades de precios dentro de la app.</p>
      </section>

      {message && <div className={`rounded-2xl border p-3 text-sm font-semibold ${message.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="font-black text-slate-900">Crear alerta</h2>
        <form onSubmit={createAlert} className="mt-3 grid gap-2">
          <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
            <option value="">Selecciona producto</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.name} · por {product.default_unit || 'unidad'}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="1" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Precio objetivo" />
            <input value={sector} onChange={e => setSector(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm" placeholder="Sector opcional" />
          </div>
          <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">Crear alerta</button>
        </form>
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="font-black text-slate-900">Mis favoritos</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {favorites.length === 0 && <p className="text-sm text-slate-500">Todavía no tienes favoritos.</p>}
          {favorites.map(fav => (
            <button key={fav.id} onClick={() => removeFavorite(fav.id)} className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
              {fav.products?.name || 'Producto'} ×
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar productos para seguir..." className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" />
        {filteredProducts.map(product => (
          <div key={product.id} className="flex items-center justify-between rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div>
              <p className="font-black text-slate-900">{product.name}</p>
              <p className="text-xs text-slate-500">{product.category || 'Sin categoría'} · por {product.default_unit || 'unidad'}</p>
            </div>
            <button disabled={favoriteProductIds.has(product.id)} onClick={() => addFavorite(product.id)} className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">
              {favoriteProductIds.has(product.id) ? 'Seguido' : 'Seguir'}
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-black text-slate-900">Alertas activas</h2>
        {loading && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">Cargando...</div>}
        {alertMatches.length === 0 && !loading && <div className="rounded-3xl bg-white p-5 text-sm text-slate-500 shadow-sm">No tienes alertas creadas.</div>}
        {alertMatches.map(({ alert, matches }) => (
          <div key={alert.id} className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-900">{alert.products?.name || alert.product_name || 'Producto'}</p>
                <p className="text-sm text-slate-500">Objetivo: {money(alert.target_unit_price)} {alert.sector ? `· ${alert.sector}` : ''}</p>
              </div>
              <button onClick={() => toggleAlert(alert)} className={`rounded-full px-3 py-1 text-xs font-bold ${alert.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {alert.is_active ? 'Activa' : 'Pausada'}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {matches.length === 0 && <p className="text-xs text-slate-400">Aún no hay precios bajo ese objetivo.</p>}
              {matches.map(match => (
                <div key={match.id} className="rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-800">
                  {match.product_name} en {match.store_name}: {money(match.unit_price)} · {match.sector}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
