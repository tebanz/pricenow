-- PriceNow · Ajuste de unidades estándar para reportes comparables
-- Ejecutar después de la migración de productos estandarizados.
-- Objetivo: que mínimo, promedio y máximo se calculen por unidad comparable
-- según el tipo de producto: kg, litro, unidad, caja, par, etc.

-- 1) Ajustes de unidades base para productos existentes.
UPDATE public.products
SET default_unit = 'kg'::public.unit_type
WHERE canonical_name IN (
  'pan_marraqueta',
  'pan_hallulla',
  'longaniza',
  'vienesas',
  'queso_gauda',
  'carne_molida',
  'pollo_entero',
  'trutro_pollo',
  'pechuga_pollo',
  'posta_negra',
  'posta_rosada',
  'plateada',
  'chuleta_cerdo',
  'merluza',
  'salmon',
  'papa',
  'tomate',
  'cebolla',
  'zanahoria',
  'zapallo_camote',
  'palta',
  'manzana',
  'platano',
  'naranja',
  'limon',
  'arroz_grado1',
  'porotos',
  'lentejas',
  'garbanzos',
  'harina_sin_polvos',
  'harina_con_polvos',
  'azucar_blanca',
  'sal',
  'fideos_espagueti',
  'fideos_corbata',
  'fideos_tallarines',
  'detergente_polvo',
  'comida_perro',
  'comida_gato'
);

UPDATE public.products
SET default_unit = 'litro'::public.unit_type
WHERE canonical_name IN (
  'leche_entera',
  'leche_semidescremada',
  'leche_descremada',
  'aceite_maravilla',
  'aceite_vegetal',
  'aceite_oliva',
  'agua_mineral',
  'detergente_liquido',
  'lavalozas',
  'cloro'
);

UPDATE public.products
SET default_unit = 'unidad'::public.unit_type
WHERE canonical_name IN (
  'yogur',
  'pan_amasado',
  'pan_molde_blanco',
  'pan_molde_integral',
  'tortilla_rescoldo',
  'quesillo',
  'mantequilla',
  'margarina',
  'huevo',
  'docena_huevos',
  'cafe_instantaneo',
  'salsa_tomate',
  'atun_conserva',
  'jurel_conserva',
  'tomate_conserva',
  'bebida_gaseosa',
  'jugo_liquido',
  'papel_higienico',
  'toalla_nova',
  'shampoo',
  'jabon',
  'pasta_dental',
  'panales',
  'lechuga'
);

UPDATE public.products
SET default_unit = 'caja'::public.unit_type
WHERE canonical_name IN ('te');

-- 2) Agrega producto estándar para salchichas si no existe.
INSERT INTO public.products (name, canonical_name, normalized_key, category, subcategory, default_unit)
SELECT
  'Salchichas',
  'salchichas',
  public.product_key('Salchichas'),
  'Carnes',
  'Cecinas',
  'kg'::public.unit_type
WHERE NOT EXISTS (
  SELECT 1 FROM public.products
  WHERE canonical_name = 'salchichas'
     OR public.product_key(name) = public.product_key('Salchichas')
);

-- 3) Alias comunes para salchichas/vienesas.
WITH alias_seed(canonical_name, alias) AS (
  VALUES
    ('salchichas', 'salchicha'),
    ('salchichas', 'salchichas'),
    ('salchichas', 'vienesa'),
    ('salchichas', 'vienesas'),
    ('salchichas', 'salchichas kg'),
    ('jugo_liquido', 'jugo'),
    ('jugo_liquido', 'jugos'),
    ('jugo_liquido', 'jugo en caja'),
    ('jugo_liquido', 'jugo botella'),
    ('yogur', 'yogurt'),
    ('yogur', 'yoghurt'),
    ('yogur', 'yogur unidad')
), resolved AS (
  SELECT DISTINCT ON (public.product_key(a.alias))
    p.id AS product_id,
    a.alias,
    public.product_key(a.alias) AS alias_key
  FROM alias_seed a
  JOIN public.products p ON p.canonical_name = a.canonical_name
  ORDER BY public.product_key(a.alias), a.canonical_name
)
INSERT INTO public.product_aliases (product_id, alias, alias_key)
SELECT product_id, alias, alias_key
FROM resolved
ON CONFLICT (alias_key) DO UPDATE
SET product_id = EXCLUDED.product_id,
    alias = EXCLUDED.alias;

-- 4) Reasigna entradas antiguas con alias de salchicha/vienesa al producto Salchichas.
UPDATE public.price_entries pe
SET product_id = p.id,
    product_name = p.name
FROM public.products p
WHERE p.canonical_name = 'salchichas'
  AND public.product_key(pe.product_name) IN (
    public.product_key('salchicha'),
    public.product_key('salchichas'),
    public.product_key('vienesa'),
    public.product_key('vienesas')
  );
