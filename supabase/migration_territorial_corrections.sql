-- PriceNow territorial corrections audit.
-- Stores manual/admin decisions made from DataQuality -> territorio.

CREATE TABLE IF NOT EXISTS public.territorial_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL CHECK (source_table IN ('stores', 'price_entries')),
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('applied', 'ignored')),
  issue TEXT,
  previous_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  proposed_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  applied_values JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_territorial_corrections_source
  ON public.territorial_corrections (source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_territorial_corrections_created_at
  ON public.territorial_corrections (created_at DESC);
