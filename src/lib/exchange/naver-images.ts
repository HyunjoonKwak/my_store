import 'server-only'

import sharp from 'sharp'
import type { NaverCommerceClient } from '@/lib/naver/client'
import { formatCommerceError } from '@/lib/naver/current-client'
import type { DetailImage } from './detail-package.ts'
import { ExchangeError } from './format.ts'

// Naver's image API takes JPG/GIF/PNG/BMP up to 10MB. Desk may send WebP
// and larger photos, so those are re-encoded before upload.
const NAVER_MAX_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const BATCH_SIZE = 10

interface UploadFile {
  bytes: Uint8Array
  mime: string
  name: string
}

async function toJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  return sharp(bytes, { limitInputPixels: MAX_PIXELS })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
}

async function prepare(image: DetailImage, index: number): Promise<UploadFile> {
  const base = `detail-${String(index + 1).padStart(2, '0')}`
  try {
    if (image.type !== 'webp' && image.bytes.byteLength <= NAVER_MAX_BYTES) {
      return {
        bytes: image.bytes,
        mime: image.type === 'png' ? 'image/png' : 'image/jpeg',
        name: `${base}.${image.type}`,
      }
    }
    if (image.type === 'webp') {
      const png = await sharp(image.bytes, { limitInputPixels: MAX_PIXELS }).png().toBuffer()
      if (png.byteLength <= NAVER_MAX_BYTES) return { bytes: png, mime: 'image/png', name: `${base}.png` }
    }
    const jpeg = await toJpeg(image.bytes)
    if (jpeg.byteLength > NAVER_MAX_BYTES) {
      throw new ExchangeError(`사진이 너무 커서 네이버에 올릴 수 없습니다: ${image.path}`)
    }
    return { bytes: jpeg, mime: 'image/jpeg', name: `${base}.jpg` }
  } catch (error) {
    if (error instanceof ExchangeError) throw error
    throw new ExchangeError(`사진을 변환하지 못했습니다: ${image.path}`)
  }
}

/** Uploads package images to Naver and maps each package path to its URL. */
export async function uploadDetailImages(
  client: NaverCommerceClient,
  images: DetailImage[]
): Promise<Map<string, string>> {
  const prepared: UploadFile[] = []
  for (const [index, image] of images.entries()) prepared.push(await prepare(image, index))

  const urls: string[] = []
  for (let start = 0; start < prepared.length; start += BATCH_SIZE) {
    try {
      urls.push(...(await client.uploadProductImages(prepared.slice(start, start + BATCH_SIZE))))
    } catch (error) {
      throw new ExchangeError(formatCommerceError(error, '네이버 이미지 서버에 사진을 올리지 못했습니다.'))
    }
  }
  return new Map(images.map((image, index) => [image.path, urls[index]]))
}
