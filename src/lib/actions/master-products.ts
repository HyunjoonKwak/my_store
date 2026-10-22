'use server'

import { revalidatePath } from 'next/cache'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { requireUser } from '@/lib/actions/auth-guard'
import { validateInput } from '@/lib/validation'
import {
  createMasterProductSchema,
  setStockSchema,
  updateMasterProductSchema,
} from '@/lib/validation-redesign'
import type {
  MarketPlatformDb,
  MasterProductRow,
  ProductOptionRow,
} from '@/types/redesign.types'

export interface ListingSummary {
  listingId: string
  marketAccountId: string
  marketAccountName: string
  platform: MarketPlatformDb
  status: string
  remoteStatus: string | null
  remoteRef: string | null
  priceOverride: number | null
  lastError: string | null
}

export interface MasterProductWithListings {
  id: string
  name: string
  basePrice: number
  costPrice: number | null
  stockQuantity: number
  sku: string | null
  brand: string | null
  categoryText: string | null
  origin: string | null
  imageUrl: string | null
  supplierId: string | null
  supplierName: string | null
  status: string
  createdAt: string
  listings: ListingSummary[]
}

interface ProductQueryRow extends MasterProductRow {
  suppliers: { name: string } | null
  market_listings: Array<{
    id: string
    market_account_id: string
    status: string
    remote_status: string | null
    remote_ref: string | null
    price_override: number | null
    last_error: string | null
    market_accounts: { name: string; platform: MarketPlatformDb } | null
  }>
}

export async function getMasterProducts(params?: {
  marketAccountId?: string
  status?: 'active' | 'archived'
}): Promise<{ data: MasterProductWithListings[] | null; error: string | null }> {
  const supabase = await createRedesignClient()
  let userId: string
  try {
    userId = (await requireUser(supabase)).id
  } catch {
    return { data: null, error: '로그인이 필요합니다.' }
  }

  const query = supabase
    .from('master_products')
    .select(
      `*,
      suppliers (name),
      market_listings (
        id, market_account_id, status, remote_status, remote_ref,
        price_override, last_error,
        market_accounts (name, platform)
      )`
    )
    .eq('user_id', userId)
    .eq('status', params?.status || 'active')
    .order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return { data: null, error: error.message }

  let rows = (data || []) as unknown as ProductQueryRow[]

  // Market filter is optional: keep products that have a listing on the
  // requested account OR no listings at all (visible as 미배포)
  if (params?.marketAccountId) {
    rows = rows.filter(
      (row) =>
        row.market_listings.length === 0 ||
        row.market_listings.some((l) => l.market_account_id === params.marketAccountId)
    )
  }

  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      basePrice: row.base_price,
      costPrice: row.cost_price,
      stockQuantity: row.stock_quantity,
      sku: row.sku,
      brand: row.brand,
      categoryText: row.category_text,
      origin: row.origin,
      imageUrl: row.image_url,
      supplierId: row.supplier_id,
      supplierName: row.suppliers?.name || null,
      status: row.status,
      createdAt: row.created_at,
      listings: row.market_listings.map((listing) => ({
        listingId: listing.id,
        marketAccountId: listing.market_account_id,
        marketAccountName: listing.market_accounts?.name || '(삭제된 계정)',
        platform: listing.market_accounts?.platform || 'naver',
        status: listing.status,
        remoteStatus: listing.remote_status,
        remoteRef: listing.remote_ref,
        priceOverride: listing.price_override,
        lastError: listing.last_error,
      })),
    })),
    error: null,
  }
}

export async function getMasterProductById(id: string): Promise<{
  data:
    | (MasterProductWithListings & {
        description: string | null
        detailContent: string | null
        memo: string | null
        options: ProductOptionRow[]
      })
    | null
  error: string | null
}> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { data: null, error: '로그인이 필요합니다.' }
  }

  const { data, error } = await supabase
    .from('master_products')
    .select(
      `*,
      suppliers (name),
      product_options (*),
      market_listings (
        id, market_account_id, status, remote_status, remote_ref,
        price_override, last_error,
        market_accounts (name, platform)
      )`
    )
    .eq('id', id)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '상품을 찾을 수 없습니다.' }

  const row = data as unknown as ProductQueryRow & { product_options: ProductOptionRow[] }

  return {
    data: {
      id: row.id,
      name: row.name,
      basePrice: row.base_price,
      costPrice: row.cost_price,
      stockQuantity: row.stock_quantity,
      sku: row.sku,
      brand: row.brand,
      categoryText: row.category_text,
      origin: row.origin,
      imageUrl: row.image_url,
      supplierId: row.supplier_id,
      supplierName: row.suppliers?.name || null,
      status: row.status,
      createdAt: row.created_at,
      description: row.description,
      detailContent: row.detail_content,
      memo: row.memo,
      options: row.product_options || [],
      listings: row.market_listings.map((listing) => ({
        listingId: listing.id,
        marketAccountId: listing.market_account_id,
        marketAccountName: listing.market_accounts?.name || '(삭제된 계정)',
        platform: listing.market_accounts?.platform || 'naver',
        status: listing.status,
        remoteStatus: listing.remote_status,
        remoteRef: listing.remote_ref,
        priceOverride: listing.price_override,
        lastError: listing.last_error,
      })),
    },
    error: null,
  }
}

export async function createMasterProduct(input: {
  name: string
  basePrice: number
  costPrice?: number | null
  stockQuantity?: number
  sku?: string | null
  brand?: string | null
  categoryText?: string | null
  origin?: string | null
  imageUrl?: string | null
  description?: string | null
  detailContent?: string | null
  supplierId?: string | null
  memo?: string | null
}): Promise<{ data: { id: string } | null; error: string | null }> {
  const supabase = await createRedesignClient()
  let userId: string
  try {
    userId = (await requireUser(supabase)).id
  } catch {
    return { data: null, error: '로그인이 필요합니다.' }
  }

  const validation = validateInput(createMasterProductSchema, input)
  if (validation.error !== null) return { data: null, error: validation.error }
  const parsed = validation.data

  const { data, error } = await supabase
    .from('master_products')
    .insert({
      user_id: userId,
      name: parsed.name,
      base_price: parsed.basePrice,
      cost_price: parsed.costPrice ?? null,
      stock_quantity: parsed.stockQuantity ?? 0,
      sku: parsed.sku || null,
      brand: parsed.brand || null,
      category_text: parsed.categoryText || null,
      origin: parsed.origin || null,
      image_url: parsed.imageUrl || null,
      description: parsed.description || null,
      detail_content: parsed.detailContent || null,
      supplier_id: parsed.supplierId || null,
      memo: parsed.memo || null,
    })
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }

  if ((parsed.stockQuantity ?? 0) > 0) {
    await supabase.from('stock_ledger').insert({
      master_product_id: data.id as string,
      delta: parsed.stockQuantity ?? 0,
      quantity_after: parsed.stockQuantity ?? 0,
      reason: 'initial',
    })
  }

  revalidatePath('/products')
  return { data: { id: data.id as string }, error: null }
}

export async function updateMasterProduct(input: {
  id: string
  name?: string
  basePrice?: number
  costPrice?: number | null
  sku?: string | null
  brand?: string | null
  categoryText?: string | null
  origin?: string | null
  imageUrl?: string | null
  description?: string | null
  detailContent?: string | null
  supplierId?: string | null
  memo?: string | null
  status?: 'active' | 'archived'
}): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: '로그인이 필요합니다.' }
  }

  const validation = validateInput(updateMasterProductSchema, input)
  if (validation.error !== null) return { success: false, error: validation.error }
  const parsed = validation.data

  const patch: Record<string, unknown> = {}
  if (parsed.name !== undefined) patch.name = parsed.name
  if (parsed.basePrice !== undefined) patch.base_price = parsed.basePrice
  if (parsed.costPrice !== undefined) patch.cost_price = parsed.costPrice
  if (parsed.sku !== undefined) patch.sku = parsed.sku
  if (parsed.brand !== undefined) patch.brand = parsed.brand
  if (parsed.categoryText !== undefined) patch.category_text = parsed.categoryText
  if (parsed.origin !== undefined) patch.origin = parsed.origin || null
  if (parsed.imageUrl !== undefined) patch.image_url = parsed.imageUrl
  if (parsed.description !== undefined) patch.description = parsed.description
  if (parsed.detailContent !== undefined) patch.detail_content = parsed.detailContent
  if (parsed.supplierId !== undefined) patch.supplier_id = parsed.supplierId
  if (parsed.memo !== undefined) patch.memo = parsed.memo
  if (parsed.status !== undefined) patch.status = parsed.status

  if (Object.keys(patch).length === 0) return { success: true, error: null }

  const { error } = await supabase.from('master_products').update(patch).eq('id', parsed.id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/products')
  return { success: true, error: null }
}

/** Stock changes go through here so every movement lands in the ledger. */
export async function setStock(input: {
  masterProductId: string
  stockQuantity: number
  note?: string
}): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: '로그인이 필요합니다.' }
  }

  const validation = validateInput(setStockSchema, input)
  if (validation.error !== null) return { success: false, error: validation.error }
  const parsed = validation.data

  const { data: current, error: fetchError } = await supabase
    .from('master_products')
    .select('stock_quantity')
    .eq('id', parsed.masterProductId)
    .maybeSingle()

  if (fetchError) return { success: false, error: fetchError.message }
  if (!current) return { success: false, error: '상품을 찾을 수 없습니다.' }

  const before = current.stock_quantity as number
  const { error } = await supabase
    .from('master_products')
    .update({ stock_quantity: parsed.stockQuantity })
    .eq('id', parsed.masterProductId)

  if (error) return { success: false, error: error.message }

  await supabase.from('stock_ledger').insert({
    master_product_id: parsed.masterProductId,
    delta: parsed.stockQuantity - before,
    quantity_after: parsed.stockQuantity,
    reason: 'manual',
    note: parsed.note || null,
  })

  revalidatePath('/products')
  return { success: true, error: null }
}

export async function deleteMasterProduct(
  id: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createRedesignClient()
  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: '로그인이 필요합니다.' }
  }

  const { error } = await supabase.from('master_products').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/products')
  return { success: true, error: null }
}
