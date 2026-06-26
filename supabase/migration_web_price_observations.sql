-- EdePrecios - Precios observados en sitios web oficiales.
-- Ejecutar en Supabase SQL Editor despues de las migraciones base.
-- Es idempotente: puede ejecutarse mas de una vez.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.web_catalog_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  package_text TEXT,
  quantity NUMERIC(12,3),
  unit TEXT,
  image_url TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT web_catalog_products_provider_source_unique UNIQUE (provider, source_product_id)
);

CREATE TABLE IF NOT EXISTS public.web_price_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  web_product_id UUID NOT NULL REFERENCES public.web_catalog_products(id) ON DELETE CASCADE,
  chain_name TEXT NOT NULL,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  city TEXT,
  commune TEXT,
  location_scope TEXT NOT NULL DEFAULT 'online_unverified'
    CHECK (location_scope IN ('online_unverified', 'online_national', 'commune_confirmed', 'branch_confirmed')),
  location_verified BOOLEAN NOT NULL DEFAULT FALSE,
  normal_price NUMERIC(12,2),
  final_price NUMERIC(12,2) NOT NULL CHECK (final_price > 0),
  unit_price NUMERIC(14,4),
  unit_label TEXT,
  promotion_text TEXT,
  stock_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (stock_status IN ('in_stock', 'out_of_stock', 'unknown')),
  source_url TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate', 'approved', 'rejected', 'stale')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  observation_key TEXT NOT NULL UNIQUE,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web_price_import_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_city TEXT,
  target_commune TEXT,
  location_scope TEXT NOT NULL DEFAULT 'online_unverified',
  candidates_found INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  error_message TEXT,
  started_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_web_catalog_products_normalized_name
  ON public.web_catalog_products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_web_catalog_products_category
  ON public.web_catalog_products(category);
CREATE INDEX IF NOT EXISTS idx_web_catalog_products_product_id
  ON public.web_catalog_products(product_id);
CREATE INDEX IF NOT EXISTS idx_web_prices_review_status
  ON public.web_price_observations(review_status);
CREATE INDEX IF NOT EXISTS idx_web_prices_location
  ON public.web_price_observations(city, commune, location_scope);
CREATE INDEX IF NOT EXISTS idx_web_prices_chain_captured
  ON public.web_price_observations(chain_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_prices_product_captured
  ON public.web_price_observations(web_product_id, captured_at DESC);

ALTER TABLE public.web_catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_price_import_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'web_catalog_products'
      AND policyname = 'web_catalog_products_read_authenticated'
  ) THEN
    CREATE POLICY web_catalog_products_read_authenticated
      ON public.web_catalog_products FOR SELECT
      TO authenticated
      USING (is_active = TRUE OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'web_catalog_products'
      AND policyname = 'web_catalog_products_admin_all'
  ) THEN
    CREATE POLICY web_catalog_products_admin_all
      ON public.web_catalog_products FOR ALL
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'web_price_observations'
      AND policyname = 'web_prices_read_approved'
  ) THEN
    CREATE POLICY web_prices_read_approved
      ON public.web_price_observations FOR SELECT
      TO authenticated
      USING (
        review_status = 'approved'
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.role = 'admin'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'web_price_observations'
      AND policyname = 'web_prices_admin_all'
  ) THEN
    CREATE POLICY web_prices_admin_all
      ON public.web_price_observations FOR ALL
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'web_price_import_runs'
      AND policyname = 'web_price_import_runs_admin_all'
  ) THEN
    CREATE POLICY web_price_import_runs_admin_all
      ON public.web_price_import_runs FOR ALL
      TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ));
  END IF;
END $$;
