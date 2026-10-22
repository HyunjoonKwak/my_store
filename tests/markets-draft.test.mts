import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildListingDraft, listOverriddenFields } from '../src/lib/markets/draft.ts'
import type {
  MarketListingRow,
  MasterProductRow,
  ProductOptionRow,
} from '../src/types/redesign.types.ts'

function master(overrides: Partial<MasterProductRow> = {}): MasterProductRow {
  return {
    id: 'mp-1',
    user_id: 'u-1',
    name: '텀블러 500ml',
    description: null,
    detail_content: '<p>마스터 상세</p>',
    base_price: 29900,
    cost_price: 18000,
    stock_quantity: 48,
    sku: 'SKU-1',
    brand: '마이브랜드',
    category_text: '주방>텀블러',
    origin: null,
    image_url: 'https://example.com/img.jpg',
    extra_image_urls: [],
    supplier_id: null,
    status: 'active',
    memo: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function listing(overrides: Partial<MarketListingRow> = {}): Pick<
  MarketListingRow,
  | 'name_override'
  | 'price_override'
  | 'category_override'
  | 'detail_content_override'
  | 'options_override'
  | 'platform_fields'
> {
  return {
    name_override: null,
    price_override: null,
    category_override: null,
    detail_content_override: null,
    options_override: null,
    platform_fields: {},
    ...overrides,
  }
}

function option(overrides: Partial<ProductOptionRow> = {}): ProductOptionRow {
  return {
    id: 'opt-1',
    master_product_id: 'mp-1',
    option_values: {},
    display_name: '블랙',
    sku: null,
    price_delta: 0,
    stock_quantity: 5,
    position: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

test('NULL overrides inherit every master value', () => {
  const draft = buildListingDraft(master(), [], listing())
  assert.equal(draft.name, '텀블러 500ml')
  assert.equal(draft.price, 29900)
  assert.equal(draft.stockQuantity, 48)
  assert.equal(draft.detailContent, '<p>마스터 상세</p>')
  assert.equal(draft.categoryId, null) // category has no master equivalent
})

test('set overrides win over master values', () => {
  const draft = buildListingDraft(
    master(),
    [],
    listing({
      name_override: '마켓 전용 이름',
      price_override: 31900,
      category_override: '50002451',
      detail_content_override: '<p>마켓 상세</p>',
    })
  )
  assert.equal(draft.name, '마켓 전용 이름')
  assert.equal(draft.price, 31900)
  assert.equal(draft.categoryId, '50002451')
  assert.equal(draft.detailContent, '<p>마켓 상세</p>')
})

test('no listing at all behaves like all-NULL overrides', () => {
  const draft = buildListingDraft(master(), [], null)
  assert.equal(draft.name, '텀블러 500ml')
  assert.equal(draft.price, 29900)
})

test('option products derive stock from active option sum, ordered by position', () => {
  const draft = buildListingDraft(
    master({ stock_quantity: 999 }),
    [
      option({ id: 'b', display_name: '화이트', stock_quantity: 3, position: 1 }),
      option({ id: 'a', display_name: '블랙', stock_quantity: 5, position: 0 }),
      option({ id: 'c', display_name: '단종', stock_quantity: 100, is_active: false, position: 2 }),
    ],
    null
  )
  // inactive option excluded; master-level stock ignored when options exist
  assert.equal(draft.stockQuantity, 8)
  assert.deepEqual(
    draft.options.map((o) => o.displayName),
    ['블랙', '화이트']
  )
})

test('listOverriddenFields reports exactly the non-NULL overrides', () => {
  assert.deepEqual(listOverriddenFields(listing()), [])
  assert.deepEqual(
    listOverriddenFields(listing({ price_override: 100, options_override: [] })),
    ['price', 'options']
  )
})
