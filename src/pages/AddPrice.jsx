import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  calcUnitPrice, formatUnitPrice, SECTORES_RANCAGUA, UNIDADES
} from '../utils/priceCalc'

const EMPTY_FORM = {
  product_name: '',
  brand: '',
  quantity: '',
  unit: 'unidad',
  price: '',
  store_name: '',
  sector: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

function googleMapsUrl(lat, lng) {
  if (lat == null || lng == null) return null
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const R = 6371
  const dLat = (Number(b.lat) - Number(a.lat)) * Math.PI / 180
  const dLng = (Number(b.lng) - Number(a.lng)) * Math.PI / 180
  const lat1 = Number(a.lat) * Math.PI / 180
  const lat2 = Number(b.lat) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const c = 2 * Math.atan2(
    Math.sqrt(sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng),
    Math.sqrt(1 - (sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng))
  )
  return R * c
}

function osmElementPosition(element) {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (lat == null || lng == null) return null
  return { lat: Number(lat), lng: Number(lng) }
}

function osmElementAddress(tags = {}) {
  const street = tags['addr:street']
  const number = tags['addr:housenumber']
  const suburb = tags['addr:suburb'] || tags['addr:neighbourhood']
  const city = tags['addr:city']
  const parts = []
  if (street) parts.push(number ? `${street} ${number}` : street)
  if (suburb) parts.push(suburb)
  if (city) parts.push(city)
  return parts.join(', ')
}

function normalizeOsmPlace(element, origin) {
  const position = osmElementPosition(element)
  if (!position) return null

  const tags = element.tags || {}
  const name = tags.name || tags.brand || tags.operator
  if (!name) return null

  return {
    id: `${element.type}/${element.id}`,
    name,
    type: tags.shop || tags.amenity || 'comercio',
    address: osmElementAddress(tags),
    lat: Number(position.lat.toFixed(7)),
    lng: Number(position.lng.toFixed(7)),
    distance_km: distanceKm(origin, position),
    source: 'openstreetmap_overpass',
  }
}

function buildOverpassNearbyQuery(lat, lng) {
  const radiusMeters = 900
  return `
    [out:json][timeout:12];
    (
      node["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall"](around:${radiusMeters},${lat},${lng});
      way["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall"](around:${radiusMeters},${lat},${lng});
      relation["shop"~"supermarket|convenience|greengrocer|bakery|butcher|dairy|mall"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 25;
  `
}

export default function AddPrice() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [stores, setStores] = useState([])
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [location, setLocation] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [osmPlaces, setOsmPlaces] = useState([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [osmSearched, setOsmSearched] = useState(false)

  const unitPrice = calcUnitPrice(form.price, form.quantity, form.unit)

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, sector, address, latitude, longitude')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setStores(data) })
  }, [])

  const nearbyStores = location
    ? stores
        .map(store => ({
          ...store,
          distance_km: distanceKm(
            location,
            store.latitude != null && store.longitude != null
              ? { lat: store.latitude, lng: store.longitude }
              : null
          ),
        }))
        .filter(store => store.distance_km != null)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, 5)
    : []

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  function applyStore(store) {
    setForm(prev => ({
      ...prev,
      store_name: store.name,
      sector: store.sector,
      _store_id: store.id,
    }))
  }

  function handleStoreSelect(e) {
    const storeId = e.target.value
    if (storeId === 'other') {
      setForm(prev => ({ ...prev, store_name: '', sector: '', _store_id: null }))
      return
    }
    const store = stores.find(s => s.id === storeId)
    if (store) applyStore(store)
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('La foto no puede superar 5 MB.')
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function captureLocation() {
    setError(null)
    if (!navigator.geolocation) {
      setError('Tu navegador no permite obtener ubicación.')
      return
    }

    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        const nextLocation = {
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
          accuracy: Math.round(position.coords.accuracy),
          source: 'browser_geolocation',
        }
        setLocation(nextLocation)
        setLocationLoading(false)
      },
      () => {
        setError('No se pudo obtener la ubicación. Revisa los permisos del navegador.')
        setLocationLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    )
  }

  function clearLocation() {
    setLocation(null)
    setOsmPlaces([])
    setOsmSearched(false)
  }

  function applyOsmPlace(place) {
    setForm(prev => ({
      ...prev,
      store_name: place.name,
      _store_id: null,
    }))
  }

  async function searchNearbyOsmPlaces() {
    if (!location) {
      setError('Primero debes usar tu ubicación actual.')
      return
    }

    setError(null)
    setOsmLoading(true)
    setOsmSearched(true)

    try {
      const query = buildOverpassNearbyQuery(location.lat, location.lng)
      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Overpass respondió con estado ${response.status}`)
      }

      const data = await response.json()
      const unique = new Map()

      ;(data.elements || [])
        .map(element => normalizeOsmPlace(element, location))
        .filter(Boolean)
        .filter(place => place.distance_km != null)
        .sort((a, b) => a.distance_km - b.distance_km)
        .forEach(place => {
          const key = `${place.name.toLowerCase()}-${place.lat}-${place.lng}`
          if (!unique.has(key)) unique.set(key, place)
        })

      setOsmPlaces(Array.from(unique.values()).slice(0, 8))
    } catch (err) {
      setError('No se pudieron detectar negocios cercanos con OpenStreetMap. Puedes ingresar la tienda manualmente.')
      setOsmPlaces([])
    } finally {
      setOsmLoading(false)
    }
  }

  function validate() {
    if (!form.product_name.trim()) return 'El nombre del producto es obligatorio.'
    if (!form.quantity || parseFloat(form.quantity) <= 0) return 'La cantidad debe ser mayor a 0.'
    if (!form.price || parseFloat(form.price) <= 0) return 'El precio debe ser mayor a 0.'
    if (!form.store_name.trim()) return 'La tienda es obligatoria.'
    if (!form.sector) return 'El sector es obligatorio.'
    if (!form.purchase_date) return 'La fecha de compra es obligatoria.'
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    setError(null)

    let receipt_photo_url = null

    if (photo) {
      const ext = photo.name.split('.').pop()
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('receipts')
        .upload(path, photo, { contentType: photo.type, upsert: false })

      if (uploadErr) {
        setError('Error al subir la foto: ' + uploadErr.message)
        setLoading(false)
        return
      }
      receipt_photo_url = path
    }

    const { error: insertErr } = await supabase.from('price_entries').insert({
      user_id: user.id,
      product_name: form.product_name.trim(),
      brand: form.brand.trim() || null,
      quantity: parseFloat(form.quantity),
      unit: form.unit,
      price: parseFloat(form.price),
      unit_price: unitPrice,
      store_name: form.store_name.trim(),
      store_id: form._store_id ?? null,
      sector: form.sector,
      purchase_date: form.purchase_date,
      notes: form.notes.trim() || null,
      receipt_photo_url,
      purchase_latitude: location?.lat ?? null,
      purchase_longitude: location?.lng ?? null,
      location_accuracy_m: location?.accuracy ?? null,
      location_source: location?.source ?? null,
      google_maps_url: location ? googleMapsUrl(location.lat, location.lng) : null,
    })

    if (insertErr) {
      setError('Error al guardar: ' + insertErr.message)
    } else {
      setSuccess(true)
      setForm(EMPTY_FORM)
      setPhoto(null)
      setPreview(null)
      setLocation(null)
      setTimeout(() => { setSuccess(false); navigate('/') }, 2000)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-xl font-bold text-slate-800">¡Precio registrado!</h3>
        <p className="text-slate-500 text-sm mt-2">
          Tu aporte está en revisión y pronto aparecerá en el ranking.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-1">Ingresar precio</h2>
      <p className="text-sm text-slate-500 mb-5">Registra lo que pagaste en tu última compra.</p>

      {error && (
        <div className="bg-danger-50 border border-danger-500/30 text-danger-500 text-sm rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="input-label">Producto <span className="text-danger-500">*</span></label>
          <input
            name="product_name"
            type="text"
            placeholder="Ej: Leche entera, Pan marraqueta…"
            value={form.product_name}
            onChange={handleChange}
            maxLength={100}
            className="input-field"
          />
        </div>

        <div>
          <label className="input-label">Marca <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input
            name="brand"
            type="text"
            placeholder="Ej: Soprole, Carozzi…"
            value={form.brand}
            onChange={handleChange}
            maxLength={60}
            className="input-field"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Cantidad <span className="text-danger-500">*</span></label>
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              placeholder="Ej: 1, 0.5, 500"
              value={form.quantity}
              onChange={handleChange}
              min="0.001"
              step="any"
              className="input-field"
            />
          </div>
          <div>
            <label className="input-label">Unidad <span className="text-danger-500">*</span></label>
            <select name="unit" value={form.unit} onChange={handleChange} className="input-field">
              {UNIDADES.map(u => (
                <option key={u.value} value={u.value}>{u.label.split(' →')[0]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="input-label">Precio total ($) <span className="text-danger-500">*</span></label>
          <input
            name="price"
            type="number"
            inputMode="numeric"
            placeholder="Ej: 1490"
            value={form.price}
            onChange={handleChange}
            min="1"
            step="1"
            className="input-field"
          />
          {unitPrice != null && form.quantity && form.price && (
            <p className="text-xs text-success-600 font-medium mt-1.5 flex items-center gap-1">
              <span>→</span>
              <span>{formatUnitPrice(unitPrice, form.unit)}</span>
            </p>
          )}
        </div>

        <div>
          <label className="input-label">Tienda <span className="text-danger-500">*</span></label>
          <select onChange={handleStoreSelect} defaultValue="" className="input-field mb-2">
            <option value="" disabled>Seleccionar tienda conocida…</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value="other">Otra tienda (ingresar manualmente)</option>
          </select>
          <input
            name="store_name"
            type="text"
            placeholder="Nombre de la tienda"
            value={form.store_name}
            onChange={handleChange}
            maxLength={80}
            className="input-field"
          />
        </div>

        {nearbyStores.length > 0 && (
          <div className="bg-brand-50 border border-brand-500/20 rounded-xl p-3">
            <p className="text-xs font-semibold text-brand-700 mb-2">Tiendas cercanas según tu ubicación</p>
            <div className="space-y-2">
              {nearbyStores.map(store => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => applyStore(store)}
                  className="w-full bg-white rounded-lg p-2 text-left border border-brand-100 active:scale-95 transition-transform"
                >
                  <p className="text-sm font-semibold text-slate-800">{store.name}</p>
                  <p className="text-xs text-slate-400">
                    {store.sector} · aprox. {store.distance_km.toFixed(2)} km
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="input-label">Sector / población de Rancagua <span className="text-danger-500">*</span></label>
          <select name="sector" value={form.sector} onChange={handleChange} className="input-field">
            <option value="" disabled>Seleccionar sector…</option>
            {SECTORES_RANCAGUA.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">Ubicación exacta <span className="text-slate-400 font-normal">(opcional)</span></label>
          <div className="card border border-slate-200">
            {location ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Ubicación guardada</p>
                <p className="text-xs text-slate-500">
                  Lat: {location.lat} · Lng: {location.lng} · precisión aprox. {location.accuracy} m
                </p>
                <div className="flex gap-2">
                  <a
                    href={googleMapsUrl(location.lat, location.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary flex-1 text-center text-sm py-2"
                  >
                    Ver en Google Maps
                  </a>
                  <button type="button" onClick={clearLocation} className="btn-danger text-sm py-2">
                    Quitar
                  </button>
                </div>

                <button
                  type="button"
                  onClick={searchNearbyOsmPlaces}
                  disabled={osmLoading}
                  className="btn-primary w-full text-sm py-2"
                >
                  {osmLoading ? 'Buscando negocios cercanos…' : 'Detectar negocios cercanos gratis'}
                </button>

                <p className="text-[11px] text-slate-400">
                  Búsqueda referencial con OpenStreetMap. Si no aparece el local correcto, ingrésalo manualmente.
                </p>

                {osmPlaces.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Negocios cercanos detectados</p>
                    {osmPlaces.map(place => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => applyOsmPlace(place)}
                        className="w-full bg-white rounded-lg p-2 text-left border border-slate-200 active:scale-95 transition-transform"
                      >
                        <p className="text-sm font-semibold text-slate-800">{place.name}</p>
                        <p className="text-xs text-slate-500">
                          {place.type} · aprox. {place.distance_km.toFixed(2)} km
                        </p>
                        {place.address && (
                          <p className="text-xs text-slate-400">{place.address}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {osmSearched && !osmLoading && osmPlaces.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No se encontraron negocios cercanos en OpenStreetMap. Puedes escribir la tienda manualmente.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Usa esta opción solo si estás en el lugar de compra. El navegador pedirá permiso para acceder a tu ubicación.
                </p>
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={locationLoading}
                  className="btn-secondary w-full text-sm py-2"
                >
                  {locationLoading ? 'Obteniendo ubicación…' : 'Usar mi ubicación actual'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="input-label">Fecha de compra <span className="text-danger-500">*</span></label>
          <input
            name="purchase_date"
            type="date"
            value={form.purchase_date}
            onChange={handleChange}
            max={new Date().toISOString().slice(0, 10)}
            className="input-field"
          />
        </div>

        <div>
          <label className="input-label">Notas <span className="text-slate-400 font-normal">(opcional)</span></label>
          <textarea
            name="notes"
            placeholder="Ej: oferta de la semana, precio de feria…"
            value={form.notes}
            onChange={handleChange}
            maxLength={200}
            rows={2}
            className="input-field resize-none"
          />
        </div>

        <div>
          <label className="input-label">Foto de boleta <span className="text-slate-400 font-normal">(opcional)</span></label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-colors"
          >
            {preview ? (
              <img src={preview} alt="Vista previa boleta" className="max-h-32 mx-auto rounded-lg object-contain" />
            ) : (
              <div className="text-slate-400">
                <svg className="w-8 h-8 mx-auto mb-1 fill-slate-300" viewBox="0 0 24 24">
                  <path d="M20 4v12H8V4h12m0-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 9.67l1.69 2.26 2.48-3.1L19 15H9zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/>
                </svg>
                <p className="text-sm">Toca para adjuntar foto</p>
                <p className="text-xs text-slate-300 mt-0.5">JPG, PNG · máx. 5 MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          {preview && (
            <button
              type="button"
              onClick={() => { setPhoto(null); setPreview(null) }}
              className="text-xs text-danger-500 mt-1 underline"
            >
              Quitar foto
            </button>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary w-full mt-2"
        >
          {loading ? 'Guardando…' : 'Guardar precio'}
        </button>
      </div>
    </div>
  )
}
