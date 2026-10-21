'use server'

import { createClient } from '@/lib/supabase/server'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { revalidatePath } from 'next/cache'
import type { ContactMethod } from '@/types/database.types'
import { parseError, formatErrorMessage } from '@/lib/error-messages'
import { requireUser } from '@/lib/actions/auth-guard'
import {
  validateInput,
  idSchema,
  createSupplierSchema,
  updateSupplierSchema,
} from '@/lib/validation'

export interface SupplierWithStats {
  id: string
  name: string
  contactNumber: string | null
  contactMethod: ContactMethod
  webhookUrl: string | null
  messageTemplate: string | null
  sendScheduleTime: string | null
  sendScheduleEnabled: boolean
  autoSendEnabled: boolean
  courierId: string | null
  defaultCourierAccount: string | null
  productCount: number
  lastOrderDate: string | null
  createdAt: string
}

interface SupplierRow {
  id: string
  name: string
  contact_number: string | null
  contact_method: string
  webhook_url: string | null
  message_template: string | null
  send_schedule_time: string | null
  send_schedule_enabled: boolean
  auto_send_enabled: boolean
  courier_id: string | null
  default_courier_account: string | null
  created_at: string
}

export async function getSuppliers(): Promise<{ data: SupplierWithStats[] | null; error: string | null }> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return { data: null, error: formatErrorMessage(parseError(error, 'supplier', 'fetch')) }
  }

  const typedSuppliers = suppliers as unknown as SupplierRow[]

  // master_products carries supplier_id since the market-neutral redesign
  const redesign = await createRedesignClient()
  const { data: productCounts } = await redesign
    .from('master_products')
    .select('supplier_id')
    .in('supplier_id', typedSuppliers.map((s) => s.id))

  const countMap = new Map<string, number>()
  ;(productCounts || []).forEach((p) => {
    const supplierId = (p as { supplier_id: string | null }).supplier_id
    if (supplierId) {
      countMap.set(supplierId, (countMap.get(supplierId) || 0) + 1)
    }
  })

  const transformedSuppliers: SupplierWithStats[] = typedSuppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    contactNumber: supplier.contact_number,
    contactMethod: supplier.contact_method as ContactMethod,
    webhookUrl: supplier.webhook_url,
    messageTemplate: supplier.message_template,
    sendScheduleTime: supplier.send_schedule_time,
    sendScheduleEnabled: supplier.send_schedule_enabled ?? false,
    autoSendEnabled: supplier.auto_send_enabled ?? false,
    courierId: supplier.courier_id,
    defaultCourierAccount: supplier.default_courier_account,
    productCount: countMap.get(supplier.id) || 0,
    lastOrderDate: null,
    createdAt: supplier.created_at,
  }))

  return { data: transformedSuppliers, error: null }
}

interface CreateSupplierInput {
  name: string
  contactNumber?: string
  contactMethod: ContactMethod
  webhookUrl?: string
}

export async function createSupplier(
  input: CreateSupplierInput
): Promise<{ data: SupplierWithStats | null; error: string | null }> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const validation = validateInput(createSupplierSchema, input)
  if (validation.error !== null) {
    return { data: null, error: validation.error }
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      user_id: userData.user.id,
      name: input.name,
      contact_number: input.contactNumber || null,
      contact_method: input.contactMethod,
      webhook_url: input.webhookUrl || null,
    })
    .select()
    .single()

  if (error) {
    return { data: null, error: formatErrorMessage(parseError(error, 'supplier', 'create')) }
  }

  const typedData = data as unknown as SupplierRow

  revalidatePath('/suppliers')

  return {
    data: {
      id: typedData.id,
      name: typedData.name,
      contactNumber: typedData.contact_number,
      contactMethod: typedData.contact_method as ContactMethod,
      webhookUrl: typedData.webhook_url,
      messageTemplate: typedData.message_template,
      sendScheduleTime: typedData.send_schedule_time,
      sendScheduleEnabled: typedData.send_schedule_enabled ?? false,
      autoSendEnabled: typedData.auto_send_enabled ?? false,
      courierId: typedData.courier_id,
      defaultCourierAccount: typedData.default_courier_account,
      productCount: 0,
      lastOrderDate: null,
      createdAt: typedData.created_at,
    },
    error: null,
  }
}

interface UpdateSupplierInput {
  id: string
  name?: string
  contactNumber?: string
  contactMethod?: ContactMethod
  webhookUrl?: string | null
  messageTemplate?: string | null
  sendScheduleTime?: string | null
  sendScheduleEnabled?: boolean
  autoSendEnabled?: boolean
  courierId?: string | null
  defaultCourierAccount?: string | null
}

export async function updateSupplier(
  input: UpdateSupplierInput
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(updateSupplierSchema, input)
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const updateData: Record<string, string | boolean | null> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.contactNumber !== undefined) updateData.contact_number = input.contactNumber
  if (input.contactMethod !== undefined) updateData.contact_method = input.contactMethod
  if (input.webhookUrl !== undefined) updateData.webhook_url = input.webhookUrl
  if (input.messageTemplate !== undefined) updateData.message_template = input.messageTemplate
  if (input.sendScheduleTime !== undefined) updateData.send_schedule_time = input.sendScheduleTime
  if (input.sendScheduleEnabled !== undefined) updateData.send_schedule_enabled = input.sendScheduleEnabled
  if (input.autoSendEnabled !== undefined) updateData.auto_send_enabled = input.autoSendEnabled
  if (input.courierId !== undefined) updateData.courier_id = input.courierId
  if (input.defaultCourierAccount !== undefined) updateData.default_courier_account = input.defaultCourierAccount

  const { error } = await supabase
    .from('suppliers')
    .update(updateData)
    .eq('id', input.id)

  if (error) {
    return { success: false, error: formatErrorMessage(parseError(error, 'supplier', 'update')) }
  }

  revalidatePath('/suppliers')
  return { success: true, error: null }
}

export async function deleteSupplier(
  id: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()

  try {
    await requireUser(supabase)
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const validation = validateInput(idSchema, id)
  if (validation.error !== null) {
    return { success: false, error: validation.error }
  }

  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id)

  if (error) {
    return { success: false, error: formatErrorMessage(parseError(error, 'supplier', 'delete')) }
  }

  revalidatePath('/suppliers')
  return { success: true, error: null }
}

export interface SupplierSimple {
  id: string
  name: string
  contactNumber: string | null
  contactMethod: ContactMethod
}

export async function getSuppliersSimple(): Promise<{ data: SupplierSimple[] | null; error: string | null }> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('id, name, contact_number, contact_method')
    .eq('user_id', userData.user.id)
    .order('name', { ascending: true })

  if (error) {
    return { data: null, error: formatErrorMessage(parseError(error, 'supplier', 'fetch')) }
  }

  const typedSuppliers = suppliers as unknown as SupplierRow[]

  return {
    data: typedSuppliers.map((s) => ({
      id: s.id,
      name: s.name,
      contactNumber: s.contact_number,
      contactMethod: s.contact_method as ContactMethod,
    })),
    error: null,
  }
}
