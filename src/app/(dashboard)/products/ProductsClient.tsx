'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Header } from '@/components/layouts/Header'
import { MarketFilterChips } from '@/components/layouts/MarketFilterChips'
import { PcOnlyNotice } from '@/components/ui/pc-only-notice'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { BulkPreviewScreen } from '@/components/bulk/BulkPreviewScreen'
import { useMarketFilter, filterToAccountId } from '@/contexts/MarketFilterContext'
import { getListingReadiness } from '@/lib/actions/listings'
import { planBulkOperation, applyBulkOperation, type BulkPlan, type BulkApplyResult } from '@/lib/actions/bulk'
import { syncProductsFromMarket } from '@/lib/actions/market-sync'
import type { MarketAccountInfo } from '@/lib/actions/market-accounts'
import type { MasterProductWithListings } from '@/lib/actions/master-products'
import type { BulkOperation } from '@/lib/validation-redesign'
import type { ValidationIssue } from '@/lib/markets/types'
import { ProductListTable, type ReadinessMap } from './components/ProductListTable'
import { ProductDetailPanel } from './components/ProductDetailPanel'
import { BulkActionsDialog, type BulkKind } from './components/BulkActionsDialog'
import { MasterProductFormDialog } from './components/MasterProductFormDialog'

interface ProductsClientProps {
  initialProducts: MasterProductWithListings[]
  accounts: MarketAccountInfo[]
  loadError: string | null
}

export function ProductsClient({ initialProducts, accounts, loadError }: ProductsClientProps) {
  const router = useRouter()
  const { filter } = useMarketFilter()
  const searchRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [panelProductId, setPanelProductId] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<ReadinessMap>({ byAccount: new Map() })
  const [isSyncing, setIsSyncing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  // Bulk flow state
  const [bulkKind, setBulkKind] = useState<BulkKind>('price_adjust')
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkPlan, setBulkPlan] = useState<BulkPlan | null>(null)
  const [bulkLabel, setBulkLabel] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<BulkApplyResult | null>(null)

  useEffect(() => {
    if (loadError) toast.error(loadError)
  }, [loadError])

  const filteredProducts = useMemo(() => {
    const accountId = filterToAccountId(filter)
    return initialProducts.filter((product) => {
      if (accountId) {
        const onAccount =
          product.listings.length === 0 ||
          product.listings.some((listing) => listing.marketAccountId === accountId)
        if (!onAccount) return false
      }
      if (!searchQuery) return true
      const query = searchQuery.toLowerCase()
      return (
        product.name.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.supplierName?.toLowerCase().includes(query) ||
        product.brand?.toLowerCase().includes(query)
      )
    })
  }, [initialProducts, filter, searchQuery])

  const visibleAccounts = useMemo(() => {
    const accountId = filterToAccountId(filter)
    return accountId ? accounts.filter((account) => account.id === accountId) : accounts
  }, [accounts, filter])

  const panelProduct = useMemo(
    () => initialProducts.find((product) => product.id === panelProductId) || null,
    [initialProducts, panelProductId]
  )

  // Readiness badges: one pure-validation call per market account
  useEffect(() => {
    let cancelled = false
    async function load() {
      const productIds = initialProducts.map((product) => product.id)
      if (productIds.length === 0) return

      const byAccount = new Map<string, Map<string, ValidationIssue[]>>()
      for (const account of accounts) {
        const result = await getListingReadiness(account.id, productIds)
        if (cancelled) return
        if (result.data) {
          byAccount.set(
            account.id,
            new Map(result.data.map((entry) => [entry.masterProductId, entry.issues]))
          )
        }
      }
      if (!cancelled) setReadiness({ byAccount })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [initialProducts, accounts])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Keyboard navigation: j/k move, x select, Enter panel, / search, Esc close
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if (event.key === 'Escape') (target as HTMLInputElement).blur()
        return
      }

      switch (event.key) {
        case 'j':
          setFocusedIndex((index) => Math.min(index + 1, filteredProducts.length - 1))
          break
        case 'k':
          setFocusedIndex((index) => Math.max(index - 1, 0))
          break
        case 'x':
          if (focusedIndex >= 0 && filteredProducts[focusedIndex]) {
            toggleSelect(filteredProducts[focusedIndex].id)
          }
          break
        case 'Enter':
          if (focusedIndex >= 0 && filteredProducts[focusedIndex]) {
            setPanelProductId(filteredProducts[focusedIndex].id)
          }
          break
        case '/':
          event.preventDefault()
          searchRef.current?.focus()
          break
        case 'Escape':
          setPanelProductId(null)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filteredProducts, focusedIndex, toggleSelect])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) => {
      if (filteredProducts.every((product) => current.has(product.id))) return new Set()
      return new Set(filteredProducts.map((product) => product.id))
    })
  }, [filteredProducts])

  const handleRowClick = useCallback((index: number) => {
    setFocusedIndex(index)
    setPanelProductId((currentId) => {
      const clicked = filteredProducts[index]
      return clicked ? clicked.id : currentId
    })
  }, [filteredProducts])

  const handleSync = async () => {
    // Sync every connected account (or just the filtered one) — a seller
    // may run several stores on the same platform.
    const targets = filterToAccountId(filter)
      ? accounts.filter((account) => account.id === filter)
      : accounts
    if (targets.length === 0) {
      toast.error('연결된 마켓 계정이 없습니다. 설정에서 먼저 연결해주세요.')
      return
    }
    setIsSyncing(true)
    try {
      for (const account of targets) {
        const result = await syncProductsFromMarket(account.id)
        if (result.success) {
          toast.success(`${account.name}: ${result.syncedCount}개 상품 동기화`)
        } else {
          toast.error(`${account.name}: ${result.error || '동기화 실패'}`)
        }
      }
      router.refresh()
    } finally {
      setIsSyncing(false)
    }
  }

  const openBulkDialog = (kind: BulkKind) => {
    setBulkKind(kind)
    setBulkDialogOpen(true)
  }

  const handlePreview = async (operation: BulkOperation, label: string) => {
    setIsPlanning(true)
    try {
      const result = await planBulkOperation(operation)
      if (!result.data) {
        toast.error(result.error || '미리보기에 실패했습니다.')
        return
      }
      setBulkPlan(result.data)
      setBulkLabel(label)
      setApplyResult(null)
      setBulkDialogOpen(false)
      setPreviewOpen(true)
    } finally {
      setIsPlanning(false)
    }
  }

  const handleApply = async (included: Array<{ id: string; before: number }>) => {
    if (!bulkPlan) return
    setIsApplying(true)
    try {
      const result = await applyBulkOperation({ operation: bulkPlan.operation, expected: included })
      if (!result.data) {
        toast.error(result.error || '적용에 실패했습니다.')
        return
      }
      setApplyResult(result.data)
      setSelectedIds(new Set())
      router.refresh()
    } finally {
      setIsApplying(false)
    }
  }

  const formatBulkValue = (value: number) =>
    bulkPlan?.operation.type === 'stock_set' ? `${value.toLocaleString()}개` : `₩${value.toLocaleString()}`

  return (
    <>
      <Header title="원본상품" subtitle="Master Products" />

      <PcOnlyNotice
        reason="상품 편집과 마켓 배포는 여러 마켓을 나란히 비교해야 해서 넓은 화면이 필요합니다. 재고 확인·수정은 하단의 재고 탭에서 할 수 있습니다."
        status={[
          { label: '전체 상품', value: `${initialProducts.length}개` },
          {
            label: '재고 부족',
            value: `${initialProducts.filter((p) => p.stockQuantity <= 10).length}개`,
          },
        ]}
      />

      <div className="hidden flex-1 overflow-hidden lg:flex">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <MarketFilterChips />
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  type="search"
                  placeholder="상품명, SKU, 공급처 검색  ( / )"
                  className="h-8 pl-9 text-[13px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
                <RefreshCw className={isSyncing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
                마켓에서 동기화
              </Button>
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                상품 추가
              </Button>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
              <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openBulkDialog('price_adjust')}>
                  가격 일괄 변경
                </Button>
                <Button size="sm" variant="outline" onClick={() => openBulkDialog('stock_set')}>
                  재고 일괄 설정
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  선택 해제
                </Button>
              </div>
            </div>
          )}

          <Card className="min-h-0 flex-1 overflow-hidden py-0">
            <ResponsiveTable className="h-full overflow-auto">
              <ProductListTable
                products={filteredProducts}
                accounts={visibleAccounts}
                readiness={readiness}
                selectedIds={selectedIds}
                focusedIndex={focusedIndex}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onRowClick={handleRowClick}
              />
            </ResponsiveTable>
          </Card>
        </div>

        <aside className="w-[420px] shrink-0 border-l border-border">
          <ProductDetailPanel product={panelProduct} onClose={() => setPanelProductId(null)} />
        </aside>
      </div>

      <BulkActionsDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        kind={bulkKind}
        targetCount={selectedIds.size}
        targetIds={[...selectedIds]}
        isPlanning={isPlanning}
        onPreview={handlePreview}
      />

      <BulkPreviewScreen
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        actionLabel={bulkLabel}
        plan={bulkPlan}
        formatValue={formatBulkValue}
        isApplying={isApplying}
        applyResult={applyResult}
        onConfirm={handleApply}
      />

      <MasterProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={() => router.refresh()}
      />
    </>
  )
}
