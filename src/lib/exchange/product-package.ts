// my_store → Desk product package (desk-product-<sku>.zip).
// Pure: the route fetches the product row and image bytes, this module
// shapes product.json and the ZIP so Desk's reader accepts it.

import { load } from 'cheerio'
import { zipSync } from 'fflate'
import {
  ExchangeError,
  MAX_ENTRIES,
  MAX_ZIP_BYTES,
  PRODUCT_FORMAT,
  packageKey,
  sniffImage,
  toKstIso,
} from './format.ts'

const MAX_TEXT = 300
const MAX_DESCRIPTION = 5000
const MAX_OPTIONS = 50

export interface ProductPackageSource {
  id: string
  sku: string | null
  name: string
  brand: string | null
  categoryText: string | null
  basePrice: number
  origin: string | null
  description: string | null
  options: Array<{ displayName: string; priceDelta: number; isActive: boolean; position: number }>
}

export interface PackageImage {
  path: string
  bytes: Uint8Array
}

function clip(value: string | null | undefined, max: number): string {
  return (value || '').trim().slice(0, max)
}

/** Product descriptions may hold HTML; the contract wants plain text. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
  const $ = load(withBreaks)
  $('script, style, noscript, template').remove()
  const text = $.root().text()
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_DESCRIPTION)
}

/**
 * Names image entries by sniffed type in the given order: images/01.jpg …
 * Formats the contract does not allow (GIF, BMP …) are left out and counted.
 */
export function nameImages(images: Uint8Array[]): { images: PackageImage[]; skipped: number } {
  const named: PackageImage[] = []
  let skipped = 0
  for (const bytes of images) {
    const type = sniffImage(bytes)
    if (!type || named.length >= MAX_ENTRIES - 1) {
      skipped++
      continue
    }
    named.push({ path: `images/${String(named.length + 1).padStart(2, '0')}.${type}`, bytes })
  }
  return { images: named, skipped }
}

export function buildProductJson(
  source: ProductPackageSource,
  images: PackageImage[],
  exportedAt: Date
): Record<string, unknown> {
  const options = [...source.options]
    .filter((option) => option.isActive)
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_OPTIONS)
    .map((option) => ({ name: clip(option.displayName, MAX_TEXT), price_delta: option.priceDelta }))

  return {
    format: PRODUCT_FORMAT,
    sku: clip(packageKey(source.sku, source.id), MAX_TEXT),
    name: clip(source.name, MAX_TEXT),
    brand: clip(source.brand, MAX_TEXT),
    category: clip(source.categoryText, MAX_TEXT),
    price: source.basePrice,
    origin: clip(source.origin, MAX_TEXT),
    description: htmlToPlainText(source.description),
    options,
    images: images.map((image) => image.path),
    exported_at: toKstIso(exportedAt),
    source: 'my_store',
  }
}

export function buildProductZip(productJson: Record<string, unknown>, images: PackageImage[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'product.json': new TextEncoder().encode(JSON.stringify(productJson, null, 2)),
  }
  // Photos are already compressed; store them as-is
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { ...files }
  for (const image of images) entries[image.path] = [image.bytes, { level: 0 }]
  const zipped = zipSync(entries, { level: 6 })
  if (zipped.byteLength > MAX_ZIP_BYTES) throw new ExchangeError('상품 ZIP이 200MB를 넘습니다.')
  return zipped
}

/** File name for the download; non-ASCII stays in filename*. */
export function productZipName(sku: string | null, productId: string): string {
  const key = packageKey(sku, productId).replace(/[^0-9A-Za-z가-힣._-]/g, '_').slice(0, 80)
  return `desk-product-${key || productId}.zip`
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
