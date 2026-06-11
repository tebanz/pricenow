-- ============================================================
-- PriceNow · Ubicación de compras y comercios
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Coordenadas opcionales para tiendas/comercios.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual';

-- Coordenadas opcionales para el lugar exacto donde se reportó la compra.
ALTER TABLE public.price_entries
  ADD COLUMN IF NOT EXISTS purchase_latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS purchase_longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

CREATE INDEX IF NOT EXISTS idx_stores_location
  ON public.stores(latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_entries_purchase_location
  ON public.price_entries(purchase_latitude, purchase_longitude);

-- Nota: no se cargan coordenadas inventadas. Las coordenadas se capturan desde el dispositivo
-- del usuario o se pueden completar manualmente después con una fuente verificada.
