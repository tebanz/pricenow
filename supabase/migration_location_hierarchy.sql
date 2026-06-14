-- PriceNow territorial hierarchy support.
-- Hierarchy: region -> city -> commune -> sector.
-- This migration is idempotent and does not delete or rewrite uncertain data.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS sector_id UUID;

ALTER TABLE public.price_entries
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT;

ALTER TABLE public.local_sectors
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_city TEXT,
  ADD COLUMN IF NOT EXISTS preferred_commune TEXT,
  ADD COLUMN IF NOT EXISTS preferred_region TEXT,
  ADD COLUMN IF NOT EXISTS preferred_latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS preferred_longitude NUMERIC(10,7);

ALTER TABLE public.stores ALTER COLUMN sector DROP NOT NULL;
ALTER TABLE public.price_entries ALTER COLUMN sector DROP NOT NULL;

-- Safe compatibility backfill: copy commune into city only when city is empty.
-- This preserves existing Rancagua/Santiago data while keeping sectors separate.
UPDATE public.stores
SET city = NULLIF(BTRIM(commune), '')
WHERE (city IS NULL OR BTRIM(city) = '')
  AND NULLIF(BTRIM(commune), '') IS NOT NULL;

UPDATE public.price_entries
SET city = NULLIF(BTRIM(commune), '')
WHERE (city IS NULL OR BTRIM(city) = '')
  AND NULLIF(BTRIM(commune), '') IS NOT NULL;

UPDATE public.local_sectors
SET city = NULLIF(BTRIM(commune), '')
WHERE (city IS NULL OR BTRIM(city) = '')
  AND NULLIF(BTRIM(commune), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stores_city ON public.stores (city);
CREATE INDEX IF NOT EXISTS idx_stores_commune ON public.stores (commune);
CREATE INDEX IF NOT EXISTS idx_stores_sector ON public.stores (sector);
CREATE INDEX IF NOT EXISTS idx_stores_city_sector ON public.stores (city, sector);
CREATE INDEX IF NOT EXISTS idx_stores_commune_sector ON public.stores (commune, sector);

CREATE INDEX IF NOT EXISTS idx_price_entries_city ON public.price_entries (city);
CREATE INDEX IF NOT EXISTS idx_price_entries_commune ON public.price_entries (commune);
CREATE INDEX IF NOT EXISTS idx_price_entries_sector ON public.price_entries (sector);
CREATE INDEX IF NOT EXISTS idx_price_entries_city_sector ON public.price_entries (city, sector);
CREATE INDEX IF NOT EXISTS idx_price_entries_commune_sector ON public.price_entries (commune, sector);

CREATE INDEX IF NOT EXISTS idx_local_sectors_city ON public.local_sectors (city);
CREATE INDEX IF NOT EXISTS idx_local_sectors_commune ON public.local_sectors (commune);
CREATE INDEX IF NOT EXISTS idx_local_sectors_region ON public.local_sectors (region);
CREATE INDEX IF NOT EXISTS idx_local_sectors_city_name ON public.local_sectors (city, name);

-- Review-only view. Do not apply automatic fixes from this output without checking.
CREATE OR REPLACE VIEW public.territorial_location_review AS
WITH known_sector_names(name) AS (
  VALUES
    ('centro'),
    ('manzanal'),
    ('el tenis'),
    ('manso de velasco'),
    ('san francisco'),
    ('rene schneider'),
    ('rené schneider'),
    ('villa triana'),
    ('los lirios'),
    ('recreo'),
    ('la compania'),
    ('la compañía')
)
SELECT
  'price_entries'::TEXT AS source_table,
  id::TEXT AS source_id,
  COALESCE(product_name, store_name, 'Reporte') AS label,
  region,
  city,
  commune,
  sector,
  'city_may_contain_sector'::TEXT AS issue
FROM public.price_entries
WHERE NULLIF(BTRIM(city), '') IS NOT NULL
  AND (
    LOWER(BTRIM(city)) IN (SELECT name FROM known_sector_names)
    OR (
      NULLIF(BTRIM(sector), '') IS NOT NULL
      AND LOWER(BTRIM(city)) = LOWER(BTRIM(sector))
    )
  )
  AND (
    commune IS NULL
    OR BTRIM(commune) = ''
    OR LOWER(BTRIM(commune)) = LOWER(BTRIM(city))
  )
UNION ALL
SELECT
  'stores'::TEXT AS source_table,
  id::TEXT AS source_id,
  COALESCE(name, 'Negocio') AS label,
  region,
  city,
  commune,
  sector,
  'city_may_contain_sector'::TEXT AS issue
FROM public.stores
WHERE NULLIF(BTRIM(city), '') IS NOT NULL
  AND (
    LOWER(BTRIM(city)) IN (SELECT name FROM known_sector_names)
    OR (
      NULLIF(BTRIM(sector), '') IS NOT NULL
      AND LOWER(BTRIM(city)) = LOWER(BTRIM(sector))
    )
  )
  AND (
    commune IS NULL
    OR BTRIM(commune) = ''
    OR LOWER(BTRIM(commune)) = LOWER(BTRIM(city))
  );

COMMENT ON VIEW public.territorial_location_review IS
  'Registros donde city parece contener un sector o poblacion. Revisar manualmente antes de corregir.';
