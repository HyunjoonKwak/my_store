import 'server-only'

import { ExchangeError, MAX_IMAGE_BYTES } from './format.ts'

// Product photos live on Naver's CDN. Only those hosts are fetched, with
// redirects refused, so a stored URL cannot point the server elsewhere.
const ALLOWED_HOST = /(^|\.)pstatic\.net$/i

function allowedUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && ALLOWED_HOST.test(url.hostname) ? url : null
  } catch {
    return null
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_IMAGE_BYTES) throw new ExchangeError('상품 사진이 20MB를 넘습니다.')
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new ExchangeError('상품 사진이 20MB를 넘습니다.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Downloads product photos in order. Photos outside the allowed hosts, or
 * that fail to download, are skipped and counted rather than failing the
 * whole package.
 */
export async function fetchProductImages(urls: string[]): Promise<{ images: Uint8Array[]; skipped: number }> {
  const images: Uint8Array[] = []
  let skipped = 0
  for (const rawUrl of urls) {
    const url = allowedUrl(rawUrl)
    if (!url) {
      skipped++
      continue
    }
    try {
      const response = await fetch(url, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        skipped++
        continue
      }
      images.push(await readCapped(response))
    } catch {
      // Includes photos over the 20MB contract limit
      skipped++
    }
  }
  return { images, skipped }
}
