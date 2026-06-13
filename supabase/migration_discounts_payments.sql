-- PriceNow - Descuentos, promociones y metodos de pago
-- Ejecutar en Supabase SQL Editor. Es seguro repetirlo.

ALTER TABLE public.price_entries
  ADD COLUMN IF NOT EXISTS has_discount BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS normal_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS final_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_type TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS promotion_description TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_condition TEXT,
  ADD COLUMN IF NOT EXISTS requires_specific_payment_method BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baes_eligibility_status TEXT;

CREATE INDEX IF NOT EXISTS idx_price_entries_has_discount ON public.price_entries(has_discount);
CREATE INDEX IF NOT EXISTS idx_price_entries_payment_method ON public.price_entries(payment_method);
