-- 199: drop the legacy_* tables preserved by migration 100
--
-- Since 140 no application code reads these tables: settings, tracking,
-- benchmark and supplier counts moved to the redesign schema, and the
-- product sync no longer re-links suppliers from legacy_products.
--
-- Prerequisites:
--   1. Migration 140 applied (repoints benchmark_sessions.my_product_id and
--      copies legacy_delivery_trackings).
--   2. `node scripts/backup-db.mjs` taken right before applying.
--
-- No CASCADE on purpose: the tables are dropped in one statement, so their
-- foreign keys to each other are fine, but any object outside this list that
-- still depends on them makes the statement fail instead of silently losing
-- a constraint. Apply manually in the Supabase SQL editor.

DROP TABLE IF EXISTS
  public.legacy_delivery_trackings,
  public.legacy_stock_sync_logs,
  public.legacy_sync_logs,
  public.legacy_sync_history,
  public.legacy_sync_schedules,
  public.legacy_settlements,
  public.legacy_orders,
  public.legacy_products,
  public.legacy_stores;
