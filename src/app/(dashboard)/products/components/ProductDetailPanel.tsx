'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ExternalLink, Package, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { PlatformBadge, REMOTE_STATUS_LABELS } from '@/components/markets/PlatformBadge'
import type { MasterProductWithListings } from '@/lib/actions/master-products'

// Right-hand detail panel of the master–detail split. Selecting a row
// updates this panel in place so list scroll and selection survive.

function formatWon(value: number | null) {
  return value === null ? '-' : `₩${value.toLocaleString('ko-KR')}`
}

export function ProductDetailPanel({
  product,
  onClose,
}: {
  product: MasterProductWithListings | null
  onClose: () => void
}) {
  if (!product) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Package className="h-8 w-8" />
        <p className="text-sm">상품을 선택하면 상세가 여기 표시됩니다</p>
        <p className="text-xs">
          <kbd className="rounded border px-1">j</kbd>/<kbd className="rounded border px-1">k</kbd>{' '}
          이동 · <kbd className="rounded border px-1">Enter</kbd> 선택
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="flex min-w-0 items-start gap-3">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={56}
              height={56}
              className="shrink-0 rounded object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted">
              <Package className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold">{product.name}</p>
            {product.sku && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.sku}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">기준가</p>
            <p className="font-medium tabular-nums">{formatWon(product.basePrice)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">원가</p>
            <p className="font-medium tabular-nums">{formatWon(product.costPrice)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">재고</p>
            <p className="font-medium tabular-nums">{product.stockQuantity.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">공급처</p>
            <p className="truncate font-medium">{product.supplierName || '-'}</p>
          </div>
          {product.brand && (
            <div>
              <p className="text-xs text-muted-foreground">브랜드</p>
              <p className="truncate font-medium">{product.brand}</p>
            </div>
          )}
          {product.origin && (
            <div>
              <p className="text-xs text-muted-foreground">원산지</p>
              <p className="truncate font-medium">{product.origin}</p>
            </div>
          )}
          {product.categoryText && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">카테고리</p>
              <p className="truncate font-medium">{product.categoryText}</p>
            </div>
          )}
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">배포 현황</p>
          {product.listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 어느 마켓에도 배포되지 않았습니다.</p>
          ) : (
            <div className="space-y-2">
              {product.listings.map((listing) => (
                <div
                  key={listing.listingId}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={listing.platform} label={listing.marketAccountName} />
                    <span className="text-sm">
                      {listing.remoteStatus
                        ? REMOTE_STATUS_LABELS[listing.remoteStatus] || listing.remoteStatus
                        : listing.status === 'draft'
                          ? '초안'
                          : listing.status}
                    </span>
                  </div>
                  {listing.priceOverride !== null && (
                    <span className="text-xs tabular-nums text-primary">
                      {formatWon(listing.priceOverride)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <Button asChild className="w-full">
          <Link href={`/products/${product.id}/listings`}>
            마켓 배포 편집
            <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
