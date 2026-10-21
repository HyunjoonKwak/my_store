// Hand-written types for the redesign schema (migrations 100/110).
// The Supabase project is paused, so typegen is unavailable — replace
// this file with generated types once the project is restored.
// Field lists must stay in lockstep with 100_core_schema.sql and
// 110_studio_schema.sql.

import type { SupabaseClient } from '@supabase/supabase-js'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type MarketPlatformDb = 'naver' | 'coupang'

export type ListingStatus = 'draft' | 'published' | 'paused' | 'rejected' | 'deleted'

export type OrderItemStatusDb =
  | 'New'
  | 'Ordered'
  | 'Dispatched'
  | 'Delivering'
  | 'Delivered'
  | 'Confirmed'
  | 'CancelRequested'
  | 'Cancelled'
  | 'ReturnRequested'
  | 'Returned'
  | 'ExchangeRequested'
  | 'Exchanged'

type TableShape<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export type MarketAccountRow = {
  id: string
  user_id: string
  platform: MarketPlatformDb
  name: string
  api_config: Json
  notification_webhook_url: string | null
  notification_enabled: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MasterProductRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  detail_content: string | null
  base_price: number
  cost_price: number | null
  stock_quantity: number
  sku: string | null
  brand: string | null
  category_text: string | null
  image_url: string | null
  extra_image_urls: Json
  supplier_id: string | null
  status: 'active' | 'archived'
  memo: string | null
  created_at: string
  updated_at: string
}

export type ProductOptionRow = {
  id: string
  master_product_id: string
  option_values: Json
  display_name: string
  sku: string | null
  price_delta: number
  stock_quantity: number
  position: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MarketListingRow = {
  id: string
  master_product_id: string
  market_account_id: string
  remote_ref: string | null
  remote_refs: Json
  status: ListingStatus
  remote_status: string | null
  name_override: string | null
  price_override: number | null
  category_override: string | null
  detail_content_override: string | null
  options_override: Json | null
  platform_fields: Json
  last_published_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type ListingSnapshotRow = {
  id: string
  listing_id: string
  fetched_at: string
  remote_status: string | null
  name: string | null
  price: number | null
  stock_quantity: number | null
  category: string | null
  raw: Json
}

export type OrderRow = {
  id: string
  user_id: string
  market_account_id: string
  market_order_ref: string
  ordered_at: string
  orderer_name: string | null
  orderer_tel: string | null
  receiver_name: string | null
  receiver_tel: string | null
  receiver_address: string | null
  zip_code: string | null
  delivery_memo: string | null
  total_payment_amount: number | null
  raw: Json
  created_at: string
  updated_at: string
}

export type OrderItemRow = {
  id: string
  order_id: string
  market_item_ref: string
  listing_id: string | null
  master_product_id: string | null
  product_option_id: string | null
  product_name: string
  option_name: string | null
  quantity: number
  unit_price: number | null
  total_amount: number | null
  status: OrderItemStatusDb
  market_status_raw: string | null
  shipment_id: string | null
  supplier_id: string | null
  supplier_sent_at: string | null
  supplier_order_status: 'pending' | 'sent' | 'confirmed'
  created_at: string
  updated_at: string
}

export type ShipmentRow = {
  id: string
  user_id: string
  market_account_id: string | null
  courier_code: string
  tracking_number: string
  status: 'READY' | 'IN_PROGRESS' | 'DELIVERED' | 'FAILED'
  latest_event_description: string | null
  latest_event_time: string | null
  events: Json
  registered_at: string
  delivered_at: string | null
  created_at: string
  updated_at: string
}

export type SettlementRow = {
  id: string
  market_account_id: string
  settlement_date: string
  order_count: number
  sales_amount: number
  commission_amount: number
  delivery_fee_amount: number
  discount_amount: number
  settlement_amount: number
  status: 'pending' | 'confirmed' | 'paid'
  remote_ref: string | null
  raw: Json
  created_at: string
  updated_at: string
}

export type StockLedgerRow = {
  id: string
  master_product_id: string
  product_option_id: string | null
  delta: number
  quantity_after: number
  reason: 'initial' | 'order' | 'cancel' | 'manual' | 'sync_pull' | 'sync_push' | 'adjust'
  ref_id: string | null
  note: string | null
  created_at: string
}

export type SyncScheduleRow = {
  id: string
  user_id: string
  market_account_id: string
  sync_type: 'orders' | 'products' | 'both'
  interval_minutes: number
  sync_at_minute: number | null
  sync_time: string | null
  is_enabled: boolean
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export type SyncRunRow = {
  id: string
  schedule_id: string | null
  market_account_id: string | null
  sync_type: string
  direction: 'pull' | 'push'
  status: 'running' | 'completed' | 'failed' | 'partial'
  items_processed: number
  items_failed: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export type InterviewSessionRow = {
  id: string
  user_id: string
  status: 'in_progress' | 'completed' | 'cancelled'
  context: Json
  created_at: string
  updated_at: string
}

export type InterviewGenerationRow = {
  id: string
  session_id: string
  product_name: string | null
  template_id: string | null
  output_format: 'html' | 'image' | 'both'
  html_content: string | null
  created_at: string
}

export type StudioTemplateRow = {
  id: string
  user_id: string | null
  name: string
  category: string
  description: string | null
  html_template: string
  is_default: boolean
  created_at: string
  updated_at: string
}

// Standalone parcel tracking (/tracking), user-scoped since migration 140
export type DeliveryTrackingRow = {
  id: string
  user_id: string
  carrier_id: string
  carrier_name: string
  tracking_number: string
  status: 'IN_PROGRESS' | 'DELIVERED'
  latest_event_status: string | null
  latest_event_time: string | null
  latest_event_description: string | null
  sender_name: string | null
  sender_address: string | null
  recipient_name: string | null
  recipient_address: string | null
  product_name: string | null
  memo: string | null
  events: Json
  completed_at: string | null
  created_at: string
  updated_at: string
}

// Kept from the legacy schema and reused as-is by the redesign
export type SupplierRowLite = {
  id: string
  user_id: string
  name: string
  contact_number: string | null
  contact_method: string
}

export type RedesignDatabase = {
  public: {
    Tables: {
      market_accounts: TableShape<MarketAccountRow>
      master_products: TableShape<MasterProductRow>
      product_options: TableShape<ProductOptionRow>
      market_listings: TableShape<MarketListingRow>
      listing_snapshots: TableShape<ListingSnapshotRow>
      orders: TableShape<OrderRow>
      order_items: TableShape<OrderItemRow>
      shipments: TableShape<ShipmentRow>
      settlements: TableShape<SettlementRow>
      stock_ledger: TableShape<StockLedgerRow>
      sync_schedules: TableShape<SyncScheduleRow>
      sync_runs: TableShape<SyncRunRow>
      interview_sessions: TableShape<InterviewSessionRow>
      interview_generations: TableShape<InterviewGenerationRow>
      studio_templates: TableShape<StudioTemplateRow>
      suppliers: TableShape<SupplierRowLite>
      delivery_trackings: TableShape<DeliveryTrackingRow>
    }
    Views: Record<string, never>
    Functions: {
      // Migration 140; executable by service_role only
      prune_listing_snapshots: { Args: { cutoff: string }; Returns: number }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type RedesignClient = SupabaseClient<RedesignDatabase>
