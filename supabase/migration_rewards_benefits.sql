-- ============================================================
-- PriceNow · Puntos reales + beneficios/cupones
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_validator()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'validator')
  );
$$;

-- ─────────────────────────────────────────
-- Billetera de puntos por usuario
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_points (
  user_id          UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_points   INTEGER NOT NULL DEFAULT 0 CHECK (current_points >= 0),
  lifetime_points  INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.point_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points         INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  source_type    TEXT,
  source_id      UUID,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_user
  ON public.point_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_transactions_source
  ON public.point_transactions(source_type, source_id);

-- Evita entregar puntos dos veces por el mismo precio aprobado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_point_tx_price_entry_approved_once
  ON public.point_transactions(user_id, source_id, reason)
  WHERE source_type = 'price_entry' AND reason = 'price_entry_approved';

-- ─────────────────────────────────────────
-- Negocios asociados y cupones
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_partners (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  description   TEXT,
  sector        TEXT,
  address       TEXT,
  latitude      NUMERIC(10, 7),
  longitude     NUMERIC(10, 7),
  logo_url      TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_partners_active
  ON public.business_partners(is_active);

CREATE TABLE IF NOT EXISTS public.coupons (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID REFERENCES public.business_partners(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  discount_label    TEXT NOT NULL,
  points_cost       INTEGER NOT NULL DEFAULT 0 CHECK (points_cost >= 0),
  terms             TEXT,
  start_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date          DATE,
  max_redemptions   INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_user_limit    INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_active_dates
  ON public.coupons(is_active, start_date, end_date);

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coupon_id      UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_spent   INTEGER NOT NULL DEFAULT 0 CHECK (points_spent >= 0),
  code           TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'redeemed' CHECK (status IN ('redeemed', 'used', 'cancelled', 'expired')),
  redeemed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at        TIMESTAMPTZ,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user
  ON public.coupon_redemptions(user_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
  ON public.coupon_redemptions(coupon_id);

-- ─────────────────────────────────────────
-- Funciones de puntos
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_user_points(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_points (user_id, current_points, lifetime_points)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_point_transaction(
  p_user_id UUID,
  p_points INTEGER,
  p_reason TEXT,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.ensure_user_points(p_user_id);

  INSERT INTO public.point_transactions (
    user_id,
    points,
    reason,
    source_type,
    source_id,
    metadata
  ) VALUES (
    p_user_id,
    p_points,
    p_reason,
    p_source_type,
    p_source_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NOT NULL THEN
    UPDATE public.user_points
    SET
      current_points = GREATEST(0, current_points + p_points),
      lifetime_points = lifetime_points + GREATEST(p_points, 0),
      updated_at = NOW()
    WHERE user_id = p_user_id;
  END IF;

  RETURN v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_entry_points(
  p_receipt_photo_url TEXT,
  p_purchase_latitude NUMERIC,
  p_purchase_longitude NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_points INTEGER := 10;
BEGIN
  IF p_purchase_latitude IS NOT NULL AND p_purchase_longitude IS NOT NULL THEN
    v_points := v_points + 5;
  END IF;

  IF p_receipt_photo_url IS NOT NULL AND LENGTH(TRIM(p_receipt_photo_url)) > 0 THEN
    v_points := v_points + 5;
  END IF;

  RETURN v_points;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_points_for_approved_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points INTEGER;
BEGIN
  IF NEW.validation_status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.validation_status IS DISTINCT FROM 'approved') THEN

    v_points := public.calculate_entry_points(
      NEW.receipt_photo_url,
      NEW.purchase_latitude,
      NEW.purchase_longitude
    );

    PERFORM public.add_point_transaction(
      NEW.user_id,
      v_points,
      'price_entry_approved',
      'price_entry',
      NEW.id,
      jsonb_build_object(
        'product_name', NEW.product_name,
        'store_name', NEW.store_name,
        'base_points', 10,
        'location_bonus', CASE WHEN NEW.purchase_latitude IS NOT NULL AND NEW.purchase_longitude IS NOT NULL THEN 5 ELSE 0 END,
        'receipt_bonus', CASE WHEN NEW.receipt_photo_url IS NOT NULL AND LENGTH(TRIM(NEW.receipt_photo_url)) > 0 THEN 5 ELSE 0 END
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_entry_award_points ON public.price_entries;
CREATE TRIGGER after_entry_award_points
  AFTER INSERT OR UPDATE OF validation_status ON public.price_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.award_points_for_approved_entry();

-- Backfill: entrega puntos por precios ya aprobados, sin duplicarlos.
INSERT INTO public.user_points (user_id, current_points, lifetime_points)
SELECT id, 0, 0
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.point_transactions (
  user_id,
  points,
  reason,
  source_type,
  source_id,
  metadata,
  created_at
)
SELECT
  pe.user_id,
  public.calculate_entry_points(pe.receipt_photo_url, pe.purchase_latitude, pe.purchase_longitude) AS points,
  'price_entry_approved' AS reason,
  'price_entry' AS source_type,
  pe.id AS source_id,
  jsonb_build_object(
    'product_name', pe.product_name,
    'store_name', pe.store_name,
    'backfill', TRUE
  ) AS metadata,
  COALESCE(pe.validated_at, pe.created_at) AS created_at
FROM public.price_entries pe
WHERE pe.validation_status = 'approved'
ON CONFLICT DO NOTHING;

-- Recalcular billeteras desde historial.
INSERT INTO public.user_points (user_id, current_points, lifetime_points, updated_at)
SELECT
  user_id,
  GREATEST(0, SUM(points))::INTEGER AS current_points,
  SUM(GREATEST(points, 0))::INTEGER AS lifetime_points,
  NOW()
FROM public.point_transactions
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
SET
  current_points = EXCLUDED.current_points,
  lifetime_points = EXCLUDED.lifetime_points,
  updated_at = NOW();

-- ─────────────────────────────────────────
-- Canje de cupón
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.redeem_coupon(p_coupon_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_coupon public.coupons%ROWTYPE;
  v_balance INTEGER;
  v_total_redemptions INTEGER;
  v_user_redemptions INTEGER;
  v_code TEXT;
  v_redemption_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'Debes iniciar sesión para canjear beneficios.');
  END IF;

  SELECT * INTO v_coupon
  FROM public.coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'El beneficio no existe.');
  END IF;

  IF v_coupon.is_active IS NOT TRUE
     OR v_coupon.start_date > CURRENT_DATE
     OR (v_coupon.end_date IS NOT NULL AND v_coupon.end_date < CURRENT_DATE) THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'Este beneficio no está disponible.');
  END IF;

  PERFORM public.ensure_user_points(v_user_id);

  SELECT current_points INTO v_balance
  FROM public.user_points
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_balance < v_coupon.points_cost THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'No tienes puntos suficientes para canjear este beneficio.');
  END IF;

  SELECT COUNT(*) INTO v_total_redemptions
  FROM public.coupon_redemptions
  WHERE coupon_id = p_coupon_id
    AND status IN ('redeemed', 'used');

  IF v_coupon.max_redemptions IS NOT NULL AND v_total_redemptions >= v_coupon.max_redemptions THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'Este beneficio ya alcanzó el máximo de canjes.');
  END IF;

  SELECT COUNT(*) INTO v_user_redemptions
  FROM public.coupon_redemptions
  WHERE coupon_id = p_coupon_id
    AND user_id = v_user_id
    AND status IN ('redeemed', 'used');

  IF v_user_redemptions >= v_coupon.per_user_limit THEN
    RETURN jsonb_build_object('ok', FALSE, 'message', 'Ya canjeaste este beneficio.');
  END IF;

  v_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || v_user_id::TEXT), 1, 8));

  INSERT INTO public.coupon_redemptions (
    coupon_id,
    user_id,
    points_spent,
    code
  ) VALUES (
    p_coupon_id,
    v_user_id,
    v_coupon.points_cost,
    v_code
  )
  RETURNING id INTO v_redemption_id;

  IF v_coupon.points_cost > 0 THEN
    PERFORM public.add_point_transaction(
      v_user_id,
      -v_coupon.points_cost,
      'coupon_redeemed',
      'coupon_redemption',
      v_redemption_id,
      jsonb_build_object(
        'coupon_id', p_coupon_id,
        'coupon_title', v_coupon.title,
        'code', v_code
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'message', 'Beneficio canjeado correctamente.',
    'code', v_code,
    'redemption_id', v_redemption_id
  );
END;
$$;

-- ─────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────

ALTER TABLE public.user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_points_select_own" ON public.user_points;
CREATE POLICY "user_points_select_own"
  ON public.user_points FOR SELECT
  USING (auth.uid() = user_id OR public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "point_transactions_select_own" ON public.point_transactions;
CREATE POLICY "point_transactions_select_own"
  ON public.point_transactions FOR SELECT
  USING (auth.uid() = user_id OR public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "business_partners_select_active" ON public.business_partners;
CREATE POLICY "business_partners_select_active"
  ON public.business_partners FOR SELECT
  USING (is_active = TRUE OR public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "business_partners_insert_admin" ON public.business_partners;
CREATE POLICY "business_partners_insert_admin"
  ON public.business_partners FOR INSERT
  WITH CHECK (public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "business_partners_update_admin" ON public.business_partners;
CREATE POLICY "business_partners_update_admin"
  ON public.business_partners FOR UPDATE
  USING (public.current_user_is_admin_or_validator())
  WITH CHECK (public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "coupons_select_available" ON public.coupons;
CREATE POLICY "coupons_select_available"
  ON public.coupons FOR SELECT
  USING (
    public.current_user_is_admin_or_validator()
    OR (
      is_active = TRUE
      AND start_date <= CURRENT_DATE
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "coupons_insert_admin" ON public.coupons;
CREATE POLICY "coupons_insert_admin"
  ON public.coupons FOR INSERT
  WITH CHECK (public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "coupons_update_admin" ON public.coupons;
CREATE POLICY "coupons_update_admin"
  ON public.coupons FOR UPDATE
  USING (public.current_user_is_admin_or_validator())
  WITH CHECK (public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "coupon_redemptions_select_own" ON public.coupon_redemptions;
CREATE POLICY "coupon_redemptions_select_own"
  ON public.coupon_redemptions FOR SELECT
  USING (auth.uid() = user_id OR public.current_user_is_admin_or_validator());

-- La inserción de redenciones debe hacerse con redeem_coupon().
DROP POLICY IF EXISTS "coupon_redemptions_insert_admin" ON public.coupon_redemptions;
CREATE POLICY "coupon_redemptions_insert_admin"
  ON public.coupon_redemptions FOR INSERT
  WITH CHECK (public.current_user_is_admin_or_validator());

DROP POLICY IF EXISTS "coupon_redemptions_update_admin" ON public.coupon_redemptions;
CREATE POLICY "coupon_redemptions_update_admin"
  ON public.coupon_redemptions FOR UPDATE
  USING (public.current_user_is_admin_or_validator())
  WITH CHECK (public.current_user_is_admin_or_validator());

-- ─────────────────────────────────────────
-- Permisos RPC
-- ─────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.redeem_coupon(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_points(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_point_transaction(UUID, INTEGER, TEXT, TEXT, UUID, JSONB) TO authenticated;

-- Nota: no se insertan cupones reales de ejemplo para no mostrar beneficios que no existan.
-- Puedes crearlos desde el nuevo apartado Beneficios si eres admin/validator.
