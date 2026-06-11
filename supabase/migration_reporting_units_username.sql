-- ============================================================
-- PriceNow · Ajuste de reportes, unidades y política de usuario
-- ============================================================
-- Objetivos:
-- 1) Evitar que productos como bebida/salchichas/yogur queden fuera de reportes por unidad mal estándar.
-- 2) Agregar regla: el nombre de usuario solo se puede cambiar una vez cada 90 días.
-- 3) Reforzar alias frecuentes para mejorar catálogo, ranking y reportes.
-- ============================================================

-- Asegura columnas necesarias en perfiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_last_changed_at TIMESTAMPTZ;

-- Función que bloquea cambios repetidos de username.
CREATE OR REPLACE FUNCTION public.enforce_username_change_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.username IS DISTINCT FROM OLD.username THEN
    IF OLD.username_last_changed_at IS NOT NULL
       AND OLD.username_last_changed_at > NOW() - INTERVAL '90 days'
    THEN
      RAISE EXCEPTION 'El nombre de usuario solo se puede cambiar una vez cada 90 días';
    END IF;

    NEW.username_last_changed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_username_change_interval ON public.profiles;
CREATE TRIGGER trg_enforce_username_change_interval
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_username_change_interval();

-- Asegura normalizador si no existiera.
CREATE OR REPLACE FUNCTION public.product_key(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      translate(lower(coalesce(input, '')), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.product_slug(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(public.product_key(input), ' ', '_');
$$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS normalized_key TEXT;

UPDATE public.products
SET normalized_key = public.product_key(name)
WHERE normalized_key IS NULL OR normalized_key = '';

-- Repara unidades de productos que normalmente deben compararse por unidad estándar concreta.
UPDATE public.products
SET default_unit = 'litro'::public.unit_type,
    category = COALESCE(NULLIF(category, ''), 'Bebidas'),
    normalized_key = public.product_key(name)
WHERE public.product_key(name) SIMILAR TO '%(bebida|gaseosa|jugo|agua mineral|pepsi|coca cola|sprite|fanta)%';

UPDATE public.products
SET default_unit = 'kg'::public.unit_type,
    category = COALESCE(NULLIF(category, ''), 'Carnes'),
    normalized_key = public.product_key(name)
WHERE public.product_key(name) SIMILAR TO '%(salchicha|vienesa|longaniza)%';

UPDATE public.products
SET default_unit = 'unidad'::public.unit_type,
    category = COALESCE(NULLIF(category, ''), 'Lácteos'),
    normalized_key = public.product_key(name)
WHERE public.product_key(name) SIMILAR TO '%(yogur|yogurt)%';

UPDATE public.products
SET default_unit = 'kg'::public.unit_type,
    category = COALESCE(NULLIF(category, ''), 'Panadería'),
    normalized_key = public.product_key(name)
WHERE public.product_key(name) SIMILAR TO '%(pan marraqueta|marraqueta|pan batido|pan frances|hallulla)%';

-- Inserta o refuerza productos estándar importantes.
WITH seed(name, canonical_name, category, subcategory, default_unit) AS (
  VALUES
    ('Bebida gaseosa', 'bebida_gaseosa', 'Bebidas', 'Bebida', 'litro'::public.unit_type),
    ('Jugo líquido', 'jugo_liquido', 'Bebidas', 'Jugo', 'litro'::public.unit_type),
    ('Agua mineral', 'agua_mineral', 'Bebidas', 'Agua', 'litro'::public.unit_type),
    ('Salchichas', 'salchichas', 'Carnes', 'Cecinas', 'kg'::public.unit_type),
    ('Yogur', 'yogur', 'Lácteos', 'Yogur', 'unidad'::public.unit_type)
)
INSERT INTO public.products (name, canonical_name, normalized_key, category, subcategory, default_unit)
SELECT seed.name, seed.canonical_name, public.product_key(seed.name), seed.category, seed.subcategory, seed.default_unit
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.canonical_name = seed.canonical_name
     OR public.product_key(p.name) = public.product_key(seed.name)
);

-- Si ya existían, corrige sus unidades.
UPDATE public.products p
SET default_unit = seed.default_unit,
    category = seed.category,
    subcategory = seed.subcategory,
    normalized_key = public.product_key(p.name)
FROM (
  VALUES
    ('bebida_gaseosa', 'Bebidas', 'Bebida', 'litro'::public.unit_type),
    ('jugo_liquido', 'Bebidas', 'Jugo', 'litro'::public.unit_type),
    ('agua_mineral', 'Bebidas', 'Agua', 'litro'::public.unit_type),
    ('salchichas', 'Carnes', 'Cecinas', 'kg'::public.unit_type),
    ('yogur', 'Lácteos', 'Yogur', 'unidad'::public.unit_type)
) AS seed(canonical_name, category, subcategory, default_unit)
WHERE p.canonical_name = seed.canonical_name;

-- Asegura tabla de alias.
CREATE TABLE IF NOT EXISTS public.product_aliases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  alias_key   TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_aliases_select_all" ON public.product_aliases;
CREATE POLICY "product_aliases_select_all"
  ON public.product_aliases FOR SELECT
  USING (TRUE);

-- Alias extra para que la búsqueda y estandarización reconozcan nombres reales escritos por usuarios.
WITH alias_seed(canonical_name, alias) AS (
  VALUES
    ('bebida_gaseosa', 'bebida'),
    ('bebida_gaseosa', 'bebida gaseosa'),
    ('bebida_gaseosa', 'gaseosa'),
    ('bebida_gaseosa', 'pepsi'),
    ('bebida_gaseosa', 'coca cola'),
    ('bebida_gaseosa', 'coca-cola'),
    ('bebida_gaseosa', 'sprite'),
    ('bebida_gaseosa', 'fanta'),
    ('jugo_liquido', 'jugo'),
    ('jugo_liquido', 'jugo líquido'),
    ('jugo_liquido', 'jugo liquido'),
    ('agua_mineral', 'agua'),
    ('agua_mineral', 'agua mineral'),
    ('salchichas', 'salchicha'),
    ('salchichas', 'salchichas'),
    ('salchichas', 'vienesa'),
    ('salchichas', 'vienesas'),
    ('yogur', 'yogur'),
    ('yogur', 'yogurt')
)
INSERT INTO public.product_aliases (product_id, alias, alias_key)
SELECT DISTINCT ON (public.product_key(a.alias))
  p.id,
  a.alias,
  public.product_key(a.alias)
FROM alias_seed a
JOIN public.products p ON p.canonical_name = a.canonical_name
WHERE public.product_key(a.alias) <> ''
ORDER BY public.product_key(a.alias), a.canonical_name
ON CONFLICT (alias_key) DO NOTHING;

-- Backfill de entradas ya aprobadas o antiguas que quedaron mal asociadas.
WITH matched AS (
  SELECT pe.id AS entry_id, p.id AS product_id, p.name AS standard_name
  FROM public.price_entries pe
  JOIN public.product_aliases a ON a.alias_key = public.product_key(pe.product_name)
  JOIN public.products p ON p.id = a.product_id
)
UPDATE public.price_entries pe
SET product_id = matched.product_id,
    product_name = matched.standard_name
FROM matched
WHERE pe.id = matched.entry_id
  AND (pe.product_id IS NULL OR pe.product_id <> matched.product_id);

-- Backfill especial para bebidas y marcas frecuentes aunque el usuario haya escrito la marca como producto.
WITH beverage_product AS (
  SELECT id, name FROM public.products WHERE canonical_name = 'bebida_gaseosa' LIMIT 1
)
UPDATE public.price_entries pe
SET product_id = bp.id,
    product_name = bp.name
FROM beverage_product bp
WHERE public.product_key(coalesce(pe.product_name, '') || ' ' || coalesce(pe.brand, '')) SIMILAR TO '%(bebida|gaseosa|pepsi|coca cola|sprite|fanta)%';

WITH sausage_product AS (
  SELECT id, name FROM public.products WHERE canonical_name = 'salchichas' LIMIT 1
)
UPDATE public.price_entries pe
SET product_id = sp.id,
    product_name = sp.name
FROM sausage_product sp
WHERE public.product_key(coalesce(pe.product_name, '') || ' ' || coalesce(pe.brand, '')) SIMILAR TO '%(salchicha|vienesa)%';

CREATE INDEX IF NOT EXISTS idx_entries_product_id_status_date
  ON public.price_entries(product_id, validation_status, purchase_date);
