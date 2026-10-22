-- 150: master_products.origin (원산지)
--
-- The Marketing Desk product package carries the origin
-- (marketing_desk/docs/FILE_EXCHANGE.md, product.json "origin"). Free text
-- such as "국산(경남 ○○)", up to 300 characters like the other package text.
--
-- Safe to re-run. Apply manually in the Supabase SQL editor before deploying
-- the code that reads the column.

ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS origin TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'master_products_origin_length'
      AND conrelid = 'public.master_products'::regclass
  ) THEN
    ALTER TABLE public.master_products
      ADD CONSTRAINT master_products_origin_length CHECK (char_length(origin) <= 300);
  END IF;
END $$;
