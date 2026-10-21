'use server'

import { revalidatePath } from 'next/cache'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { requireUser } from '@/lib/actions/auth-guard'
import { resolveMarketAccount } from '@/lib/markets/resolve'
import { runOrderSync, runProductSync, runSettlementSync } from '@/lib/sync/engine'

// Thin session layer over the sync engine: authenticate, resolve the
// account + adapter, delegate, then revalidate. The engine itself is
// shared with the cron route (src/lib/sync/engine.ts).

interface SyncActionResult {
  success: boolean
  syncedCount: number
  error: string | null
}

async function withAccount(
  marketAccountId: string,
  run: (args: {
    supabase: Awaited<ReturnType<typeof createRedesignClient>>
    account: NonNullable<Awaited<ReturnType<typeof resolveMarketAccount>>['resolved']>['account']
    adapter: NonNullable<Awaited<ReturnType<typeof resolveMarketAccount>>['resolved']>['adapter']
  }) => Promise<{ success: boolean; processed: number; error: string | null }>,
  paths: string[]
): Promise<SyncActionResult> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { success: false, syncedCount: 0, error: '로그인이 필요합니다.' }
  }

  const { resolved, error } = await resolveMarketAccount(marketAccountId)
  if (!resolved) return { success: false, syncedCount: 0, error }

  const outcome = await run({ supabase, account: resolved.account, adapter: resolved.adapter })
  if (outcome.success) for (const path of paths) revalidatePath(path)

  return { success: outcome.success, syncedCount: outcome.processed, error: outcome.error }
}

export async function syncProductsFromMarket(
  marketAccountId: string
): Promise<SyncActionResult> {
  return withAccount(
    marketAccountId,
    ({ supabase, account, adapter }) => runProductSync(supabase, account, adapter),
    ['/products']
  )
}

export async function syncOrdersFromMarket(
  marketAccountId: string,
  days: number = 7
): Promise<SyncActionResult> {
  return withAccount(
    marketAccountId,
    ({ supabase, account, adapter }) => runOrderSync(supabase, account, adapter, days),
    ['/orders', '/dashboard']
  )
}

export async function syncSettlementsFromMarket(
  marketAccountId: string,
  days: number = 30
): Promise<SyncActionResult> {
  return withAccount(
    marketAccountId,
    ({ supabase, account, adapter }) => runSettlementSync(supabase, account, adapter, days),
    ['/settlements']
  )
}

// ------------------------------------------------------------------
// Stock push (local → market)
// ------------------------------------------------------------------

export async function pushStockToMarket(
  listingIds: string[]
): Promise<{
  success: boolean
  results: Array<{ listingId: string; success: boolean; error?: string }>
  error: string | null
}> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { success: false, results: [], error: '로그인이 필요합니다.' }
  }

  if (listingIds.length === 0 || listingIds.length > 500) {
    return { success: false, results: [], error: '1~500건 범위로 선택해주세요.' }
  }

  const { data: listingRows } = await supabase
    .from('market_listings')
    .select('id, remote_ref, market_account_id, master_products (stock_quantity)')
    .in('id', listingIds)

  const results: Array<{ listingId: string; success: boolean; error?: string }> = []

  for (const row of (listingRows || []) as unknown as Array<{
    id: string
    remote_ref: string | null
    market_account_id: string
    master_products: { stock_quantity: number } | null
  }>) {
    if (!row.remote_ref) {
      results.push({ listingId: row.id, success: false, error: '미배포 리스팅입니다.' })
      continue
    }
    const { resolved, error } = await resolveMarketAccount(row.market_account_id)
    if (!resolved) {
      results.push({ listingId: row.id, success: false, error: error || '계정 오류' })
      continue
    }

    const stock = row.master_products?.stock_quantity ?? 0
    const pushResult = await resolved.adapter.updateStock(row.remote_ref, stock)
    if (pushResult.ok) {
      results.push({ listingId: row.id, success: true })
    } else {
      results.push({ listingId: row.id, success: false, error: pushResult.error })
    }
  }

  const successCount = results.filter((r) => r.success).length
  return {
    success: successCount > 0,
    results,
    error: successCount === 0 ? '모든 재고 반영에 실패했습니다.' : null,
  }
}
