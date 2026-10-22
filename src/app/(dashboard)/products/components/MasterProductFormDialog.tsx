'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createMasterProduct } from '@/lib/actions/master-products'

// Minimal create dialog for the master product. Rich editing (options,
// detail content, per-market overrides) lives on the listings screen.

export function MasterProductFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: '',
    basePrice: '',
    costPrice: '',
    stockQuantity: '',
    sku: '',
    brand: '',
    origin: '',
    memo: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [field]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.basePrice || Number(form.basePrice) <= 0) {
      toast.error('상품명과 0보다 큰 기준가를 입력해주세요.')
      return
    }

    setIsSaving(true)
    try {
      const result = await createMasterProduct({
        name: form.name.trim(),
        basePrice: Number(form.basePrice),
        costPrice: form.costPrice ? Number(form.costPrice) : null,
        stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : 0,
        sku: form.sku.trim() || null,
        brand: form.brand.trim() || null,
        origin: form.origin.trim() || null,
        memo: form.memo.trim() || null,
      })

      if (result.data) {
        toast.success('원본상품이 추가되었습니다.')
        setForm({ name: '', basePrice: '', costPrice: '', stockQuantity: '', sku: '', brand: '', origin: '', memo: '' })
        onOpenChange(false)
        onCreated()
      } else {
        toast.error(result.error || '추가에 실패했습니다.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>원본상품 추가</DialogTitle>
          <DialogDescription>
            마스터 정보만 입력합니다. 마켓별 이름·가격·카테고리는 배포 화면에서 재정의할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1.5">
            <Label>상품명 *</Label>
            <Input value={form.name} onChange={update('name')} placeholder="스테인리스 텀블러 500ml" />
          </div>
          <div className="space-y-1.5">
            <Label>기준가 *</Label>
            <Input type="number" inputMode="numeric" value={form.basePrice} onChange={update('basePrice')} placeholder="29900" />
          </div>
          <div className="space-y-1.5">
            <Label>원가</Label>
            <Input type="number" inputMode="numeric" value={form.costPrice} onChange={update('costPrice')} placeholder="18000" />
          </div>
          <div className="space-y-1.5">
            <Label>재고</Label>
            <Input type="number" inputMode="numeric" value={form.stockQuantity} onChange={update('stockQuantity')} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label>SKU</Label>
            <Input value={form.sku} onChange={update('sku')} placeholder="SKU-TUM-500" />
          </div>
          <div className="space-y-1.5">
            <Label>브랜드</Label>
            <Input value={form.brand} onChange={update('brand')} />
          </div>
          <div className="space-y-1.5">
            <Label>원산지</Label>
            <Input value={form.origin} onChange={update('origin')} maxLength={300} placeholder="국산(경남)" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>메모</Label>
            <Textarea rows={2} value={form.memo} onChange={update('memo')} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            추가
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
