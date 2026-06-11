-- ============================================================
-- PriceNow · Productos estandarizados y alias
-- Versión corregida: alias duplicados usa ON CONFLICT DO NOTHING
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1) Normalizador simple para comparar nombres sin tildes, mayúsculas ni signos.
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

-- 2) Mejoras al catálogo actual.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS normalized_key TEXT;

UPDATE public.products
SET normalized_key = public.product_key(name)
WHERE normalized_key IS NULL OR normalized_key = '';

CREATE INDEX IF NOT EXISTS idx_products_normalized_key
  ON public.products(normalized_key);

CREATE INDEX IF NOT EXISTS idx_products_active_category
  ON public.products(is_active, category, name);

-- 3) Tabla de alias: permite que "pan batido", "marraqueta" o "pan francés"
-- apunten al mismo producto estándar.
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

CREATE INDEX IF NOT EXISTS idx_product_aliases_product
  ON public.product_aliases(product_id);

-- 4) Semilla amplia inicial. No pretende ser una lista oficial completa.
WITH seed(name, canonical_name, category, subcategory, default_unit) AS (
  VALUES
    ('Pan marraqueta', 'pan_marraqueta', 'Panadería', 'Pan', 'kg'::public.unit_type),
    ('Pan hallulla', 'pan_hallulla', 'Panadería', 'Pan', 'kg'::public.unit_type),
    ('Pan amasado', 'pan_amasado', 'Panadería', 'Pan', 'unidad'::public.unit_type),
    ('Pan molde blanco', 'pan_molde_blanco', 'Panadería', 'Pan de molde', 'unidad'::public.unit_type),
    ('Pan molde integral', 'pan_molde_integral', 'Panadería', 'Pan de molde', 'unidad'::public.unit_type),
    ('Tortilla de rescoldo', 'tortilla_rescoldo', 'Panadería', 'Pan', 'unidad'::public.unit_type),

    ('Leche entera', 'leche_entera', 'Lácteos', 'Leche', 'litro'::public.unit_type),
    ('Leche semidescremada', 'leche_semidescremada', 'Lácteos', 'Leche', 'litro'::public.unit_type),
    ('Leche descremada', 'leche_descremada', 'Lácteos', 'Leche', 'litro'::public.unit_type),
    ('Yogur', 'yogur', 'Lácteos', 'Yogur', 'unidad'::public.unit_type),
    ('Queso gauda', 'queso_gauda', 'Lácteos', 'Queso', 'kg'::public.unit_type),
    ('Quesillo', 'quesillo', 'Lácteos', 'Queso fresco', 'unidad'::public.unit_type),
    ('Mantequilla', 'mantequilla', 'Lácteos', 'Mantequilla', 'unidad'::public.unit_type),
    ('Margarina', 'margarina', 'Lácteos', 'Margarina', 'unidad'::public.unit_type),

    ('Huevo', 'huevo', 'Huevos', 'Huevo', 'unidad'::public.unit_type),
    ('Docena de huevos', 'docena_huevos', 'Huevos', 'Huevo', 'unidad'::public.unit_type),

    ('Arroz grado 1', 'arroz_grado1', 'Arroz y legumbres', 'Arroz', 'kg'::public.unit_type),
    ('Porotos', 'porotos', 'Arroz y legumbres', 'Legumbres', 'kg'::public.unit_type),
    ('Lentejas', 'lentejas', 'Arroz y legumbres', 'Legumbres', 'kg'::public.unit_type),
    ('Garbanzos', 'garbanzos', 'Arroz y legumbres', 'Legumbres', 'kg'::public.unit_type),
    ('Harina sin polvos', 'harina_sin_polvos', 'Abarrotes', 'Harina', 'kg'::public.unit_type),
    ('Harina con polvos', 'harina_con_polvos', 'Abarrotes', 'Harina', 'kg'::public.unit_type),
    ('Azúcar blanca', 'azucar_blanca', 'Abarrotes', 'Azúcar', 'kg'::public.unit_type),
    ('Sal', 'sal', 'Abarrotes', 'Condimentos', 'kg'::public.unit_type),
    ('Té', 'te', 'Abarrotes', 'Infusiones', 'caja'::public.unit_type),
    ('Café instantáneo', 'cafe_instantaneo', 'Abarrotes', 'Café', 'unidad'::public.unit_type),

    ('Fideos espagueti', 'fideos_espagueti', 'Pastas', 'Fideos', 'kg'::public.unit_type),
    ('Fideos corbata', 'fideos_corbata', 'Pastas', 'Fideos', 'kg'::public.unit_type),
    ('Fideos tallarines', 'fideos_tallarines', 'Pastas', 'Fideos', 'kg'::public.unit_type),
    ('Salsa de tomate', 'salsa_tomate', 'Conservas', 'Salsas', 'unidad'::public.unit_type),
    ('Atún en conserva', 'atun_conserva', 'Conservas', 'Pescado en conserva', 'unidad'::public.unit_type),
    ('Jurel en conserva', 'jurel_conserva', 'Conservas', 'Pescado en conserva', 'unidad'::public.unit_type),
    ('Tomate en conserva', 'tomate_conserva', 'Conservas', 'Verdura en conserva', 'unidad'::public.unit_type),

    ('Aceite maravilla', 'aceite_maravilla', 'Aceites', 'Aceite vegetal', 'litro'::public.unit_type),
    ('Aceite vegetal', 'aceite_vegetal', 'Aceites', 'Aceite vegetal', 'litro'::public.unit_type),
    ('Aceite de oliva', 'aceite_oliva', 'Aceites', 'Aceite de oliva', 'litro'::public.unit_type),

    ('Pollo entero', 'pollo_entero', 'Carnes', 'Ave', 'kg'::public.unit_type),
    ('Trutro de pollo', 'trutro_pollo', 'Carnes', 'Ave', 'kg'::public.unit_type),
    ('Pechuga de pollo', 'pechuga_pollo', 'Carnes', 'Ave', 'kg'::public.unit_type),
    ('Carne molida', 'carne_molida', 'Carnes', 'Vacuno', 'kg'::public.unit_type),
    ('Posta negra', 'posta_negra', 'Carnes', 'Vacuno', 'kg'::public.unit_type),
    ('Posta rosada', 'posta_rosada', 'Carnes', 'Vacuno', 'kg'::public.unit_type),
    ('Plateada', 'plateada', 'Carnes', 'Vacuno', 'kg'::public.unit_type),
    ('Chuleta de cerdo', 'chuleta_cerdo', 'Carnes', 'Cerdo', 'kg'::public.unit_type),
    ('Longaniza', 'longaniza', 'Carnes', 'Cecinas', 'kg'::public.unit_type),
    ('Vienesas', 'vienesas', 'Carnes', 'Cecinas', 'unidad'::public.unit_type),

    ('Merluza', 'merluza', 'Pescados y mariscos', 'Pescado', 'kg'::public.unit_type),
    ('Salmón', 'salmon', 'Pescados y mariscos', 'Pescado', 'kg'::public.unit_type),

    ('Papa', 'papa', 'Verduras', 'Tubérculo', 'kg'::public.unit_type),
    ('Tomate', 'tomate', 'Verduras', 'Verdura', 'kg'::public.unit_type),
    ('Cebolla', 'cebolla', 'Verduras', 'Verdura', 'kg'::public.unit_type),
    ('Zanahoria', 'zanahoria', 'Verduras', 'Verdura', 'kg'::public.unit_type),
    ('Lechuga', 'lechuga', 'Verduras', 'Verdura', 'unidad'::public.unit_type),
    ('Zapallo camote', 'zapallo_camote', 'Verduras', 'Verdura', 'kg'::public.unit_type),
    ('Palta', 'palta', 'Frutas', 'Fruta', 'kg'::public.unit_type),
    ('Manzana', 'manzana', 'Frutas', 'Fruta', 'kg'::public.unit_type),
    ('Plátano', 'platano', 'Frutas', 'Fruta', 'kg'::public.unit_type),
    ('Naranja', 'naranja', 'Frutas', 'Fruta', 'kg'::public.unit_type),
    ('Limón', 'limon', 'Frutas', 'Fruta', 'kg'::public.unit_type),

    ('Bebida gaseosa', 'bebida_gaseosa', 'Bebidas', 'Bebida', 'litro'::public.unit_type),
    ('Agua mineral', 'agua_mineral', 'Bebidas', 'Agua', 'litro'::public.unit_type),
    ('Jugo líquido', 'jugo_liquido', 'Bebidas', 'Jugo', 'litro'::public.unit_type),

    ('Detergente líquido', 'detergente_liquido', 'Limpieza', 'Lavado', 'litro'::public.unit_type),
    ('Detergente en polvo', 'detergente_polvo', 'Limpieza', 'Lavado', 'kg'::public.unit_type),
    ('Lavalozas', 'lavalozas', 'Limpieza', 'Cocina', 'litro'::public.unit_type),
    ('Cloro', 'cloro', 'Limpieza', 'Desinfección', 'litro'::public.unit_type),
    ('Papel higiénico', 'papel_higienico', 'Higiene', 'Papel', 'unidad'::public.unit_type),
    ('Toalla nova', 'toalla_nova', 'Higiene', 'Papel', 'unidad'::public.unit_type),
    ('Shampoo', 'shampoo', 'Higiene', 'Cuidado personal', 'unidad'::public.unit_type),
    ('Jabón', 'jabon', 'Higiene', 'Cuidado personal', 'unidad'::public.unit_type),
    ('Pasta dental', 'pasta_dental', 'Higiene', 'Cuidado personal', 'unidad'::public.unit_type),

    ('Pañales', 'panales', 'Bebé', 'Pañales', 'unidad'::public.unit_type),
    ('Comida de perro', 'comida_perro', 'Mascotas', 'Alimento', 'kg'::public.unit_type),
    ('Comida de gato', 'comida_gato', 'Mascotas', 'Alimento', 'kg'::public.unit_type)
)
INSERT INTO public.products (name, canonical_name, normalized_key, category, subcategory, default_unit)
SELECT seed.name, seed.canonical_name, public.product_key(seed.name), seed.category, seed.subcategory, seed.default_unit
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.canonical_name = seed.canonical_name
     OR public.product_key(p.name) = public.product_key(seed.name)
);

-- Actualiza normalized_key de los productos nuevos.
UPDATE public.products
SET normalized_key = public.product_key(name)
WHERE normalized_key IS NULL OR normalized_key = '';

-- 5) Alias comunes para unir nombres escritos distinto.
WITH alias_seed(canonical_name, alias) AS (
  VALUES
    ('pan_marraqueta', 'pan'),
    ('pan_marraqueta', 'marraqueta'),
    ('pan_marraqueta', 'pan batido'),
    ('pan_marraqueta', 'pan frances'),
    ('pan_marraqueta', 'pan francés'),
    ('pan_hallulla', 'hallulla'),
    ('pan_hallulla', 'pan hallulla'),
    ('pan_amasado', 'pan amasado'),
    ('leche_entera', 'leche'),
    ('leche_entera', 'leche entera'),
    ('leche_semidescremada', 'leche semi'),
    ('leche_semidescremada', 'leche semidescremada'),
    ('leche_descremada', 'leche descremada'),
    ('huevo', 'huevos'),
    ('huevo', 'huevo'),
    ('docena_huevos', 'docena huevos'),
    ('docena_huevos', 'docena de huevos'),
    ('arroz_grado1', 'arroz'),
    ('arroz_grado1', 'arroz grado 1'),
    ('azucar_blanca', 'azucar'),
    ('azucar_blanca', 'azúcar'),
    ('fideos_espagueti', 'fideos'),
    ('fideos_espagueti', 'espagueti'),
    ('fideos_tallarines', 'tallarines'),
    ('aceite_maravilla', 'aceite'),
    ('aceite_maravilla', 'aceite maravilla'),
    ('aceite_vegetal', 'aceite vegetal'),
    ('pollo_entero', 'pollo'),
    ('pechuga_pollo', 'pechuga'),
    ('pechuga_pollo', 'pechuga de pollo'),
    ('trutro_pollo', 'trutro'),
    ('trutro_pollo', 'trutro de pollo'),
    ('carne_molida', 'molida'),
    ('carne_molida', 'carne molida'),
    ('papa', 'papas'),
    ('papa', 'papa'),
    ('tomate', 'tomates'),
    ('tomate', 'tomate'),
    ('cebolla', 'cebollas'),
    ('cebolla', 'cebolla'),
    ('platano', 'platanos'),
    ('platano', 'plátanos'),
    ('platano', 'platano'),
    ('platano', 'plátano'),
    ('bebida_gaseosa', 'bebida'),
    ('bebida_gaseosa', 'bebida gaseosa'),
    ('agua_mineral', 'agua'),
    ('agua_mineral', 'agua mineral'),
    ('detergente_liquido', 'detergente'),
    ('detergente_liquido', 'detergente liquido'),
    ('detergente_liquido', 'detergente líquido'),
    ('papel_higienico', 'papel confort'),
    ('papel_higienico', 'papel higienico'),
    ('papel_higienico', 'papel higiénico'),
    ('toalla_nova', 'toalla nova'),
    ('jabon', 'jabon'),
    ('jabon', 'jabón')
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

-- Cada producto también queda como alias de sí mismo.
INSERT INTO public.product_aliases (product_id, alias, alias_key)
SELECT p.id, p.name, public.product_key(p.name)
FROM public.products p
WHERE p.is_active = TRUE
  AND public.product_key(p.name) <> ''
ON CONFLICT (alias_key) DO NOTHING;

-- 6) Función usada por la app: busca producto por alias/catálogo; si no existe, lo crea.
CREATE OR REPLACE FUNCTION public.find_or_create_product(
  p_name TEXT,
  p_category TEXT DEFAULT 'Otros',
  p_default_unit public.unit_type DEFAULT 'unidad'
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  canonical_name TEXT,
  category TEXT,
  default_unit public.unit_type,
  was_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_slug TEXT;
  v_product public.products%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_key := public.product_key(p_name);
  v_slug := public.product_slug(p_name);

  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Nombre de producto inválido';
  END IF;

  SELECT p.* INTO v_product
  FROM public.product_aliases a
  JOIN public.products p ON p.id = a.product_id
  WHERE a.alias_key = v_key
    AND p.is_active = TRUE
  LIMIT 1;

  IF FOUND THEN
    id := v_product.id;
    name := v_product.name;
    canonical_name := v_product.canonical_name;
    category := v_product.category;
    default_unit := v_product.default_unit;
    was_created := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT p.* INTO v_product
  FROM public.products p
  WHERE p.is_active = TRUE
    AND (
      p.normalized_key = v_key
      OR public.product_key(p.name) = v_key
      OR p.canonical_name = v_slug
    )
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.product_aliases (product_id, alias, alias_key)
    VALUES (v_product.id, p_name, v_key)
    ON CONFLICT (alias_key) DO NOTHING;

    id := v_product.id;
    name := v_product.name;
    canonical_name := v_product.canonical_name;
    category := v_product.category;
    default_unit := v_product.default_unit;
    was_created := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.products (
    name,
    canonical_name,
    normalized_key,
    category,
    subcategory,
    default_unit,
    created_by
  )
  VALUES (
    initcap(v_key),
    v_slug,
    v_key,
    COALESCE(NULLIF(trim(p_category), ''), 'Otros'),
    NULL,
    COALESCE(p_default_unit, 'unidad'::public.unit_type),
    auth.uid()
  )
  RETURNING * INTO v_product;

  INSERT INTO public.product_aliases (product_id, alias, alias_key)
  VALUES (v_product.id, p_name, v_key)
  ON CONFLICT (alias_key) DO NOTHING;

  id := v_product.id;
  name := v_product.name;
  canonical_name := v_product.canonical_name;
  category := v_product.category;
  default_unit := v_product.default_unit;
  was_created := TRUE;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_product(TEXT, TEXT, public.unit_type) TO authenticated;

-- 7) Backfill: une reportes antiguos con productos estándar cuando haya coincidencia por alias o nombre.
WITH matched_alias AS (
  SELECT pe.id AS entry_id, p.id AS product_id, p.name AS product_name
  FROM public.price_entries pe
  JOIN public.product_aliases a ON a.alias_key = public.product_key(pe.product_name)
  JOIN public.products p ON p.id = a.product_id
  WHERE pe.product_id IS NULL
)
UPDATE public.price_entries pe
SET product_id = ma.product_id,
    product_name = ma.product_name
FROM matched_alias ma
WHERE pe.id = ma.entry_id;

WITH matched_product AS (
  SELECT pe.id AS entry_id, p.id AS product_id, p.name AS product_name
  FROM public.price_entries pe
  JOIN public.products p ON public.product_key(p.name) = public.product_key(pe.product_name)
  WHERE pe.product_id IS NULL
    AND p.is_active = TRUE
)
UPDATE public.price_entries pe
SET product_id = mp.product_id,
    product_name = mp.product_name
FROM matched_product mp
WHERE pe.id = mp.entry_id;

CREATE INDEX IF NOT EXISTS idx_entries_product_id_status_date
  ON public.price_entries(product_id, validation_status, purchase_date);
