"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Package } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layouts/Header";
import { PcOnlyNotice } from "@/components/ui/pc-only-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLATFORM_LABELS } from "@/lib/markets/labels";
import { REMOTE_STATUS_LABELS } from "@/components/markets/PlatformBadge";
import type { MarketAccountInfo } from "@/lib/actions/market-accounts";
import type { getMasterProductById } from "@/lib/actions/master-products";
import { MarketListingCard } from "./components/MarketListingCard";
import { DeskExchangeCard } from "./components/DeskExchangeCard";

type ProductDetail = NonNullable<
  Awaited<ReturnType<typeof getMasterProductById>>["data"]
>;

// Side-by-side multi-market editor: master card on the left, one card
// per connected market account. This is where the master model pays off.

export function ListingsEditorClient({
  product,
  accounts,
  loadError,
}: {
  product: ProductDetail | null;
  accounts: MarketAccountInfo[];
  loadError: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (loadError) toast.error(loadError);
  }, [loadError]);

  if (!product) {
    return (
      <>
        <Header title="마켓 배포" subtitle="Listings" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-muted-foreground">
            {loadError || "상품을 찾을 수 없습니다."}
          </p>
          <Button asChild variant="outline">
            <Link href="/products">
              <ArrowLeft className="mr-2 h-4 w-4" />
              원본상품 목록으로
            </Link>
          </Button>
        </div>
      </>
    );
  }

  const mobileStatus = [
    ...product.listings.map((listing) => ({
      label: listing.marketAccountName,
      value: listing.remoteStatus
        ? REMOTE_STATUS_LABELS[listing.remoteStatus] || listing.remoteStatus
        : "초안",
    })),
    ...accounts
      .filter(
        (account) =>
          !product.listings.some((l) => l.marketAccountId === account.id),
      )
      .map((account) => ({
        label: account.name || PLATFORM_LABELS[account.platform],
        value: "미배포",
      })),
  ];

  return (
    <>
      <Header title="마켓 배포" subtitle={product.name} />

      <PcOnlyNotice
        reason="마켓 배포 편집은 여러 마켓을 나란히 비교해야 해서 넓은 화면이 필요합니다."
        status={mobileStatus}
      />

      <div className="hidden flex-1 flex-col overflow-y-auto p-4 lg:flex">
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              원본상품 목록
            </Link>
          </Button>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex w-72 shrink-0 flex-col gap-4">
            {/* 원본상품 카드 */}
            <Card className="w-72 shrink-0">
              <CardHeader className="border-b border-border py-3">
                <CardTitle className="text-sm">원본상품</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex items-start gap-3">
                  {product.imageUrl ? (
                    <Image
                      src={product.imageUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <p className="line-clamp-3 font-medium">{product.name}</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">기준가</span>
                    <span className="font-medium tabular-nums">
                      ₩{product.basePrice.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">재고</span>
                    <span className="font-medium tabular-nums">
                      {product.stockQuantity.toLocaleString()}
                    </span>
                  </div>
                  {product.categoryText && (
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0 text-muted-foreground">
                        카테고리
                      </span>
                      <span className="truncate text-right">
                        {product.categoryText}
                      </span>
                    </div>
                  )}
                  {product.origin && (
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0 text-muted-foreground">
                        원산지
                      </span>
                      <span className="truncate text-right">
                        {product.origin}
                      </span>
                    </div>
                  )}
                  {product.sku && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">SKU</span>
                      <span className="truncate">{product.sku}</span>
                    </div>
                  )}
                </div>
                <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                  마켓 카드에서 &quot;원본 사용&quot;을 해제하면 그 마켓만의
                  값으로 재정의됩니다. 원본을 바꾸면 재정의하지 않은 마켓에 함께
                  반영됩니다.
                </p>
              </CardContent>
            </Card>

            <DeskExchangeCard
              productId={product.id}
              origin={product.origin}
              detailContent={product.detailContent}
            />
          </div>

          {/* 마켓별 카드 */}
          {accounts.length === 0 ? (
            <Card className="flex-1">
              <CardContent className="p-6 text-center text-muted-foreground">
                <p>연결된 마켓 계정이 없습니다.</p>
                <Button asChild variant="outline" className="mt-3">
                  <Link href="/settings">설정에서 마켓 연결</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            accounts.map((account) => (
              <MarketListingCard
                key={account.id}
                account={account}
                masterProductId={product.id}
                masterName={product.name}
                masterPrice={product.basePrice}
                listing={
                  product.listings.find(
                    (l) => l.marketAccountId === account.id,
                  ) || null
                }
                onChanged={() => router.refresh()}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
