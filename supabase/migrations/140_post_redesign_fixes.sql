-- 140: post-redesign fixes found in the 2026-10-21 health check
--
-- 1. delivery_trackings — migration 100 renamed the store-scoped table to
--    legacy_delivery_trackings, leaving the /tracking page without a table.
--    Recreate it scoped by user and carry the legacy rows over.
-- 2. benchmark_sessions.my_product_id still referenced legacy_products.
--    Remap existing values to master_products through the Naver listing
--    (remote_ref = channelProductNo) and repoint the foreign key.
-- 3. listing_snapshots grows by one row per listing per product pull.
--    prune_listing_snapshots() deletes rows older than the cutoff but always
--    keeps each listing's latest snapshot (the only one the app reads).
--
-- Idempotent. Apply manually in the Supabase SQL editor (project is not
-- CLI-linked), before deploying the code that depends on it.

-- ------------------------------------------------------------
-- 1. delivery_trackings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_trackings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  carrier_id VARCHAR(50) NOT NULL,
  carrier_name VARCHAR(100) NOT NULL,
  tracking_number VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'DELIVERED')),
  latest_event_status VARCHAR(50),
  latest_event_time TIMESTAMPTZ,
  latest_event_description TEXT,
  sender_name VARCHAR(100),
  sender_address TEXT,
  recipient_name VARCHAR(100),
  recipient_address TEXT,
  product_name VARCHAR(255),
  memo TEXT,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, carrier_id, tracking_number)
);

CREATE INDEX IF NOT EXISTS idx_delivery_trackings_user
  ON public.delivery_trackings(user_id, status, created_at DESC);

ALTER TABLE public.delivery_trackings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own delivery_trackings" ON public.delivery_trackings;
CREATE POLICY "own delivery_trackings" ON public.delivery_trackings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_delivery_trackings_updated_at ON public.delivery_trackings;
CREATE TRIGGER trg_delivery_trackings_updated_at BEFORE UPDATE ON public.delivery_trackings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF to_regclass('public.legacy_delivery_trackings') IS NOT NULL THEN
    INSERT INTO public.delivery_trackings (
      user_id, carrier_id, carrier_name, tracking_number, status,
      latest_event_status, latest_event_time, latest_event_description,
      sender_name, sender_address, recipient_name, recipient_address,
      product_name, memo, events, completed_at, created_at, updated_at
    )
    SELECT
      s.user_id, d.carrier_id, d.carrier_name, d.tracking_number,
      CASE WHEN d.status = 'DELIVERED' THEN 'DELIVERED' ELSE 'IN_PROGRESS' END,
      d.latest_event_status, d.latest_event_time, d.latest_event_description,
      d.sender_name, d.sender_address, d.recipient_name, d.recipient_address,
      d.product_name, d.memo, COALESCE(d.events, '[]'::jsonb), d.completed_at,
      COALESCE(d.created_at, NOW()), COALESCE(d.updated_at, NOW())
    FROM public.legacy_delivery_trackings d
    JOIN public.legacy_stores s ON s.id = d.store_id
    ON CONFLICT (user_id, carrier_id, tracking_number) DO NOTHING;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. benchmark_sessions.my_product_id -> master_products
-- ------------------------------------------------------------
ALTER TABLE public.benchmark_sessions
  DROP CONSTRAINT IF EXISTS benchmark_sessions_my_product_id_fkey;

DO $$
BEGIN
  IF to_regclass('public.legacy_products') IS NOT NULL THEN
    UPDATE public.benchmark_sessions bs
    SET my_product_id = ml.master_product_id
    FROM public.legacy_products lp
    JOIN public.market_listings ml
      ON ml.remote_ref = lp.naver_channel_product_no::text
    WHERE bs.my_product_id = lp.id;
  END IF;
END $$;

-- Anything still pointing outside master_products cannot be mapped
UPDATE public.benchmark_sessions bs
SET my_product_id = NULL
WHERE my_product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.master_products mp WHERE mp.id = bs.my_product_id);

ALTER TABLE public.benchmark_sessions
  ADD CONSTRAINT benchmark_sessions_my_product_id_fkey
  FOREIGN KEY (my_product_id) REFERENCES public.master_products(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. listing_snapshots retention
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_fetched_at
  ON public.listing_snapshots(fetched_at);

CREATE OR REPLACE FUNCTION public.prune_listing_snapshots(cutoff TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM public.listing_snapshots s
    WHERE s.fetched_at < cutoff
      AND EXISTS (
        SELECT 1 FROM public.listing_snapshots newer
        WHERE newer.listing_id = s.listing_id
          AND newer.fetched_at > s.fetched_at
      )
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;

-- Only the cron route (service role) prunes
REVOKE ALL ON FUNCTION public.prune_listing_snapshots(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_listing_snapshots(TIMESTAMPTZ) TO service_role;
