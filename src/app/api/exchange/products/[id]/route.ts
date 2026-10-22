import { NextResponse } from 'next/server'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { idSchema } from '@/lib/validation'
import { ExchangeError } from '@/lib/exchange/format'
import { fetchProductImages } from '@/lib/exchange/fetch-images'
import {
  buildProductJson,
  buildProductZip,
  contentDisposition,
  nameImages,
  productZipName,
} from '@/lib/exchange/product-package'
import type { MasterProductRow, ProductOptionRow } from '@/types/redesign.types'

// GET: download the Marketing Desk product package (FILE_EXCHANGE.md).

type ProductWithOptions = MasterProductRow & { product_options: ProductOptionRow[] }

function imageUrls(row: MasterProductRow): string[] {
  const extra = Array.isArray(row.extra_image_urls)
    ? row.extra_image_urls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : []
  return [row.image_url, ...extra].filter((url): url is string => Boolean(url))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createRedesignClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const id = idSchema.safeParse((await params).id)
  if (!id.success) return NextResponse.json({ success: false, error: '상품 ID가 올바르지 않습니다.' }, { status: 400 })

  const { data, error } = await supabase
    .from('master_products')
    .select('*, product_options (*)')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    console.error('Desk export: product lookup failed', error)
    return NextResponse.json({ success: false, error: '상품을 불러오지 못했습니다.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ success: false, error: '상품을 찾을 수 없습니다.' }, { status: 404 })

  const row = data as unknown as ProductWithOptions
  try {
    const fetched = await fetchProductImages(imageUrls(row))
    const { images, skipped } = nameImages(fetched.images)
    const json = buildProductJson(
      {
        id: row.id,
        sku: row.sku,
        name: row.name,
        brand: row.brand,
        categoryText: row.category_text,
        basePrice: row.base_price,
        origin: row.origin,
        description: row.description,
        options: (row.product_options || []).map((option) => ({
          displayName: option.display_name,
          priceDelta: option.price_delta,
          isActive: option.is_active,
          position: option.position,
        })),
      },
      images,
      new Date()
    )
    const zip = buildProductZip(json, images)
    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition(productZipName(row.sku, row.id)),
        'Cache-Control': 'no-store',
        'X-Skipped-Images': String(fetched.skipped + skipped),
      },
    })
  } catch (caught) {
    if (caught instanceof ExchangeError) {
      return NextResponse.json({ success: false, error: caught.message }, { status: 422 })
    }
    console.error('Desk export failed', caught)
    return NextResponse.json({ success: false, error: '상품 ZIP을 만들지 못했습니다.' }, { status: 500 })
  }
}
