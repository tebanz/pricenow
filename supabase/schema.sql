-- ============================================================
-- PriceNow · Esquema de Base de Datos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────

CREATE TYPE unit_type AS ENUM (
  'unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'par', 'caja'
);

CREATE TYPE validation_status AS ENUM (
  'pending', 'approved', 'rejected'
);

CREATE TYPE user_role AS ENUM (
  'user', 'validator', 'admin'
);

-- ─────────────────────────────────────────
-- TABLA: profiles
-- Extiende auth.users de Supabase
-- ─────────────────────────────────────────

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'user',
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: crear perfil automáticamente al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────
-- TABLA: products
-- Catálogo de productos normalizados
-- ─────────────────────────────────────────

CREATE TABLE public.products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  canonical_name  TEXT NOT NULL,         -- Nombre normalizado (para IA futura)
  category        TEXT NOT NULL,
  subcategory     TEXT,
  default_unit    unit_type NOT NULL DEFAULT 'unidad',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para búsqueda de productos
CREATE INDEX idx_products_canonical ON public.products(canonical_name);
CREATE INDEX idx_products_category ON public.products(category);

-- Datos iniciales de categorías de productos comunes
INSERT INTO public.products (name, canonical_name, category, subcategory, default_unit) VALUES
  ('Pan marraqueta', 'pan_marraqueta', 'Panadería', 'Pan', 'kg'),
  ('Leche entera', 'leche_entera', 'Lácteos', 'Leche', 'litro'),
  ('Aceite maravilla', 'aceite_maravilla', 'Aceites', 'Aceite vegetal', 'litro'),
  ('Arroz grado 1', 'arroz_grado1', 'Granos', 'Arroz', 'kg'),
  ('Azúcar blanca', 'azucar_blanca', 'Azúcar y endulzantes', 'Azúcar', 'kg'),
  ('Fideos espagueti', 'fideos_espagueti', 'Pastas', 'Fideo', 'kg'),
  ('Pollo entero', 'pollo_entero', 'Carnes', 'Ave', 'kg'),
  ('Carne molida', 'carne_molida', 'Carnes', 'Vacuno', 'kg'),
  ('Tomate', 'tomate', 'Verduras', 'Verdura', 'kg'),
  ('Papa', 'papa', 'Verduras', 'Tubérculo', 'kg'),
  ('Cebolla', 'cebolla', 'Verduras', 'Verdura', 'kg'),
  ('Huevo', 'huevo', 'Huevos', 'Huevo', 'unidad'),
  ('Detergente líquido', 'detergente_liquido', 'Limpieza', 'Lavado', 'litro'),
  ('Papel higiénico', 'papel_higienico', 'Higiene', 'Papel', 'unidad');

-- ─────────────────────────────────────────
-- TABLA: stores
-- Tiendas registradas en Rancagua
-- ─────────────────────────────────────────

CREATE TABLE public.stores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  chain       TEXT,                        -- Ej: Lider, Jumbo, Santa Isabel
  sector      TEXT NOT NULL,               -- Barrio/sector de Rancagua
  address     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stores_sector ON public.stores(sector);

-- Tiendas iniciales en Rancagua
INSERT INTO public.stores (name, chain, sector, address) VALUES
  ('Lider Rancagua', 'Lider', 'Centro', 'Av. O''Higgins 800'),
  ('Jumbo Rancagua', 'Jumbo', 'Los Libertadores', 'Av. Los Libertadores 1100'),
  ('Santa Isabel Centro', 'Santa Isabel', 'Centro', 'Estado 355'),
  ('Unimarc El Trébol', 'Unimarc', 'El Trébol', 'Av. El Trébol 1200'),
  ('Acuenta Rancagua', 'Acuenta', 'Los Libertadores', 'Av. Los Libertadores 800'),
  ('Ekono Rancagua', 'Ekono', 'Centro', 'Campos 660'),
  ('Mayorista 10', 'Mayorista 10', 'Sector Norte', 'Av. España 1500'),
  ('Tienda vecinal (otra)', NULL, 'Otro', NULL);

-- ─────────────────────────────────────────
-- TABLA: price_entries
-- Registros de precios ingresados por usuarios
-- ─────────────────────────────────────────

CREATE TABLE public.price_entries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Datos del producto
  product_id          UUID REFERENCES public.products(id),
  product_name        TEXT NOT NULL,       -- Nombre libre (por si no está en catálogo)
  brand               TEXT,
  quantity            NUMERIC(10, 3) NOT NULL CHECK (quantity > 0),
  unit                unit_type NOT NULL,

  -- Datos de precio
  price               NUMERIC(10, 2) NOT NULL CHECK (price > 0),
  unit_price          NUMERIC(12, 4),      -- Calculado: precio / cantidad normalizada

  -- Datos de la tienda
  store_id            UUID REFERENCES public.stores(id),
  store_name          TEXT NOT NULL,       -- Nombre libre como fallback
  sector              TEXT NOT NULL,

  -- Metadatos
  purchase_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_photo_url   TEXT,               -- URL firmada de Supabase Storage
  notes               TEXT,

  -- Validación
  validation_status   validation_status NOT NULL DEFAULT 'pending',
  validated_by        UUID REFERENCES public.profiles(id),
  validated_at        TIMESTAMPTZ,
  rejection_reason    TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX idx_entries_product    ON public.price_entries(product_name);
CREATE INDEX idx_entries_store      ON public.price_entries(store_name);
CREATE INDEX idx_entries_sector     ON public.price_entries(sector);
CREATE INDEX idx_entries_date       ON public.price_entries(purchase_date);
CREATE INDEX idx_entries_status     ON public.price_entries(validation_status);
CREATE INDEX idx_entries_user       ON public.price_entries(user_id);
CREATE INDEX idx_entries_product_id ON public.price_entries(product_id);

-- Trigger: calcular unit_price automáticamente
CREATE OR REPLACE FUNCTION public.calculate_unit_price()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalizar a precio por kg o litro cuando aplica
  NEW.unit_price := CASE
    WHEN NEW.unit = 'g'  THEN (NEW.price / NEW.quantity) * 1000  -- → precio por kg
    WHEN NEW.unit = 'ml' THEN (NEW.price / NEW.quantity) * 1000  -- → precio por litro
    ELSE NEW.price / NEW.quantity                                  -- precio por unidad base
  END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER before_entry_upsert
  BEFORE INSERT OR UPDATE ON public.price_entries
  FOR EACH ROW EXECUTE FUNCTION public.calculate_unit_price();

-- ─────────────────────────────────────────
-- TABLA: weekly_reports
-- Reportes semanales precalculados
-- ─────────────────────────────────────────

CREATE TABLE public.weekly_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name      TEXT NOT NULL,
  product_id        UUID REFERENCES public.products(id),
  store_name        TEXT,                  -- NULL = todos los comercios
  sector            TEXT,                  -- NULL = todos los sectores
  week_start        DATE NOT NULL,
  week_end          DATE NOT NULL,
  avg_price         NUMERIC(10, 2),
  min_price         NUMERIC(10, 2),
  max_price         NUMERIC(10, 2),
  avg_unit_price    NUMERIC(12, 4),
  price_change_pct  NUMERIC(6, 2),         -- % variación vs semana anterior
  sample_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(product_name, store_name, sector, week_start)
);

CREATE INDEX idx_reports_week    ON public.weekly_reports(week_start);
CREATE INDEX idx_reports_product ON public.weekly_reports(product_name);

-- ─────────────────────────────────────────
-- VISTA: ranking_por_producto
-- Ranking de precios mínimos por producto
-- ─────────────────────────────────────────

CREATE OR REPLACE VIEW public.ranking_por_producto AS
SELECT
  pe.product_name,
  pe.brand,
  pe.unit,
  pe.store_name,
  pe.sector,
  MIN(pe.unit_price)     AS precio_minimo_unitario,
  MIN(pe.price)          AS precio_minimo,
  MAX(pe.price)          AS precio_maximo,
  ROUND(AVG(pe.price), 2) AS precio_promedio,
  COUNT(*)               AS cantidad_registros,
  MAX(pe.purchase_date)  AS ultima_actualizacion
FROM public.price_entries pe
WHERE
  pe.validation_status = 'approved'
  AND pe.purchase_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY
  pe.product_name, pe.brand, pe.unit, pe.store_name, pe.sector
ORDER BY
  pe.product_name, precio_minimo_unitario ASC;

-- ─────────────────────────────────────────
-- FUNCIÓN: get_price_ranking
-- Ranking filtrable por producto
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_price_ranking(
  p_product_name TEXT DEFAULT NULL,
  p_sector TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  product_name          TEXT,
  brand                 TEXT,
  unit                  unit_type,
  store_name            TEXT,
  sector                TEXT,
  precio_minimo         NUMERIC,
  precio_minimo_unitario NUMERIC,
  precio_promedio       NUMERIC,
  cantidad_registros    BIGINT,
  ultima_actualizacion  DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.product_name,
    pe.brand,
    pe.unit,
    pe.store_name,
    pe.sector,
    MIN(pe.price),
    MIN(pe.unit_price),
    ROUND(AVG(pe.price), 2),
    COUNT(*),
    MAX(pe.purchase_date)
  FROM public.price_entries pe
  WHERE
    pe.validation_status = 'approved'
    AND pe.purchase_date >= CURRENT_DATE - INTERVAL '30 days'
    AND (p_product_name IS NULL OR pe.product_name ILIKE '%' || p_product_name || '%')
    AND (p_sector IS NULL OR pe.sector = p_sector)
  GROUP BY pe.product_name, pe.brand, pe.unit, pe.store_name, pe.sector
  ORDER BY MIN(pe.unit_price) ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
