#!/usr/bin/env node
// Dump every application table to JSON files under backups/<date>/.
// Uses the service role key from .env.local (RLS bypass), read-only.
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Current schema (100+), then legacy_* while they exist (dropped by 199;
// a missing table is reported and skipped).
const TABLES = [
  'users',
  'market_accounts',
  'master_products',
  'product_options',
  'market_listings',
  'listing_snapshots',
  'orders',
  'order_items',
  'shipments',
  'settlements',
  'stock_ledger',
  'sync_schedules',
  'sync_runs',
  'suppliers',
  'supplier_order_logs',
  'couriers',
  'delivery_trackings',
  'detail_pages',
  'saved_assets',
  'analysis_logs',
  'benchmark_sessions',
  'benchmark_pages',
  'benchmark_memos',
  'benchmark_checklists',
  'benchmark_assets',
  'interview_sessions',
  'interview_generations',
  'studio_templates',
  'user_settings',
  'ai_usage_logs',
  'legacy_stores',
  'legacy_products',
  'legacy_orders',
  'legacy_settlements',
  'legacy_sync_schedules',
  'legacy_sync_logs',
  'legacy_sync_history',
  'legacy_stock_sync_logs',
  'legacy_delivery_trackings',
]

const PAGE_SIZE = 1000

async function loadEnv(file) {
  const text = await readFile(file, 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return env
}

async function dumpTable(supabase, table, outDir) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      return { table, count: null, error: error.message }
    }
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  await writeFile(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 1))
  return { table, count: rows.length, error: null }
}

async function main() {
  const env = { ...(await loadEnv('.env').catch(() => ({}))), ...(await loadEnv('.env.local')) }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const stamp = new Date().toISOString().slice(0, 10)
  const outDir = path.join('backups', stamp)
  await mkdir(outDir, { recursive: true })

  const results = []
  for (const table of TABLES) {
    results.push(await dumpTable(supabase, table, outDir))
  }

  const summary = results
    .map((r) => (r.error ? `${r.table}: ERROR ${r.error}` : `${r.table}: ${r.count} rows`))
    .join('\n')
  await writeFile(path.join(outDir, '_summary.txt'), summary + '\n')
  console.log(summary)

  const failed = results.filter((r) => r.error && !r.error.includes('does not exist'))
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('Backup failed:', error.message)
  process.exit(1)
})
