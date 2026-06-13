-- PriceNow receipt scanning support.
-- Safe to run multiple times. Does not remove data or change existing keys.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  ocr_text text,
  sanitized_text text,
  store_name text,
  store_address text,
  purchase_date date,
  total_amount numeric(12,2),
  net_amount numeric(12,2),
  tax_amount numeric(12,2),
  payment_method text,
  payment_method_confirmed boolean DEFAULT false,
  general_discount_amount numeric(12,2),
  general_discount_note text,
  receipt_type text DEFAULT 'unknown_document',
  has_itemized_products boolean DEFAULT false,
  parser_confidence text,
  parser_version text,
  review_status text DEFAULT 'pending_review',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  line_index integer,
  original_text text NOT NULL,
  product_name text,
  suggested_product_id uuid REFERENCES public.products(id),
  suggested_product_name text,
  quantity numeric(10,3),
  unit text DEFAULT 'unidad',
  normal_price numeric(12,2),
  discount_amount numeric(12,2),
  final_price numeric(12,2),
  discount_source text,
  include_in_report boolean DEFAULT true,
  confidence text,
  is_discarded boolean DEFAULT false,
  price_entry_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS store_address text,
  ADD COLUMN IF NOT EXISTS receipt_type text DEFAULT 'unknown_document',
  ADD COLUMN IF NOT EXISTS has_itemized_products boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS parser_confidence text,
  ADD COLUMN IF NOT EXISTS parser_version text;

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS is_discarded boolean DEFAULT false;

ALTER TABLE public.price_entries
  ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.receipts(id),
  ADD COLUMN IF NOT EXISTS receipt_item_id uuid REFERENCES public.receipt_items(id),
  ADD COLUMN IF NOT EXISTS discount_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'receipt_items'
      AND constraint_name = 'receipt_items_price_entry_id_fkey'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_price_entry_id_fkey
      FOREIGN KEY (price_entry_id) REFERENCES public.price_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON public.receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON public.receipts(purchase_date);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON public.receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_price_entry_id ON public.receipt_items(price_entry_id);
CREATE INDEX IF NOT EXISTS idx_price_entries_receipt_id ON public.price_entries(receipt_id);
CREATE INDEX IF NOT EXISTS idx_price_entries_receipt_item_id ON public.price_entries(receipt_item_id);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own receipts" ON public.receipts;
CREATE POLICY "Users can view own receipts"
  ON public.receipts
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own receipts" ON public.receipts;
CREATE POLICY "Users can insert own receipts"
  ON public.receipts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own receipts" ON public.receipts;
CREATE POLICY "Users can update own receipts"
  ON public.receipts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view receipts" ON public.receipts;
CREATE POLICY "Admins can view receipts"
  ON public.receipts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'validator')
    )
  );

DROP POLICY IF EXISTS "Users can view own receipt items" ON public.receipt_items;
CREATE POLICY "Users can view own receipt items"
  ON public.receipt_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      WHERE r.id = receipt_items.receipt_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own receipt items" ON public.receipt_items;
CREATE POLICY "Users can insert own receipt items"
  ON public.receipt_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      WHERE r.id = receipt_items.receipt_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own receipt items" ON public.receipt_items;
CREATE POLICY "Users can update own receipt items"
  ON public.receipt_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      WHERE r.id = receipt_items.receipt_id
        AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      WHERE r.id = receipt_items.receipt_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view receipt items" ON public.receipt_items;
CREATE POLICY "Admins can view receipt items"
  ON public.receipt_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'validator')
    )
  );
