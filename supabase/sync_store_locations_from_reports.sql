-- ============================================================
-- PriceNow · Sincronizar coordenadas de tiendas desde reportes aprobados
-- Ejecutar en Supabase SQL Editor después de aprobar precios con ubicación exacta.
-- Esto permite que PriceNow aprenda tiendas cercanas aunque OpenStreetMap no las tenga.
-- ============================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual';

WITH grouped AS (
  SELECT
    lower(trim(store_name)) AS store_key,
    trim(store_name) AS store_name,
    COALESCE(NULLIF(max(sector), ''), 'Rancagua') AS sector,
    round(avg(purchase_latitude)::numeric, 7) AS latitude,
    round(avg(purchase_longitude)::numeric, 7) AS longitude,
    count(*) AS reports_count
  FROM public.price_entries
  WHERE validation_status = 'approved'
    AND store_name IS NOT NULL
    AND trim(store_name) <> ''
    AND purchase_latitude IS NOT NULL
    AND purchase_longitude IS NOT NULL
  GROUP BY lower(trim(store_name)), trim(store_name)
), updated AS (
  UPDATE public.stores st
  SET
    latitude = grouped.latitude,
    longitude = grouped.longitude,
    sector = COALESCE(NULLIF(st.sector, ''), grouped.sector),
    is_active = TRUE,
    location_source = 'approved_price_entries'
  FROM grouped
  WHERE lower(trim(st.name)) = grouped.store_key
  RETURNING lower(trim(st.name)) AS store_key
)
INSERT INTO public.stores (name, chain, sector, address, latitude, longitude, is_active, location_source)
SELECT
  grouped.store_name,
  NULL,
  grouped.sector,
  NULL,
  grouped.latitude,
  grouped.longitude,
  TRUE,
  'approved_price_entries'
FROM grouped
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stores st
  WHERE lower(trim(st.name)) = grouped.store_key
);

CREATE INDEX IF NOT EXISTS idx_stores_lat_lng
  ON public.stores(latitude, longitude);
