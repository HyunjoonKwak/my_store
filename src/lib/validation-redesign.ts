import { z } from 'zod'
import { idSchema, nameSchema, priceSchema, quantitySchema } from '@/lib/validation'

// Zod schemas for the redesign actions (master products, listings,
// market accounts, bulk operations). Shared primitives come from
// validation.ts; this file retires with it when the legacy actions go.

export const marketPlatformSchema = z.enum(['naver', 'coupang'])

export const createMarketAccountSchema = z.object({
  platform: marketPlatformSchema,
  name: nameSchema,
})

export const updateMarketAccountSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  isActive: z.boolean().optional(),
  notificationWebhookUrl: z.string().trim().max(2000).nullable().optional(),
  notificationEnabled: z.boolean().optional(),
  apiConfig: z.record(z.string(), z.unknown()).optional(),
})

export const createMasterProductSchema = z.object({
  name: nameSchema,
  basePrice: priceSchema,
  costPrice: priceSchema.nullable().optional(),
  stockQuantity: quantitySchema.optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  brand: z.string().trim().max(200).nullable().optional(),
  categoryText: z.string().trim().max(500).nullable().optional(),
  origin: z.string().trim().max(300).nullable().optional(),
  imageUrl: z.string().trim().max(2000).nullable().optional(),
  description: z.string().max(50000).nullable().optional(),
  detailContent: z.string().max(2_000_000).nullable().optional(),
  supplierId: idSchema.nullable().optional(),
  memo: z.string().max(5000).nullable().optional(),
})

export const updateMasterProductSchema = createMasterProductSchema.partial().extend({
  id: idSchema,
  status: z.enum(['active', 'archived']).optional(),
})

export const setStockSchema = z.object({
  masterProductId: idSchema,
  stockQuantity: quantitySchema,
  note: z.string().max(500).optional(),
})

export const upsertListingSchema = z.object({
  masterProductId: idSchema,
  marketAccountId: idSchema,
  nameOverride: z.string().trim().max(200).nullable().optional(),
  priceOverride: priceSchema.nullable().optional(),
  categoryOverride: z.string().trim().max(100).nullable().optional(),
  detailContentOverride: z.string().max(2_000_000).nullable().optional(),
  platformFields: z.record(z.string(), z.unknown()).optional(),
})

export const bulkOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('price_adjust'),
    mode: z.enum(['percent', 'absolute']),
    // percent: +5 = 5% up, -10 = 10% down; absolute: set to this price
    value: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    targetIds: z.array(idSchema).min(1).max(1000),
  }),
  z.object({
    type: z.literal('stock_set'),
    value: quantitySchema,
    targetIds: z.array(idSchema).min(1).max(1000),
  }),
])

export type BulkOperation = z.infer<typeof bulkOperationSchema>

export const applyBulkSchema = z.object({
  operation: bulkOperationSchema,
  // id → expected current value; drift-checked at apply time
  expected: z.array(z.object({ id: idSchema, before: z.number().int() })).min(1).max(1000),
})
