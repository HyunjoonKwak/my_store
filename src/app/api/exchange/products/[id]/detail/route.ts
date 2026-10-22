import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { getCurrentNaverClient } from '@/lib/naver/current-client'
import { idSchema } from '@/lib/validation'
import { ExchangeError, MAX_ZIP_BYTES, packageKey } from '@/lib/exchange/format'
import { readDetailPackage } from '@/lib/exchange/detail-package'
import { referencedImages, toNaverDetailContent, validateDetailHtml } from '@/lib/exchange/detail-html'
import { uploadDetailImages } from '@/lib/exchange/naver-images'

// POST (multipart: file, confirmSku?): import a Marketing Desk detail
// package into master_products.detail_content. Images go to Naver's image
// server first because detailContent must reference Naver-hosted URLs.
// This path is excluded from the proxy matcher (src/proxy.ts) so ZIPs over
// the proxy's 10MB body buffer arrive intact; auth is checked here first.

const MAX_DETAIL_CONTENT = 2_000_000
const MULTIPART_OVERHEAD = 64 * 1024

// One import at a time for the whole server: each one may hold a 200MB
// upload in memory and uploads images to Naver.
let importing = false

function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createRedesignClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(401, '로그인이 필요합니다.')

  const id = idSchema.safeParse((await params).id)
  if (!id.success) return fail(400, '상품 ID가 올바르지 않습니다.')

  // Content-Length is required so the body size is known before buffering
  const declared = Number(request.headers.get('content-length'))
  if (!Number.isFinite(declared) || declared <= 0) return fail(411, '업로드 크기를 확인할 수 없습니다.')
  if (declared > MAX_ZIP_BYTES + MULTIPART_OVERHEAD) return fail(413, 'ZIP은 200MB 이하여야 합니다.')

  if (importing) return fail(429, '다른 상세페이지를 가져오는 중입니다. 끝난 뒤 다시 시도해주세요.')
  importing = true
  try {
    const { data: product, error: productError } = await supabase
      .from('master_products')
      .select('id, sku, detail_content')
      .eq('id', id.data)
      .eq('user_id', user.id)
      .maybeSingle()
    if (productError) {
      console.error('Desk import: product lookup failed', productError)
      return fail(500, '상품을 불러오지 못했습니다.')
    }
    if (!product) return fail(404, '상품을 찾을 수 없습니다.')

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return fail(400, 'ZIP 파일을 선택해주세요.')
    if (file.size > MAX_ZIP_BYTES) return fail(413, 'ZIP은 200MB 이하여야 합니다.')

    const pkg = readDetailPackage(new Uint8Array(await file.arrayBuffer()))
    const listed = new Set(pkg.manifest.images)
    validateDetailHtml(pkg.html, listed)

    const expectedKey = packageKey(product.sku as string | null, product.id as string)
    const manifestKey = pkg.manifest.sku.trim()
    if (
      manifestKey &&
      manifestKey.toLowerCase() !== expectedKey.toLowerCase() &&
      form?.get('confirmSku') !== '1'
    ) {
      return fail(409, '다른 상품의 상세페이지일 수 있습니다.', {
        code: 'sku_mismatch',
        manifestSku: manifestKey,
        productSku: expectedKey,
      })
    }

    const used = new Set(referencedImages(pkg.html))
    const images = pkg.images.filter((image) => used.has(image.path))

    // Convert once with placeholder URLs so a page that cannot be saved
    // fails before any image reaches Naver.
    const placeholders = new Map(
      images.map((image, index) => [image.path, `https://shop-phinf.pstatic.net/placeholder/${index}.png`])
    )
    const trial = toNaverDetailContent(pkg.html, placeholders)
    if (trial.length > MAX_DETAIL_CONTENT) return fail(422, '변환한 상세페이지가 너무 깁니다.')

    const { client, error: clientError } = await getCurrentNaverClient()
    if (!client) return fail(400, clientError || '네이버 커머스 API 설정이 필요합니다.')

    const urls = await uploadDetailImages(client, images)
    const detailContent = toNaverDetailContent(pkg.html, urls)
    if (detailContent.length > MAX_DETAIL_CONTENT) return fail(422, '변환한 상세페이지가 너무 깁니다.')

    const { error: updateError } = await supabase
      .from('master_products')
      .update({ detail_content: detailContent })
      .eq('id', product.id as string)
      .eq('user_id', user.id)
    if (updateError) {
      console.error('Desk import: save failed', updateError)
      return fail(500, '상세페이지를 저장하지 못했습니다.')
    }

    revalidatePath('/products')
    revalidatePath(`/products/${product.id}/listings`)
    return NextResponse.json({
      success: true,
      data: {
        kind: pkg.manifest.kind,
        imageCount: images.length,
        replaced: Boolean(product.detail_content),
      },
    })
  } catch (caught) {
    if (caught instanceof ExchangeError) return fail(422, caught.message)
    console.error('Desk import failed', caught)
    return fail(500, '상세페이지를 가져오지 못했습니다.')
  } finally {
    importing = false
  }
}
