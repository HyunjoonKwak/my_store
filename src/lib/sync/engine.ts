import 'server-only'

import { sendSyncSummaryAlert } from '@/lib/notifications/store-alerts'
import { countNewOrders } from './new-orders.ts'

import type { MarketAdapter, NormalizedOrder, RemoteListingSummary } from '@/lib/markets/types'
import type {
  MarketAccountRow,
  MarketListingRow,
  RedesignClient,
} from '@/types/redesign.types'
import {
  buildSyncRunRow,
  type SyncOutcome,
  type SyncRunOptions,
  type SyncRunRecordParams,
} from './run-row'

// Session-agnostic sync engine. Both the user-facing server actions and
// the cron route drive these: the caller supplies the Supabase client
// (session or service role), the account row and its adapter, so nothing
// here depends on cookies or revalidation.

export type { SyncOutcome, SyncRunOptions } from './run-row'

async function recordSyncRun(supabase: RedesignClient, params: SyncRunRecordParams) {
  await supabase.from('sync_runs').insert(buildSyncRunRow(params))
}

// ------------------------------------------------------------------
// Legacy supplier mapping (legacy_products preserved by migration 100)
// ------------------------------------------------------------------

interface LegacySupplierRef {
  sku: string | null
  platformProductId: string | null
  supplierId: string
}

async function loadLegacySupplierRefs(supabase: RedesignClient): Promise<LegacySupplierRef[]> {
  // legacy_products is outside the redesign schema types
  const legacyClient = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
    }
  }
  const { data, error } = await legacyClient
    .from('legacy_products')
    .select('sku, platform_product_id, supplier_id')

  if (error || !data) return []

  return (data as Array<{ sku: string | null; platform_product_id: string | null; supplier_id: string | null }>)
    .filter((row) => row.supplier_id !== null)
    .map((row) => ({
      sku: row.sku,
      platformProductId: row.platform_product_id,
      supplierId: row.supplier_id as string,
    }))
}

function findLegacySupplier(
  refs: LegacySupplierRef[],
  listing: RemoteListingSummary
): string | null {
  const originProductNo = listing.remoteRefs.originProductNo
  const byPlatformId = refs.find(
    (ref) => ref.platformProductId !== null && ref.platformProductId === originProductNo
  )
  if (byPlatformId) return byPlatformId.supplierId

  if (listing.sku) {
    const bySku = refs.find((ref) => ref.sku !== null && ref.sku === listing.sku)
    if (bySku) return bySku.supplierId
  }
  return null
}

// ------------------------------------------------------------------
// Products
// ------------------------------------------------------------------

export async function runProductSync(
  supabase: RedesignClient,
  account: MarketAccountRow,
  adapter: MarketAdapter,
  mode: 'initial' | 'refresh' = 'refresh',
  options: SyncRunOptions = {},
): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString()
  const marketAccountId = account.id
  const scheduleId = options.scheduleId ?? null
  const userId = account.user_id

  let listings: RemoteListingSummary[]
  try {
    listings = await adapter.fetchAllListings()
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : '상품 목록 조회 실패'
    await recordSyncRun(supabase, {
      marketAccountId,
      scheduleId,
      syncType: 'products',
      direction: 'pull',
      outcome: { success: false, processed: 0, failed: 0, error: message },
      startedAt,
    })
    return { success: false, processed: 0, failed: 0, error: message }
  }

  const legacyRefs = mode === 'initial' ? await loadLegacySupplierRefs(supabase) : []

  let processed = 0
  let failed = 0

  for (const remote of listings) {
    try {
      // 1. Existing listing by remote_ref?
      const { data: existingListing } = await supabase
        .from('market_listings')
        .select('id, master_product_id')
        .eq('market_account_id', marketAccountId)
        .eq('remote_ref', remote.remoteRef)
        .maybeSingle()

      let listingId: string
      if (existingListing) {
        listingId = (existingListing as unknown as MarketListingRow).id
        await supabase
          .from('market_listings')
          .update({ remote_status: remote.remoteStatus, remote_refs: remote.remoteRefs })
          .eq('id', listingId)
      } else {
        // 2. Master by SKU, or create one (initial migration path)
        let masterProductId: string | null = null
        if (remote.sku) {
          const { data: bySku } = await supabase
            .from('master_products')
            .select('id')
            .eq('user_id', userId)
            .eq('sku', remote.sku)
            .maybeSingle()
          if (bySku) masterProductId = (bySku as unknown as { id: string }).id
        }

        if (!masterProductId) {
          const { data: created, error: createError } = await supabase
            .from('master_products')
            .insert({
              user_id: userId,
              name: remote.name,
              base_price: remote.price,
              stock_quantity: remote.stockQuantity,
              sku: remote.sku || `${account.platform.toUpperCase()}-${remote.remoteRef}`,
              brand: remote.brand,
              category_text: remote.category,
              image_url: remote.imageUrl,
              supplier_id: findLegacySupplier(legacyRefs, remote),
            })
            .select('id')
            .single()

          if (createError || !created) {
            failed++
            continue
          }
          masterProductId = (created as unknown as { id: string }).id

          if (remote.stockQuantity > 0) {
            await supabase.from('stock_ledger').insert({
              master_product_id: masterProductId,
              delta: remote.stockQuantity,
              quantity_after: remote.stockQuantity,
              reason: 'initial',
              note: `${account.name} 최초 동기화`,
            })
          }
        }

        const { data: createdListing, error: listingError } = await supabase
          .from('market_listings')
          .insert({
            master_product_id: masterProductId,
            market_account_id: marketAccountId,
            remote_ref: remote.remoteRef,
            remote_refs: remote.remoteRefs,
            status: 'published',
            remote_status: remote.remoteStatus,
          })
          .select('id')
          .single()

        if (listingError || !createdListing) {
          failed++
          continue
        }
        listingId = (createdListing as unknown as { id: string }).id
      }

      // 3. Always record what the market said — never merged into local
      await supabase.from('listing_snapshots').insert({
        listing_id: listingId,
        remote_status: remote.remoteStatus,
        name: remote.name,
        price: remote.price,
        stock_quantity: remote.stockQuantity,
        category: remote.category,
        raw: JSON.parse(JSON.stringify(remote.raw ?? {})),
      })

      processed++
    } catch {
      failed++
    }
  }

  await recordSyncRun(supabase, {
    marketAccountId,
    scheduleId,
    syncType: 'products',
    direction: 'pull',
    outcome: { success: true, processed, failed, error: null },
    startedAt,
  })

  return { success: true, processed, failed, error: null }
}

// ------------------------------------------------------------------
// Orders
// ------------------------------------------------------------------

export async function runOrderSync(
  supabase: RedesignClient,
  account: MarketAccountRow,
  adapter: MarketAdapter,
  days: number = 7,
  options: SyncRunOptions = {},
): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString()
  const marketAccountId = account.id
  const scheduleId = options.scheduleId ?? null
  const userId = account.user_id

  let orders: NormalizedOrder[]
  try {
    orders = await adapter.fetchOrders({
      from: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      to: new Date(),
    })
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : '주문 조회 실패'
    await recordSyncRun(supabase, {
      marketAccountId,
      scheduleId,
      syncType: 'orders',
      direction: 'pull',
      outcome: { success: false, processed: 0, failed: 0, error: message },
      startedAt,
    })
    return { success: false, processed: 0, failed: 0, error: message }
  }

  // Snapshot known refs before upserting so the alert counts only new orders
  const fetchedRefs = orders.map((order) => order.marketOrderRef)
  const { data: knownRows } = fetchedRefs.length
    ? await supabase
        .from('orders')
        .select('market_order_ref')
        .eq('market_account_id', marketAccountId)
        .in('market_order_ref', fetchedRefs)
    : { data: [] }
  const newOrders = countNewOrders(
    fetchedRefs,
    (knownRows || []).map((row) => row.market_order_ref as string),
  )

  // Resolve listings once for item → master/supplier linking
  const { data: listingRows } = await supabase
    .from('market_listings')
    .select('id, master_product_id, remote_ref, remote_refs, master_products (supplier_id)')
    .eq('market_account_id', marketAccountId)

  const listingLookup = new Map<
    string,
    { listingId: string; masterProductId: string; supplierId: string | null }
  >()
  for (const row of (listingRows || []) as unknown as Array<{
    id: string
    master_product_id: string
    remote_ref: string | null
    remote_refs: Record<string, string> | null
    master_products: { supplier_id: string | null } | null
  }>) {
    const entry = {
      listingId: row.id,
      masterProductId: row.master_product_id,
      supplierId: row.master_products?.supplier_id || null,
    }
    if (row.remote_ref) listingLookup.set(row.remote_ref, entry)
    if (row.remote_refs?.originProductNo) listingLookup.set(row.remote_refs.originProductNo, entry)
  }

  let processed = 0
  let failed = 0

  for (const order of orders) {
    try {
      const { data: header, error: headerError } = await supabase
        .from('orders')
        .upsert(
          {
            user_id: userId,
            market_account_id: marketAccountId,
            market_order_ref: order.marketOrderRef,
            ordered_at: order.orderedAt.toISOString(),
            orderer_name: order.ordererName,
            orderer_tel: order.ordererTel,
            receiver_name: order.receiverName,
            receiver_tel: order.receiverTel,
            receiver_address: order.receiverAddress,
            zip_code: order.zipCode,
            delivery_memo: order.deliveryMemo,
            total_payment_amount: order.totalPaymentAmount,
            raw: JSON.parse(JSON.stringify(order.raw ?? {})),
          },
          { onConflict: 'market_account_id,market_order_ref' }
        )
        .select('id')
        .single()

      if (headerError || !header) {
        failed++
        continue
      }
      const orderId = (header as unknown as { id: string }).id

      for (const item of order.items) {
        const linked = item.remoteProductRef ? listingLookup.get(item.remoteProductRef) : undefined

        // Shipment first so the item can reference it
        let shipmentId: string | null = null
        if (item.trackingNumber && item.courierCode) {
          const { data: shipment } = await supabase
            .from('shipments')
            .upsert(
              {
                user_id: userId,
                market_account_id: marketAccountId,
                courier_code: item.courierCode,
                tracking_number: item.trackingNumber,
                status: item.status === 'Delivered' ? 'DELIVERED' : 'IN_PROGRESS',
              },
              { onConflict: 'user_id,courier_code,tracking_number' }
            )
            .select('id')
            .single()
          shipmentId = shipment ? (shipment as unknown as { id: string }).id : null
        }

        const { error: itemError } = await supabase.from('order_items').upsert(
          {
            order_id: orderId,
            market_item_ref: item.marketItemRef,
            listing_id: linked?.listingId || null,
            master_product_id: linked?.masterProductId || null,
            product_name: item.productName,
            option_name: item.optionName,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_amount: item.totalAmount,
            status: item.status,
            market_status_raw: item.marketStatusRaw,
            shipment_id: shipmentId,
            supplier_id: linked?.supplierId || null,
          },
          { onConflict: 'order_id,market_item_ref' }
        )

        if (itemError) failed++
      }

      processed++
    } catch {
      failed++
    }
  }

  await recordSyncRun(supabase, {
    marketAccountId,
    scheduleId,
    syncType: 'orders',
    direction: 'pull',
    outcome: { success: true, processed, failed, error: null },
    startedAt,
  })

  await notifyNewOrders(account, newOrders)

  return { success: true, processed, failed, error: null }
}

// Discord alert per settings > 알림 (market_accounts.notification_*).
// Best effort: a failed webhook never fails the sync.
async function notifyNewOrders(account: MarketAccountRow, newOrders: number): Promise<void> {
  if (newOrders === 0 || !account.notification_enabled || !account.notification_webhook_url) {
    return
  }
  const result = await sendSyncSummaryAlert({
    webhookUrl: account.notification_webhook_url,
    summary: { newOrders, cancelRequests: 0, deliveryComplete: 0 },
  })
  if (!result.success) {
    console.error('New order alert failed:', result.error)
  }
}

// ------------------------------------------------------------------
// Settlements
// ------------------------------------------------------------------

export async function runSettlementSync(
  supabase: RedesignClient,
  account: MarketAccountRow,
  adapter: MarketAdapter,
  days: number = 30,
  options: SyncRunOptions = {},
): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString()
  const marketAccountId = account.id
  const scheduleId = options.scheduleId ?? null

  let processed = 0
  try {
    const settlements = await adapter.fetchSettlements({
      from: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      to: new Date(),
    })

    for (const settlement of settlements) {
      const { error } = await supabase.from('settlements').upsert(
        {
          market_account_id: marketAccountId,
          settlement_date: settlement.settlementDate,
          order_count: settlement.orderCount,
          sales_amount: settlement.salesAmount,
          commission_amount: settlement.commissionAmount,
          delivery_fee_amount: settlement.deliveryFeeAmount,
          discount_amount: settlement.discountAmount,
          settlement_amount: settlement.settlementAmount,
          status: 'confirmed',
          remote_ref: settlement.remoteRef,
          raw: JSON.parse(JSON.stringify(settlement.raw ?? {})),
        },
        { onConflict: 'market_account_id,settlement_date' }
      )
      if (!error) processed++
    }
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : '정산 조회 실패'
    await recordSyncRun(supabase, {
      marketAccountId,
      scheduleId,
      syncType: 'settlement',
      direction: 'pull',
      outcome: { success: false, processed, failed: 0, error: message },
      startedAt,
    })
    return { success: false, processed, failed: 0, error: message }
  }

  await recordSyncRun(supabase, {
    marketAccountId,
    scheduleId,
    syncType: 'settlement',
    direction: 'pull',
    outcome: { success: true, processed, failed: 0, error: null },
    startedAt,
  })

  return { success: true, processed, failed: 0, error: null }
}
