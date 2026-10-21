import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqualString } from '@/lib/timing-safe'
import { decryptApiConfigSecrets } from '@/lib/secret-crypto'
import { createAdapter, type MarketApiConfig } from '@/lib/markets/registry'
import { runOrderSync, runProductSync } from '@/lib/sync/engine'
import { isScheduleDue } from '@/lib/sync/due'
import { listingSnapshotRetentionCutoff, syncRunRetentionCutoff } from '@/lib/sync/retention'
import type {
  MarketAccountRow,
  RedesignClient,
  SyncScheduleRow,
} from '@/types/redesign.types'

// External cron entry point. Synology's task scheduler calls this every
// few minutes; the route decides which schedules are due and runs them
// with the service role. Replaces the former in-process node-cron,
// which never started under the standalone server.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

function getAdminClient(): RedesignClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role is not configured')
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as RedesignClient
}

interface ScheduleWithAccount extends SyncScheduleRow {
  market_accounts: MarketAccountRow | null
}

export async function GET(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  const authHeader = request.headers.get('authorization')
  if (!timingSafeEqualString(authHeader ?? '', `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  // ?force=1 runs every enabled schedule regardless of due time
  const force = url.searchParams.get('force') === '1'

  let supabase: RedesignClient
  try {
    supabase = getAdminClient()
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'admin client failed' },
      { status: 503 }
    )
  }

  const { data, error } = await supabase
    .from('sync_schedules')
    .select('*, market_accounts (*)')
    .eq('is_enabled', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const schedules = (data || []) as unknown as ScheduleWithAccount[]
  const now = new Date()
  const results: Array<Record<string, unknown>> = []

  for (const schedule of schedules) {
    const account = schedule.market_accounts
    if (!account || !account.is_active) {
      results.push({ scheduleId: schedule.id, skipped: 'inactive account' })
      continue
    }
    if (!force && !isScheduleDue(schedule, { now })) {
      results.push({ scheduleId: schedule.id, account: account.name, skipped: 'not due' })
      continue
    }

    let config: MarketApiConfig
    try {
      config = decryptApiConfigSecrets((account.api_config || {}) as MarketApiConfig)
    } catch {
      results.push({ scheduleId: schedule.id, account: account.name, error: '자격증명 복호화 실패' })
      continue
    }

    const { adapter, error: adapterError } = createAdapter(account.platform, config)
    if (!adapter) {
      results.push({ scheduleId: schedule.id, account: account.name, error: adapterError })
      continue
    }

    const ran: Record<string, unknown> = { scheduleId: schedule.id, account: account.name }

    if (schedule.sync_type === 'orders' || schedule.sync_type === 'both') {
      const outcome = await runOrderSync(supabase, account, adapter, 7, {
        scheduleId: schedule.id,
      })
      ran.orders = { processed: outcome.processed, failed: outcome.failed, error: outcome.error }
    }
    if (schedule.sync_type === 'products' || schedule.sync_type === 'both') {
      const outcome = await runProductSync(supabase, account, adapter, {
        scheduleId: schedule.id,
      })
      ran.products = { processed: outcome.processed, failed: outcome.failed, error: outcome.error }
    }

    // Stamp the run even on failure so a broken account cannot spin the
    // cron on every tick; sync_runs holds the error detail.
    await supabase
      .from('sync_schedules')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', schedule.id)

    results.push(ran)
  }

  // Prune old run history on every tick. The delete is bounded by the
  // started_at index (migration 130) and is a no-op most of the time, so it
  // is cheaper than a separate scheduler entry. Never fails the sync.
  // count-only so a large backlog is not serialised back over HTTP.
  let pruned: number | null = null
  const { count, error: pruneError } = await supabase
    .from('sync_runs')
    .delete({ count: 'exact' })
    .lt('started_at', syncRunRetentionCutoff(now))
  if (pruneError) {
    console.error('sync_runs retention prune failed:', pruneError.message)
  } else {
    pruned = count
  }

  // Same idea for listing_snapshots; the SQL function (migration 140) keeps
  // each listing's latest snapshot regardless of age.
  let prunedSnapshots: number | null = null
  const { data: snapshotCount, error: snapshotPruneError } = await supabase.rpc(
    'prune_listing_snapshots',
    { cutoff: listingSnapshotRetentionCutoff(now) },
  )
  if (snapshotPruneError) {
    console.error('listing_snapshots retention prune failed:', snapshotPruneError.message)
  } else {
    prunedSnapshots = snapshotCount
  }

  return NextResponse.json({
    ok: true,
    checkedAt: now.toISOString(),
    prunedRuns: pruned,
    prunedSnapshots,
    scheduleCount: schedules.length,
    executed: results.filter((r) => !r.skipped).length,
    results,
  })
}
