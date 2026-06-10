-- ============================================================
-- PriceNow · Políticas de Seguridad (Row Level Security)
-- Ejecutar DESPUÉS de schema.sql
-- ============================================================

-- ─────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede ver perfiles públicos
CREATE POLICY "profiles_select_public"
  ON public.profiles FOR SELECT
  USING (TRUE);

-- Solo el propio usuario puede editar su perfil
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Lectura pública para productos activos
CREATE POLICY "products_select_active"
  ON public.products FOR SELECT
  USING (is_active = TRUE);

-- Solo admin puede crear/editar productos
CREATE POLICY "products_insert_admin"
  ON public.products FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'validator')
    )
  );

-- ─────────────────────────────────────────
-- STORES
-- ─────────────────────────────────────────

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_select_all"
  ON public.stores FOR SELECT
  USING (is_active = TRUE);

-- ─────────────────────────────────────────
-- PRICE_ENTRIES
-- ─────────────────────────────────────────

ALTER TABLE public.price_entries ENABLE ROW LEVEL SECURITY;

-- Los usuarios ven sus propias entradas (cualquier estado)
CREATE POLICY "entries_select_own"
  ON public.price_entries FOR SELECT
  USING (auth.uid() = user_id);

-- Entradas aprobadas son visibles para todos (para ranking)
CREATE POLICY "entries_select_approved"
  ON public.price_entries FOR SELECT
  USING (validation_status = 'approved');

-- Validadores y admins ven entradas pendientes
CREATE POLICY "entries_select_validators"
  ON public.price_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('validator', 'admin')
    )
  );

-- Usuarios autenticados pueden crear entradas
CREATE POLICY "entries_insert_authenticated"
  ON public.price_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- El usuario puede editar sus propias entradas PENDING
CREATE POLICY "entries_update_own_pending"
  ON public.price_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND validation_status = 'pending'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND validation_status = 'pending'
  );

-- Validadores pueden cambiar estado de validación
CREATE POLICY "entries_update_validators"
  ON public.price_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('validator', 'admin')
    )
  );

-- El usuario puede eliminar sus propias entradas PENDING
CREATE POLICY "entries_delete_own_pending"
  ON public.price_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND validation_status = 'pending'
  );

-- ─────────────────────────────────────────
-- WEEKLY_REPORTS
-- ─────────────────────────────────────────

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

-- Lectura pública para reportes
CREATE POLICY "reports_select_all"
  ON public.weekly_reports FOR SELECT
  USING (TRUE);

-- Solo admin puede generar reportes
CREATE POLICY "reports_insert_admin"
  ON public.weekly_reports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ─────────────────────────────────────────
-- STORAGE: bucket 'receipts'
-- Ejecutar en Supabase Dashboard > Storage > Policies
-- ─────────────────────────────────────────

-- Crear el bucket via SQL (alternativa al Dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', FALSE)
ON CONFLICT DO NOTHING;

-- Solo el dueño puede subir fotos
CREATE POLICY "receipts_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- El dueño puede ver sus fotos
CREATE POLICY "receipts_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Validadores pueden ver fotos para validar
CREATE POLICY "receipts_select_validators"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('validator', 'admin')
    )
  );

-- El dueño puede eliminar sus fotos SOLO si entry está pending
CREATE POLICY "receipts_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
