'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { updateMasterProduct } from '@/lib/actions/master-products'

// Marketing Desk exchange (marketing_desk/docs/FILE_EXCHANGE.md): the user
// downloads a product ZIP for Desk and uploads Desk's detail-page ZIP back.

interface ImportResponse {
  success: boolean
  error?: string
  code?: string
  manifestSku?: string
  productSku?: string
  data?: { kind: string; imageCount: number; replaced: boolean }
}

type PendingConfirm =
  | { reason: 'overwrite'; file: File }
  | { reason: 'sku'; file: File; manifestSku: string; productSku: string }

function fileNameFrom(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  if (!encoded) return fallback
  try {
    return decodeURIComponent(encoded)
  } catch {
    return fallback
  }
}

export function DeskExchangeCard({
  productId,
  origin,
  detailContent,
}: {
  productId: string
  origin: string | null
  detailContent: string | null
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [originValue, setOriginValue] = useState(origin || '')
  const [isSavingOrigin, setIsSavingOrigin] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const saveOrigin = async () => {
    setIsSavingOrigin(true)
    try {
      const result = await updateMasterProduct({ id: productId, origin: originValue.trim() || null })
      if (result.success) {
        toast.success('원산지를 저장했습니다.')
        router.refresh()
      } else {
        toast.error(result.error || '원산지를 저장하지 못했습니다.')
      }
    } finally {
      setIsSavingOrigin(false)
    }
  }

  const exportProduct = async () => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/exchange/products/${productId}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        toast.error(body?.error || '상품 ZIP을 만들지 못했습니다.')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileNameFrom(response.headers.get('content-disposition'), 'desk-product.zip')
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      const skipped = Number(response.headers.get('x-skipped-images') || 0)
      toast.success(
        skipped > 0
          ? `상품 ZIP을 내려받았습니다. 사진 ${skipped}장은 형식이나 위치 때문에 빠졌습니다.`
          : '상품 ZIP을 내려받았습니다. Marketing Desk의 "상품 불러오기"로 여세요.'
      )
    } catch {
      toast.error('상품 ZIP을 내려받지 못했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  const importDetail = async (file: File, confirmSku = false) => {
    setIsImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (confirmSku) form.append('confirmSku', '1')
      const response = await fetch(`/api/exchange/products/${productId}/detail`, {
        method: 'POST',
        body: form,
      })
      const body = (await response.json().catch(() => null)) as ImportResponse | null
      if (body?.code === 'sku_mismatch') {
        setPending({
          reason: 'sku',
          file,
          manifestSku: body.manifestSku || '',
          productSku: body.productSku || '',
        })
        return
      }
      if (!response.ok || !body?.success) {
        toast.error(body?.error || '상세페이지를 가져오지 못했습니다.')
        return
      }
      toast.success(`상세페이지를 가져왔습니다(사진 ${body.data?.imageCount ?? 0}장 업로드).`)
      router.refresh()
    } catch {
      toast.error('상세페이지 ZIP을 올리지 못했습니다.')
    } finally {
      setIsImporting(false)
    }
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (detailContent) setPending({ reason: 'overwrite', file })
    else void importDetail(file)
  }

  const confirmPending = () => {
    if (!pending) return
    const { file, reason } = pending
    setPending(null)
    void importDetail(file, reason === 'sku')
  }

  return (
    <Card className="w-72 shrink-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Marketing Desk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="desk-origin">원산지</Label>
          <div className="flex gap-2">
            <Input
              id="desk-origin"
              value={originValue}
              maxLength={300}
              placeholder="국산(경남 ○○)"
              onChange={(event) => setOriginValue(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={saveOrigin}
              disabled={isSavingOrigin || originValue.trim() === (origin || '')}
            >
              {isSavingOrigin ? <Loader2 className="h-4 w-4 animate-spin" /> : '저장'}
            </Button>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={exportProduct} disabled={isExporting}>
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Desk로 보내기 (상품 ZIP)
        </Button>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">상세페이지</span>
            <span className="font-medium">{detailContent ? '있음' : '없음'}</span>
          </div>
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onFileChosen} />
          <Button className="w-full" onClick={() => fileRef.current?.click()} disabled={isImporting}>
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {isImporting ? '사진 업로드 중…' : '상세페이지 가져오기 (ZIP)'}
          </Button>
          {detailContent && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />
              미리보기
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            가져온 상세페이지는 원본상품에 저장되고, 재정의하지 않은 마켓에 다음 배포 때 쓰입니다.
          </p>
        </div>
      </CardContent>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.reason === 'sku' ? '다른 상품의 상세페이지일 수 있습니다' : '기존 상세페이지를 바꿉니다'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.reason === 'sku'
                ? `ZIP의 상품코드(${pending.manifestSku})가 이 상품(${pending.productSku})과 다릅니다. 그래도 가져올까요?`
                : '이 상품에 저장된 상세페이지를 ZIP의 내용으로 바꿉니다. 사진은 네이버 이미지 서버에 올라갑니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>가져오기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>상세페이지 미리보기</DialogTitle>
          </DialogHeader>
          <iframe
            srcDoc={detailContent || ''}
            title="상세페이지 미리보기"
            className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white"
            style={{ minHeight: '60vh' }}
            sandbox=""
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}
