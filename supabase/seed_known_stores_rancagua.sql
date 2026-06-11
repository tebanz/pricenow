-- ============================================================
-- PriceNow · Tiendas conocidas de Rancagua para sugerencias rápidas
-- Ejecutar en Supabase SQL Editor.
-- No usa Google Cloud ni API keys.
-- ============================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual';

WITH seed(name, chain, sector, address) AS (
  VALUES
    ('Santa Isabel Santa Filomena', 'Santa Isabel', 'Villa Santa Filomena', 'Lourdes Esquina Santa Filomena 1540'),
    ('Santa Isabel José Manuel Astorga', 'Santa Isabel', 'Centro', 'Av. José Manuel Astorga 360'),
    ('Santa Isabel República de Chile', 'Santa Isabel', 'Av. República de Chile', 'Av. República de Chile 450'),
    ('Santa Isabel El Sol', 'Santa Isabel', 'Villa El Sol', 'Av. El Sol 01834'),
    ('Jumbo Presidente Eduardo Frei', 'Jumbo', 'Rancagua', 'Av. Presidente Eduardo Frei Montalva 750'),
    ('Lider Eduardo Frei', 'Lider', 'Rancagua', 'Av. Eduardo Frei Montalva 190'),
    ('Mayorista 10 Avenida Brasil', 'Mayorista 10', 'Rancagua', 'Av. Brasil 1016'),
    ('Alvi Bombero Ruiz Díaz', 'Alvi', 'Rancagua', 'Bombero Ruiz Díaz 40'),
    ('Unimarc Kennedy', 'Unimarc', 'Kennedy', 'Av. Kennedy 2235'),
    ('Super Bodega aCuenta El Sol', 'Acuenta', 'Villa El Sol', 'Av. El Sol 1071')
)
INSERT INTO public.stores (name, chain, sector, address, is_active, location_source)
SELECT seed.name, seed.chain, seed.sector, seed.address, TRUE, 'seed_known_store'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stores st
  WHERE lower(st.name) = lower(seed.name)
     OR lower(COALESCE(st.address, '')) = lower(seed.address)
);

UPDATE public.stores st
SET
  chain = seed.chain,
  sector = seed.sector,
  address = seed.address,
  is_active = TRUE,
  location_source = COALESCE(st.location_source, 'seed_known_store')
FROM (
  VALUES
    ('Santa Isabel Santa Filomena', 'Santa Isabel', 'Villa Santa Filomena', 'Lourdes Esquina Santa Filomena 1540'),
    ('Santa Isabel José Manuel Astorga', 'Santa Isabel', 'Centro', 'Av. José Manuel Astorga 360'),
    ('Santa Isabel República de Chile', 'Santa Isabel', 'Av. República de Chile', 'Av. República de Chile 450'),
    ('Santa Isabel El Sol', 'Santa Isabel', 'Villa El Sol', 'Av. El Sol 01834'),
    ('Jumbo Presidente Eduardo Frei', 'Jumbo', 'Rancagua', 'Av. Presidente Eduardo Frei Montalva 750'),
    ('Lider Eduardo Frei', 'Lider', 'Rancagua', 'Av. Eduardo Frei Montalva 190'),
    ('Mayorista 10 Avenida Brasil', 'Mayorista 10', 'Rancagua', 'Av. Brasil 1016'),
    ('Alvi Bombero Ruiz Díaz', 'Alvi', 'Rancagua', 'Bombero Ruiz Díaz 40'),
    ('Unimarc Kennedy', 'Unimarc', 'Kennedy', 'Av. Kennedy 2235'),
    ('Super Bodega aCuenta El Sol', 'Acuenta', 'Villa El Sol', 'Av. El Sol 1071')
) AS seed(name, chain, sector, address)
WHERE lower(st.name) = lower(seed.name)
   OR lower(COALESCE(st.address, '')) = lower(seed.address);
