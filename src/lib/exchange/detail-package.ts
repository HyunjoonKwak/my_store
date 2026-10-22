// Desk → my_store detail package reader (detail-<sku>-<time>.zip).
// Everything inside the ZIP is untrusted: only the listed layout is
// accepted, sizes are capped before and after inflating, and images are
// checked by content.

import { unzipSync } from 'fflate'
import { z } from 'zod'
import {
  DETAIL_FORMAT,
  ExchangeError,
  MAX_DOCUMENT_BYTES,
  MAX_ENTRIES,
  MAX_IMAGE_BYTES,
  MAX_ZIP_BYTES,
  sniffImage,
  type ImageType,
} from './format.ts'

export const DETAIL_IMAGE_PATTERN = /^images\/[0-9]{2}\.(png|jpe?g|webp)$/

const manifestSchema = z.object({
  format: z.literal(DETAIL_FORMAT),
  sku: z.string().max(300).optional().default(''),
  product_name: z.string().max(300).optional().default(''),
  kind: z.enum(['template', 'sections']),
  template: z.string().max(300).optional().default(''),
  html: z.literal('detail.html'),
  images: z.array(z.string().regex(DETAIL_IMAGE_PATTERN)).max(MAX_ENTRIES),
  created_at: z.string().max(300).optional().default(''),
  source: z.string().max(300).optional().default(''),
})

export type DetailManifest = z.infer<typeof manifestSchema>

export interface DetailImage {
  path: string
  type: ImageType
  bytes: Uint8Array
}

export interface DetailPackage {
  manifest: DetailManifest
  html: string
  images: DetailImage[]
}

function entryLimit(name: string): number {
  if (name === 'manifest.json' || name === 'detail.html') return MAX_DOCUMENT_BYTES
  if (DETAIL_IMAGE_PATTERN.test(name)) return MAX_IMAGE_BYTES
  throw new ExchangeError(`허용되지 않은 파일이 들어 있습니다: ${name.slice(0, 80)}`)
}

function unzipChecked(zip: Uint8Array): Record<string, Uint8Array> {
  if (zip.byteLength > MAX_ZIP_BYTES) throw new ExchangeError('ZIP은 200MB 이하여야 합니다.')

  const seen = new Set<string>()
  let declaredTotal = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip, {
      filter: (file) => {
        if (seen.has(file.name)) throw new ExchangeError('같은 이름의 파일이 두 번 들어 있습니다.')
        seen.add(file.name)
        if (seen.size > MAX_ENTRIES) throw new ExchangeError('ZIP 안의 파일이 60개를 넘습니다.')
        if (file.name === 'images/') return false
        if (file.originalSize > entryLimit(file.name)) {
          throw new ExchangeError(`파일이 너무 큽니다: ${file.name}`)
        }
        declaredTotal += file.originalSize
        if (declaredTotal > MAX_ZIP_BYTES) throw new ExchangeError('압축을 푼 크기가 200MB를 넘습니다.')
        return true
      },
    })
  } catch (error) {
    if (error instanceof ExchangeError) throw error
    throw new ExchangeError('ZIP 파일을 읽지 못했습니다.')
  }

  // Declared sizes can lie; check what actually came out.
  for (const [name, bytes] of Object.entries(files)) {
    if (bytes.byteLength > entryLimit(name)) throw new ExchangeError(`파일이 너무 큽니다: ${name}`)
  }
  return files
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ExchangeError(`${label}이(가) UTF-8 텍스트가 아닙니다.`)
  }
}

function parseManifest(bytes: Uint8Array | undefined): DetailManifest {
  if (!bytes) throw new ExchangeError('manifest.json이 없습니다. Marketing Desk에서 내보낸 상세페이지 ZIP인지 확인해주세요.')
  let raw: unknown
  try {
    raw = JSON.parse(decodeUtf8(bytes, 'manifest.json'))
  } catch (error) {
    if (error instanceof ExchangeError) throw error
    throw new ExchangeError('manifest.json을 읽지 못했습니다.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExchangeError('manifest.json 형식이 올바르지 않습니다.')
  }
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    const format = (raw as { format?: unknown }).format
    if (format !== DETAIL_FORMAT) {
      throw new ExchangeError(`지원하지 않는 형식입니다(${String(format).slice(0, 60)}). ${DETAIL_FORMAT}만 가져올 수 있습니다.`)
    }
    throw new ExchangeError('manifest.json의 필드가 계약과 다릅니다.')
  }
  return parsed.data
}

export function readDetailPackage(zip: Uint8Array): DetailPackage {
  const files = unzipChecked(zip)
  const manifest = parseManifest(files['manifest.json'])

  const htmlBytes = files['detail.html']
  if (!htmlBytes) throw new ExchangeError('detail.html이 없습니다.')
  const html = decodeUtf8(htmlBytes, 'detail.html')

  const listed = [...new Set(manifest.images)]
  const images = listed.map((path) => {
    const bytes = files[path]
    if (!bytes) throw new ExchangeError(`manifest에 적힌 사진이 ZIP에 없습니다: ${path}`)
    const type = sniffImage(bytes)
    if (!type) throw new ExchangeError(`PNG, JPEG, WebP 사진만 가져올 수 있습니다: ${path}`)
    return { path, type, bytes }
  })

  return { manifest, html, images }
}
