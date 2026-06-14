-- PriceNow · Soporte multi-ciudad y comunas de Chile
-- Ejecutar en Supabase SQL Editor. Es seguro repetirlo.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS store_type TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE public.stores
SET
  city = COALESCE(NULLIF(city, ''), NULLIF(commune, '')),
  store_type = COALESCE(NULLIF(store_type, ''), NULLIF(type, ''))
WHERE city IS NULL OR city = '' OR store_type IS NULL OR store_type = '';

ALTER TABLE public.price_entries
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT;

UPDATE public.price_entries
SET city = COALESCE(NULLIF(city, ''), NULLIF(commune, ''))
WHERE city IS NULL OR city = '';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_commune TEXT,
  ADD COLUMN IF NOT EXISTS preferred_region TEXT,
  ADD COLUMN IF NOT EXISTS preferred_city TEXT,
  ADD COLUMN IF NOT EXISTS preferred_latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS preferred_longitude NUMERIC(10,7);

CREATE INDEX IF NOT EXISTS idx_stores_commune ON public.stores(commune);
CREATE INDEX IF NOT EXISTS idx_stores_region ON public.stores(region);
CREATE INDEX IF NOT EXISTS idx_stores_city ON public.stores(city);
CREATE INDEX IF NOT EXISTS idx_stores_source ON public.stores(source);
CREATE INDEX IF NOT EXISTS idx_price_entries_commune ON public.price_entries(commune);
CREATE INDEX IF NOT EXISTS idx_price_entries_region ON public.price_entries(region);
CREATE INDEX IF NOT EXISTS idx_price_entries_city ON public.price_entries(city);
CREATE INDEX IF NOT EXISTS idx_profiles_preferred_commune ON public.profiles(preferred_commune);
