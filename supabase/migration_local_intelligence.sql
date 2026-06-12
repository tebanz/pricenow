-- ============================================================
-- PriceNow · Local Intelligence
-- Sectores, negocios con coordenadas, alias y validación inteligente
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION public.pricenow_normalize_text(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN trim(regexp_replace(
    lower(
      translate(
        coalesce(input_text, ''),
        'áéíóúÁÉÍÓÚñÑüÜ',
        'aeiouAEIOUnNuU'
      )
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Sectores / poblaciones administrables
CREATE TABLE IF NOT EXISTS public.local_sectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commune TEXT NOT NULL DEFAULT 'Rancagua',
  name TEXT NOT NULL,
  normalized_name TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  radius_m INTEGER NOT NULL DEFAULT 900,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(commune, name)
);

ALTER TABLE public.local_sectors
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.local_sectors
SET normalized_name = public.pricenow_normalize_text(name)
WHERE normalized_name IS NULL OR normalized_name = '';

CREATE INDEX IF NOT EXISTS idx_local_sectors_active ON public.local_sectors(is_active);
CREATE INDEX IF NOT EXISTS idx_local_sectors_coords ON public.local_sectors(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_local_sectors_normalized ON public.local_sectors(normalized_name);

-- Mejoras a stores para mapa local propio
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'otro',
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES public.stores(id),
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES public.local_sectors(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.stores
SET normalized_name = public.pricenow_normalize_text(name)
WHERE normalized_name IS NULL OR normalized_name = '';

CREATE INDEX IF NOT EXISTS idx_stores_coords ON public.stores(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_stores_normalized ON public.stores(normalized_name);
CREATE INDEX IF NOT EXISTS idx_stores_verified ON public.stores(is_verified);
CREATE INDEX IF NOT EXISTS idx_stores_sector_id ON public.stores(sector_id);

-- Alias de negocios para corregir nombres mal escritos
CREATE TABLE IF NOT EXISTS public.store_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_aliases_store ON public.store_aliases(store_id);
CREATE INDEX IF NOT EXISTS idx_store_aliases_key ON public.store_aliases(alias_key);

INSERT INTO public.store_aliases (store_id, alias, alias_key)
SELECT id, name, public.pricenow_normalize_text(name)
FROM public.stores
WHERE name IS NOT NULL
ON CONFLICT (alias_key) DO NOTHING;

-- Alias de productos, por si todavía no existía
CREATE TABLE IF NOT EXISTS public.product_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_product ON public.product_aliases(product_id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_key ON public.product_aliases(alias_key);

INSERT INTO public.product_aliases (product_id, alias, alias_key)
SELECT id, name, public.pricenow_normalize_text(name)
FROM public.products
WHERE name IS NOT NULL
ON CONFLICT (alias_key) DO NOTHING;

-- Preferencias de ubicación del usuario
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_commune TEXT DEFAULT 'Rancagua',
  ADD COLUMN IF NOT EXISTS preferred_sector TEXT,
  ADD COLUMN IF NOT EXISTS preferred_sector_id UUID REFERENCES public.local_sectors(id),
  ADD COLUMN IF NOT EXISTS preferred_latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS preferred_longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS username_last_changed_at TIMESTAMPTZ;

-- Flags de calidad de datos, si no existía
CREATE TABLE IF NOT EXISTS public.data_quality_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by UUID REFERENCES public.profiles(id),
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Función de fusión de negocios
CREATE OR REPLACE FUNCTION public.merge_stores(p_source_id UUID, p_target_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Selecciona negocios diferentes.';
  END IF;

  UPDATE public.price_entries
  SET store_id = p_target_id,
      store_name = COALESCE((SELECT name FROM public.stores WHERE id = p_target_id), store_name),
      sector = COALESCE((SELECT sector FROM public.stores WHERE id = p_target_id), sector),
      updated_at = NOW()
  WHERE store_id = p_source_id;

  UPDATE public.store_aliases SET store_id = p_target_id WHERE store_id = p_source_id;

  UPDATE public.stores
  SET is_active = FALSE,
      merged_into = p_target_id,
      updated_at = NOW()
  WHERE id = p_source_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función de fusión de productos
CREATE OR REPLACE FUNCTION public.merge_products(p_source_id UUID, p_target_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Selecciona productos diferentes.';
  END IF;

  UPDATE public.price_entries
  SET product_id = p_target_id,
      product_name = COALESCE((SELECT name FROM public.products WHERE id = p_target_id), product_name),
      unit = COALESCE((SELECT default_unit FROM public.products WHERE id = p_target_id), unit),
      updated_at = NOW()
  WHERE product_id = p_source_id;

  UPDATE public.product_aliases SET product_id = p_target_id WHERE product_id = p_source_id;

  UPDATE public.products
  SET is_active = FALSE
  WHERE id = p_source_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Políticas RLS
ALTER TABLE public.local_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "local_sectors_select_all" ON public.local_sectors;
CREATE POLICY "local_sectors_select_all" ON public.local_sectors FOR SELECT USING (is_active = TRUE OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

DROP POLICY IF EXISTS "local_sectors_admin_all" ON public.local_sectors;
CREATE POLICY "local_sectors_admin_all" ON public.local_sectors FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

DROP POLICY IF EXISTS "store_aliases_select_all" ON public.store_aliases;
CREATE POLICY "store_aliases_select_all" ON public.store_aliases FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "store_aliases_admin_all" ON public.store_aliases;
CREATE POLICY "store_aliases_admin_all" ON public.store_aliases FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

DROP POLICY IF EXISTS "product_aliases_select_all" ON public.product_aliases;
CREATE POLICY "product_aliases_select_all" ON public.product_aliases FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "product_aliases_admin_all" ON public.product_aliases;
CREATE POLICY "product_aliases_admin_all" ON public.product_aliases FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

DROP POLICY IF EXISTS "quality_flags_select_validators" ON public.data_quality_flags;
CREATE POLICY "quality_flags_select_validators" ON public.data_quality_flags FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

DROP POLICY IF EXISTS "quality_flags_admin_all" ON public.data_quality_flags;
CREATE POLICY "quality_flags_admin_all" ON public.data_quality_flags FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

-- Permitir a validadores/admin editar stores si no había policy de update/insert
DROP POLICY IF EXISTS "stores_admin_all" ON public.stores;
CREATE POLICY "stores_admin_all" ON public.stores FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','validator')));

-- Datos iniciales de sectores: nombres sin coordenadas exactas; el admin puede completar coordenadas reales desde la app.
INSERT INTO public.local_sectors (commune, name, normalized_name)
VALUES
  ('Rancagua', 'Centro', public.pricenow_normalize_text('Centro')),
  ('Rancagua', 'Villa Santa Filomena', public.pricenow_normalize_text('Villa Santa Filomena')),
  ('Rancagua', 'Población San Francisco', public.pricenow_normalize_text('Población San Francisco')),
  ('Rancagua', 'Los Libertadores', public.pricenow_normalize_text('Los Libertadores')),
  ('Rancagua', 'Rancagua Poniente', public.pricenow_normalize_text('Rancagua Poniente')),
  ('Rancagua', 'República de Chile', public.pricenow_normalize_text('República de Chile')),
  ('Rancagua', 'Manzanal', public.pricenow_normalize_text('Manzanal')),
  ('Rancagua', 'Baquedano', public.pricenow_normalize_text('Baquedano')),
  ('La Calera', 'Centro', public.pricenow_normalize_text('Centro')),
  ('La Calera', 'Artificio', public.pricenow_normalize_text('Artificio')),
  ('La Calera', 'La Calera Norte', public.pricenow_normalize_text('La Calera Norte'))
ON CONFLICT (commune, name) DO NOTHING;
