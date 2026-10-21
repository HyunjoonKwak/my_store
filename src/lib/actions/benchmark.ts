'use server'

import { createClient } from '@/lib/supabase/server'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth-guard'
import type {
  BenchmarkSession,
  BenchmarkPage,
  BenchmarkMemo,
  BenchmarkChecklist,
  BenchmarkAsset,
  BenchmarkSessionStatus,
  BenchmarkAssetType,
} from '@/types/database.types'
import {
  validateInput,
  idSchema,
  createBenchmarkSessionSchema,
  updateBenchmarkSessionSchema,
  addBenchmarkPageSchema,
  updateBenchmarkPageSchema,
  deleteBenchmarkPageSchema,
  addBenchmarkMemoSchema,
  updateBenchmarkMemoSchema,
  deleteBenchmarkMemoSchema,
  addBenchmarkChecklistSchema,
  updateBenchmarkChecklistSchema,
  deleteBenchmarkChecklistSchema,
  addBenchmarkAssetSchema,
  deleteBenchmarkAssetSchema,
} from '@/lib/validation'

export interface BenchmarkSessionWithDetails extends BenchmarkSession {
  pages: BenchmarkPage[]
  memos: BenchmarkMemo[]
  checklists: BenchmarkChecklist[]
  assets: BenchmarkAsset[]
}

export interface ProductForBenchmark {
  id: string
  name: string
  imageUrl: string | null
  platformProductId: string | null
  channelProductNo: number | null
  storeName: string
  storeUrlName: string | null
}

export async function getBenchmarkSessions(): Promise<{
  data: BenchmarkSession[] | null
  error: string | null
}> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const { data, error } = await supabase
    .from('benchmark_sessions')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    return { data: null, error: error.message }
  }

  return { data: data as BenchmarkSession[], error: null }
}

export async function getBenchmarkSession(sessionId: string): Promise<{
  data: BenchmarkSessionWithDetails | null
  error: string | null
}> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(idSchema, sessionId)
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data: session, error: sessionError } = await supabase
    .from('benchmark_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userData.user.id)
    .single()

  if (sessionError) {
    return { data: null, error: sessionError.message }
  }

  const [pagesResult, memosResult, checklistsResult, assetsResult] = await Promise.all([
    supabase
      .from('benchmark_pages')
      .select('*')
      .eq('session_id', sessionId)
      .order('display_order', { ascending: true }),
    supabase
      .from('benchmark_memos')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('benchmark_checklists')
      .select('*')
      .eq('session_id', sessionId)
      .order('display_order', { ascending: true }),
    supabase
      .from('benchmark_assets')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false }),
  ])

  return {
    data: {
      ...(session as BenchmarkSession),
      pages: (pagesResult.data || []) as BenchmarkPage[],
      memos: (memosResult.data || []) as BenchmarkMemo[],
      checklists: (checklistsResult.data || []) as BenchmarkChecklist[],
      assets: (assetsResult.data || []) as BenchmarkAsset[],
    },
    error: null,
  }
}

export async function createBenchmarkSession(input: {
  title: string
  description?: string
  myProductId?: string
  myPageUrl?: string
}): Promise<{ data: BenchmarkSession | null; error: string | null }> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(createBenchmarkSessionSchema, input)
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data, error } = await supabase
    .from('benchmark_sessions')
    .insert({
      user_id: userData.user.id,
      title: input.title,
      description: input.description || null,
      my_product_id: input.myProductId || null,
      my_page_url: input.myPageUrl || null,
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  revalidatePath('/benchmarking')
  return { data: data as BenchmarkSession, error: null }
}

export async function updateBenchmarkSession(
  sessionId: string,
  input: {
    title?: string
    description?: string
    myProductId?: string
    myPageUrl?: string
    status?: BenchmarkSessionStatus
  }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(updateBenchmarkSessionSchema, { sessionId, ...input })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_sessions')
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.myProductId !== undefined && { my_product_id: input.myProductId }),
      ...(input.myPageUrl !== undefined && { my_page_url: input.myPageUrl }),
      ...(input.status !== undefined && { status: input.status }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/benchmarking')
  revalidatePath(`/benchmarking/${sessionId}`)
  return { success: true, error: null }
}

export async function deleteBenchmarkSession(sessionId: string): Promise<{
  success: boolean
  error: string | null
}> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(idSchema, sessionId)
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/benchmarking')
  return { success: true, error: null }
}

export async function addBenchmarkPage(
  sessionId: string,
  input: {
    url: string
    title?: string
    platform?: string
  }
): Promise<{ data: BenchmarkPage | null; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(addBenchmarkPageSchema, { sessionId, ...input })
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data: maxOrder } = await supabase
    .from('benchmark_pages')
    .select('display_order')
    .eq('session_id', sessionId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newOrder = (maxOrder?.display_order ?? -1) + 1

  const { data, error } = await supabase
    .from('benchmark_pages')
    .insert({
      session_id: sessionId,
      url: input.url,
      title: input.title || null,
      platform: input.platform || 'unknown',
      display_order: newOrder,
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  await supabase
    .from('benchmark_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  revalidatePath(`/benchmarking/${sessionId}`)
  return { data: data as BenchmarkPage, error: null }
}

export async function updateBenchmarkPage(
  pageId: string,
  input: {
    title?: string
    scrollPosition?: number
  }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(updateBenchmarkPageSchema, { pageId, ...input })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_pages')
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.scrollPosition !== undefined && { scroll_position: input.scrollPosition }),
    })
    .eq('id', pageId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, error: null }
}

export async function deleteBenchmarkPage(pageId: string, sessionId: string): Promise<{
  success: boolean
  error: string | null
}> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(deleteBenchmarkPageSchema, { pageId, sessionId })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_pages')
    .delete()
    .eq('id', pageId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/benchmarking/${sessionId}`)
  return { success: true, error: null }
}

export async function addBenchmarkMemo(
  sessionId: string,
  input: {
    pageId?: string
    isMyPage?: boolean
    content: string
    scrollPosition?: number
    color?: string
  }
): Promise<{ data: BenchmarkMemo | null; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(addBenchmarkMemoSchema, { sessionId, ...input })
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data, error } = await supabase
    .from('benchmark_memos')
    .insert({
      session_id: sessionId,
      page_id: input.pageId || null,
      is_my_page: input.isMyPage || false,
      content: input.content,
      scroll_position: input.scrollPosition || 0,
      color: input.color || 'yellow',
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  await supabase
    .from('benchmark_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  revalidatePath(`/benchmarking/${sessionId}`)
  return { data: data as BenchmarkMemo, error: null }
}

export async function updateBenchmarkMemo(
  memoId: string,
  input: {
    content?: string
    color?: string
  }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(updateBenchmarkMemoSchema, { memoId, ...input })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_memos')
    .update({
      ...(input.content !== undefined && { content: input.content }),
      ...(input.color !== undefined && { color: input.color }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, error: null }
}

export async function deleteBenchmarkMemo(memoId: string, sessionId: string): Promise<{
  success: boolean
  error: string | null
}> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(deleteBenchmarkMemoSchema, { memoId, sessionId })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_memos')
    .delete()
    .eq('id', memoId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/benchmarking/${sessionId}`)
  return { success: true, error: null }
}

export async function addBenchmarkChecklist(
  sessionId: string,
  input: {
    content: string
    referenceImageUrl?: string
    priority?: number
  }
): Promise<{ data: BenchmarkChecklist | null; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(addBenchmarkChecklistSchema, { sessionId, ...input })
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data: maxOrder } = await supabase
    .from('benchmark_checklists')
    .select('display_order')
    .eq('session_id', sessionId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newOrder = (maxOrder?.display_order ?? -1) + 1

  const { data, error } = await supabase
    .from('benchmark_checklists')
    .insert({
      session_id: sessionId,
      content: input.content,
      reference_image_url: input.referenceImageUrl || null,
      priority: input.priority || 0,
      display_order: newOrder,
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  await supabase
    .from('benchmark_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  revalidatePath(`/benchmarking/${sessionId}`)
  return { data: data as BenchmarkChecklist, error: null }
}

export async function updateBenchmarkChecklist(
  checklistId: string,
  input: {
    content?: string
    isCompleted?: boolean
    referenceImageUrl?: string
    priority?: number
  }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(updateBenchmarkChecklistSchema, { checklistId, ...input })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_checklists')
    .update({
      ...(input.content !== undefined && { content: input.content }),
      ...(input.isCompleted !== undefined && { is_completed: input.isCompleted }),
      ...(input.referenceImageUrl !== undefined && { reference_image_url: input.referenceImageUrl }),
      ...(input.priority !== undefined && { priority: input.priority }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklistId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, error: null }
}

export async function deleteBenchmarkChecklist(checklistId: string, sessionId: string): Promise<{
  success: boolean
  error: string | null
}> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(deleteBenchmarkChecklistSchema, { checklistId, sessionId })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_checklists')
    .delete()
    .eq('id', checklistId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/benchmarking/${sessionId}`)
  return { success: true, error: null }
}

export async function addBenchmarkAsset(
  sessionId: string,
  input: {
    pageId?: string
    assetType: BenchmarkAssetType
    url?: string
    content?: string
    filename?: string
    memo?: string
  }
): Promise<{ data: BenchmarkAsset | null; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(addBenchmarkAssetSchema, { sessionId, ...input })
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data, error } = await supabase
    .from('benchmark_assets')
    .insert({
      session_id: sessionId,
      page_id: input.pageId || null,
      asset_type: input.assetType,
      url: input.url || null,
      content: input.content || null,
      filename: input.filename || null,
      memo: input.memo || null,
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: error.message }
  }

  await supabase
    .from('benchmark_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  revalidatePath(`/benchmarking/${sessionId}`)
  return { data: data as BenchmarkAsset, error: null }
}

export async function deleteBenchmarkAsset(assetId: string, sessionId: string): Promise<{
  success: boolean
  error: string | null
}> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(deleteBenchmarkAssetSchema, { assetId, sessionId })
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('benchmark_assets')
    .delete()
    .eq('id', assetId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/benchmarking/${sessionId}`)
  return { success: true, error: null }
}

export async function getProductsForBenchmark(): Promise<{
  data: ProductForBenchmark[] | null
  error: string | null
}> {
  const supabase = await createRedesignClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  // Selectable products are master products with a Naver listing;
  // remote_ref on a naver listing is the channelProductNo
  const { data: accounts, error: accountError } = await supabase
    .from('market_accounts')
    .select('id, name')
    .eq('user_id', userData.user.id)
    .eq('platform', 'naver')

  if (accountError) return { data: null, error: accountError.message }
  if (!accounts || accounts.length === 0) return { data: [], error: null }

  const accountNames = new Map(accounts.map((a) => [a.id as string, a.name as string]))

  const { data: listings, error } = await supabase
    .from('market_listings')
    .select('master_product_id, market_account_id, remote_ref, remote_refs')
    .in('market_account_id', [...accountNames.keys()])
    .not('remote_ref', 'is', null)

  if (error) return { data: null, error: error.message }

  const listingByProduct = new Map(
    (listings || []).map((l) => [l.master_product_id as string, l])
  )
  if (listingByProduct.size === 0) return { data: [], error: null }

  const { data: products, error: productError } = await supabase
    .from('master_products')
    .select('id, name, image_url')
    .in('id', [...listingByProduct.keys()])
    .order('name', { ascending: true })

  if (productError) return { data: null, error: productError.message }

  return {
    data: (products || []).map((p) => {
      const listing = listingByProduct.get(p.id as string)!
      const refs = (listing.remote_refs || {}) as { originProductNo?: string }
      const channelProductNo = Number(listing.remote_ref)
      return {
        id: p.id as string,
        name: p.name as string,
        imageUrl: (p.image_url as string | null) ?? null,
        platformProductId: refs.originProductNo ?? null,
        channelProductNo: Number.isFinite(channelProductNo) ? channelProductNo : null,
        storeName: accountNames.get(listing.market_account_id as string) || '',
        storeUrlName: null,
      }
    }),
    error: null,
  }
}
