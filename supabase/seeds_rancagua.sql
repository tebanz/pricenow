-- ============================================================
-- PriceNow · Semilla de sectores/poblaciones y supermercados
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql/policies.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  zone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sectors_select_active" ON public.sectors;
DROP POLICY IF EXISTS "sectors_admin_all" ON public.sectors;

CREATE POLICY "sectors_select_active"
  ON public.sectors FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "sectors_admin_all"
  ON public.sectors FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'validator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'validator')
    )
  );

WITH seed(name, zone) AS (
  VALUES
    ('Centro', 'Centro'),
    ('Rancagua Norte', 'Norte'),
    ('Rancagua Sur', 'Sur'),
    ('Rancagua Oriente', 'Oriente'),
    ('Rancagua Poniente', 'Poniente'),
    ('Alameda', 'Centro'),
    ('Av. República de Chile', 'Oriente'),
    ('Baquedano', 'Centro'),
    ('Campos', 'Centro'),
    ('Carretera del Cobre', 'Oriente'),
    ('Centro Histórico', 'Centro'),
    ('El Tenis', 'Oriente'),
    ('El Trébol', 'Oriente'),
    ('Kennedy', 'Oriente'),
    ('La Compañía', 'Norte'),
    ('La Granja', 'Sur'),
    ('Las Américas', 'Oriente'),
    ('Los Alpes', 'Oriente'),
    ('Los Héroes', 'Poniente'),
    ('Los Libertadores', 'Oriente'),
    ('Manzanal', 'Norte'),
    ('Membrillar', 'Centro'),
    ('Millares', 'Centro'),
    ('Nueva Rancagua', 'Oriente'),
    ('Parque Koke', 'Sur'),
    ('Recreo', 'Centro'),
    ('San Joaquín', 'Oriente'),
    ('Santa Julia', 'Poniente'),
    ('Santa María', 'Poniente'),
    ('Santa Elena', 'Sur'),
    ('Villa Alameda', 'Centro'),
    ('Villa Alto Jahuel', 'Oriente'),
    ('Villa Araucanía', 'Sur'),
    ('Villa Baquedano', 'Centro'),
    ('Villa Bicentenario', 'Poniente'),
    ('Villa Bosques de San Francisco', 'Oriente'),
    ('Villa Brisas del Sur', 'Sur'),
    ('Villa Camino Real', 'Oriente'),
    ('Villa Chiprodal', 'Oriente'),
    ('Villa Cordillera I', 'Oriente'),
    ('Villa Cordillera II', 'Oriente'),
    ('Villa Córdoba', 'Oriente'),
    ('Villa Coya Pangal', 'Oriente'),
    ('Villa De Blanco', 'Sur'),
    ('Villa Don Mateo', 'Oriente'),
    ('Villa El Bosque', 'Sur'),
    ('Villa El Cobre', 'Oriente'),
    ('Villa El Manzanal', 'Norte'),
    ('Villa El Molino', 'Sur'),
    ('Villa El Sol', 'Oriente'),
    ('Villa El Sol III', 'Oriente'),
    ('Villa El Trigal', 'Oriente'),
    ('Villa Esperanza', 'Sur'),
    ('Villa Esperanza Norte', 'Norte'),
    ('Villa Galilea', 'Poniente'),
    ('Villa Hermosa', 'Sur'),
    ('Villa Héctor Olivares Solís', 'Sur'),
    ('Villa La Araucana', 'Sur'),
    ('Villa La Foresta', 'Oriente'),
    ('Villa La Hacienda', 'Oriente'),
    ('Villa La Reina', 'Oriente'),
    ('Villa Laguna del Inca', 'Oriente'),
    ('Villa Las Cañadas', 'Oriente'),
    ('Villa Las Cumbres', 'Oriente'),
    ('Villa Las Rosas', 'Sur'),
    ('Villa Los Alpes', 'Oriente'),
    ('Villa Los Castaños', 'Oriente'),
    ('Villa Los Jardines', 'Sur'),
    ('Villa Los Parques', 'Oriente'),
    ('Villa Los Tilos', 'Oriente'),
    ('Villa Los Tilos 3 y 4', 'Oriente'),
    ('Villa Luna', 'Oriente'),
    ('Villa Magisterio', 'Oriente'),
    ('Villa Magisterio II', 'Oriente'),
    ('Villa María Luisa', 'Poniente'),
    ('Villa Padre Hurtado', 'Sur'),
    ('Villa Parque María Luisa', 'Poniente'),
    ('Villa Parque Viña Santa Blanca', 'Poniente'),
    ('Villa Portal del Inca', 'Oriente'),
    ('Villa Profesor Almonacid', 'Sur'),
    ('Villa Pucará', 'Oriente'),
    ('Villa Pucará 1', 'Oriente'),
    ('Villa Rancagua Norte', 'Norte'),
    ('Villa San Francisco', 'Oriente'),
    ('Villa San Ramón', 'Poniente'),
    ('Villa Santa Blanca', 'Poniente'),
    ('Villa Santa Clara', 'Sur'),
    ('Villa Santa Filomena', 'Sur'),
    ('Villa Santa Isabel', 'Oriente'),
    ('Villa Santa Julia', 'Poniente'),
    ('Villa Santa María', 'Poniente'),
    ('Villa Sargento Aldea', 'Sur'),
    ('Villa Triana', 'Oriente'),
    ('Otro / No aparece mi sector', 'Otro')
)
INSERT INTO public.sectors (name, zone)
SELECT seed.name, seed.zone
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM public.sectors s
  WHERE lower(s.name) = lower(seed.name)
);

WITH seed(name, chain, sector, address) AS (
  VALUES
    ('Tottus Rancagua Centro', 'Tottus', 'Centro', 'Sargento Cuevas 405'),
    ('Tottus Avenida San Juan', 'Tottus', 'San Joaquín', 'Avenida San Juan 133'),
    ('Jumbo Carretera del Cobre', 'Jumbo', 'Carretera del Cobre', 'Carretera del Cobre 750'),
    ('Jumbo Membrillar', 'Jumbo', 'Centro', 'Membrillar 450'),
    ('Santa Isabel El Sol', 'Santa Isabel', 'Villa El Sol', 'El Sol 1834'),
    ('Santa Isabel República de Chile', 'Santa Isabel', 'Av. República de Chile', 'Av. República de Chile 450'),
    ('Lider Alberto Einstein', 'Lider', 'Rancagua', 'Av. Alberto Einstein 263'),
    ('Lider Recreo', 'Lider', 'Recreo', 'Recreo 620'),
    ('Lider Carretera del Cobre', 'Lider', 'Carretera del Cobre', 'Carretera del Cobre 190'),
    ('Lider Santa María', 'Lider', 'Santa María', 'Santa María 172'),
    ('Acuenta Rancagua', 'Acuenta', 'Los Libertadores', 'Av. Los Libertadores 800'),
    ('Mayorista 10 Av. Brasil', 'Mayorista 10', 'Rancagua', 'Av. Brasil 1016'),
    ('Mayorista 10 Bombero Ruiz Díaz', 'Mayorista 10', 'Rancagua', 'Bombero Ruiz Díaz 210'),
    ('Unimarc Membrillar', 'Unimarc', 'Centro', 'Membrillar 10'),
    ('Unimarc Miguel Ramírez', 'Unimarc', 'Rancagua', 'Miguel Ramírez 1420'),
    ('Unimarc Doctor Salinas', 'Unimarc', 'Rancagua', 'Dr. Salinas 115'),
    ('Unimarc Centro Comercial Kennedy', 'Unimarc', 'Kennedy', 'Centro Comercial Kennedy'),
    ('Cugat Santa María', 'Cugat', 'Santa María', 'Av. Presidente Domingo Santa María 381'),
    ('Cugat San Ramón', 'Cugat', 'San Ramón', 'San Ramón 3202'),
    ('Super10 Rancagua', 'Super10', 'Rancagua', NULL),
    ('Otra tienda / almacén / feria', NULL, 'Otro / No aparece mi sector', NULL)
)
INSERT INTO public.stores (name, chain, sector, address)
SELECT seed.name, seed.chain, seed.sector, seed.address
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM public.stores st
  WHERE lower(st.name) = lower(seed.name)
    AND COALESCE(lower(st.address), '') = COALESCE(lower(seed.address), '')
);
