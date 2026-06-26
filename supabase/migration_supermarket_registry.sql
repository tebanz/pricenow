-- EdePrecios - Registro de supermercados de Chile.
-- Reutiliza public.stores. Es seguro repetirlo.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS chain_name TEXT,
  ADD COLUMN IF NOT EXISTS branch_name TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS store_type TEXT,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS commune TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS place_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.stores ALTER COLUMN sector DROP NOT NULL;

UPDATE public.stores
SET
  chain_name = COALESCE(NULLIF(chain_name, ''), NULLIF(chain, '')),
  normalized_name = COALESCE(NULLIF(normalized_name, ''), lower(regexp_replace(coalesce(name, ''), '[^a-zA-Z0-9]+', ' ', 'g'))),
  verification_status = COALESCE(NULLIF(verification_status, ''), CASE WHEN is_verified THEN 'verified' ELSE 'pending' END),
  is_active = COALESCE(is_active, TRUE),
  updated_at = COALESCE(updated_at, NOW())
WHERE chain_name IS NULL
   OR normalized_name IS NULL
   OR verification_status IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stores_chain_name ON public.stores(chain_name);
CREATE INDEX IF NOT EXISTS idx_stores_branch_name ON public.stores(branch_name);
CREATE INDEX IF NOT EXISTS idx_stores_external_source_id ON public.stores(external_source, external_id);
CREATE INDEX IF NOT EXISTS idx_stores_place_id ON public.stores(place_id);
CREATE INDEX IF NOT EXISTS idx_stores_verification_status ON public.stores(verification_status);
CREATE INDEX IF NOT EXISTS idx_stores_supermarket_city ON public.stores(city, commune)
  WHERE type = 'supermercado';
CREATE INDEX IF NOT EXISTS idx_stores_supermarket_coords ON public.stores(latitude, longitude)
  WHERE type = 'supermercado';
