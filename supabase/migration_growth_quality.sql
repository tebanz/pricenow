-- PriceNow · Calidad de datos, favoritos, alertas y negocios asociados
-- Ejecutar en Supabase SQL Editor. Idempotente: se puede ejecutar más de una vez.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Campos útiles para productos y tiendas.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS normalized_key TEXT,
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.products
SET normalized_key = COALESCE(normalized_key, public.product_key(name))
WHERE normalized_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_normalized_key ON public.products(normalized_key);
CREATE INDEX IF NOT EXISTS idx_products_merged_into ON public.products(merged_into);

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS normalized_key TEXT,
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES public.stores(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.stores
SET normalized_key = COALESCE(normalized_key, public.product_key(name || ' ' || COALESCE(address, '') || ' ' || COALESCE(sector, '')))
WHERE normalized_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_stores_normalized_key ON public.stores(normalized_key);
CREATE INDEX IF NOT EXISTS idx_stores_merged_into ON public.stores(merged_into);

-- Preferencias del usuario dentro de la app.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Favoritos de productos.
CREATE TABLE IF NOT EXISTS public.user_favorite_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- Alertas internas de precio.
CREATE TABLE IF NOT EXISTS public.price_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT,
  target_unit_price NUMERIC(12, 4) NOT NULL CHECK (target_unit_price > 0),
  sector TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Negocios asociados / prospectos comerciales.
CREATE TABLE IF NOT EXISTS public.business_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  sector TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','contacted','active','paused','rejected')),
  marketing_plan TEXT DEFAULT 'basic' CHECK (marketing_plan IN ('basic','marketing','intelligence','advisory')),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Incidencias de calidad de datos.
CREATE TABLE IF NOT EXISTS public.data_quality_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  related_table TEXT NOT NULL,
  related_id UUID,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- RPC: fusionar productos duplicados.
CREATE OR REPLACE FUNCTION public.merge_products(p_source_id UUID, p_target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin','validator') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Producto origen/destino inválido';
  END IF;

  UPDATE public.price_entries
  SET product_id = p_target_id,
      product_name = COALESCE((SELECT name FROM public.products WHERE id = p_target_id), product_name),
      updated_at = NOW()
  WHERE product_id = p_source_id;

  UPDATE public.product_aliases
  SET product_id = p_target_id
  WHERE product_id = p_source_id;

  UPDATE public.products
  SET is_active = FALSE,
      merged_into = p_target_id,
      updated_at = NOW()
  WHERE id = p_source_id;
END;
$$;

-- RPC: fusionar negocios duplicados.
CREATE OR REPLACE FUNCTION public.merge_stores(p_source_id UUID, p_target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin','validator') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Negocio origen/destino inválido';
  END IF;

  UPDATE public.price_entries
  SET store_id = p_target_id,
      store_name = COALESCE((SELECT name FROM public.stores WHERE id = p_target_id), store_name),
      updated_at = NOW()
  WHERE store_id = p_source_id;

  UPDATE public.business_partners
  SET store_id = p_target_id,
      updated_at = NOW()
  WHERE store_id = p_source_id;

  UPDATE public.stores
  SET is_active = FALSE,
      merged_into = p_target_id,
      updated_at = NOW()
  WHERE id = p_source_id;
END;
$$;

-- RLS básico.
ALTER TABLE public.user_favorite_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_select_own" ON public.user_favorite_products;
CREATE POLICY "favorites_select_own" ON public.user_favorite_products
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "favorites_manage_own" ON public.user_favorite_products;
CREATE POLICY "favorites_manage_own" ON public.user_favorite_products
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "alerts_select_own" ON public.price_alerts;
CREATE POLICY "alerts_select_own" ON public.price_alerts
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "alerts_manage_own" ON public.price_alerts;
CREATE POLICY "alerts_manage_own" ON public.price_alerts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "partners_admin_all" ON public.business_partners;
CREATE POLICY "partners_admin_all" ON public.business_partners
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','validator')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','validator')));

DROP POLICY IF EXISTS "quality_admin_all" ON public.data_quality_flags;
CREATE POLICY "quality_admin_all" ON public.data_quality_flags
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','validator')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','validator')));
