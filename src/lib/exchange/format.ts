// Shared limits and helpers for the Marketing Desk file exchange.
// The contract lives in marketing_desk/docs/FILE_EXCHANGE.md; keep these
// numbers in step with it.

export const PRODUCT_FORMAT = 'marketing-desk/product@1'
export const DETAIL_FORMAT = 'marketing-desk/detail@1'

export const MAX_ZIP_BYTES = 200 * 1024 * 1024
export const MAX_ENTRIES = 60
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 1024 * 1024

export type ImageType = 'png' | 'jpg' | 'webp'

export class ExchangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExchangeError'
  }
}

/** Identifies an image by its leading bytes, never by its file name. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/** Package key: the SKU, or the product id when there is no SKU. */
export function packageKey(sku: string | null | undefined, productId: string): string {
  const trimmed = (sku || '').trim()
  return trimmed || productId
}

/** ISO 8601 with the +09:00 offset the contract examples use. */
export function toKstIso(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return `${kst.toISOString().slice(0, 19)}+09:00`
}
