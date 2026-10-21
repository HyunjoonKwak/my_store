'use client'

import type { Dispatch, SetStateAction } from 'react'
import { User, Palette, FolderOpen } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { ThemeSelector } from '@/components/ui/ThemeToggle'
import type { Platform } from '@/types/database.types'

export interface ProfileState {
  email: string
  storeName: string
  platform: Platform
}

interface GeneralTabProps {
  useSameFolder: boolean
  setUseSameFolder: (checked: boolean) => void
  orderDownloadPath: string
  trackingUploadPath: string
  setOrderDownloadPath: (path: string) => void
  setTrackingUploadPath: (path: string) => void
  profile: ProfileState
  setProfile: Dispatch<SetStateAction<ProfileState>>
}

export function GeneralTab({
  useSameFolder,
  setUseSameFolder,
  orderDownloadPath,
  trackingUploadPath,
  setOrderDownloadPath,
  setTrackingUploadPath,
  profile,
  setProfile,
}: GeneralTabProps) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>테마 설정</CardTitle>
              <CardDescription>화면 테마를 선택하세요</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ThemeSelector />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>기본 폴더 설정</CardTitle>
              <CardDescription>주문 다운로드 및 운송장 업로드 기본 경로</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">동일 폴더 사용</p>
              <p className="text-sm text-muted-foreground">
                다운로드와 업로드에 같은 폴더 사용
              </p>
            </div>
            <Switch
              checked={useSameFolder}
              onCheckedChange={(checked) => {
                setUseSameFolder(checked)
                if (checked && orderDownloadPath) {
                  setTrackingUploadPath(orderDownloadPath)
                }
              }}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="orderDownloadPath">주문 다운로드 폴더</Label>
            <div className="flex gap-2">
              <Input
                id="orderDownloadPath"
                value={orderDownloadPath}
                onChange={(e) => {
                  setOrderDownloadPath(e.target.value)
                  if (useSameFolder) {
                    setTrackingUploadPath(e.target.value)
                  }
                }}
                placeholder="예: C:\Downloads\주문 또는 /Users/username/Downloads/orders"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={async () => {
                  try {
                    const windowWithPicker = window as Window & { showDirectoryPicker?: () => Promise<{ name: string }> }
                    if (!windowWithPicker.showDirectoryPicker) {
                      toast.error('폴더 선택이 지원되지 않는 브라우저입니다.')
                      return
                    }
                    const dirHandle = await windowWithPicker.showDirectoryPicker()
                    const path = dirHandle.name
                    setOrderDownloadPath(path)
                    if (useSameFolder) {
                      setTrackingUploadPath(path)
                    }
                    toast.success(`폴더 선택: ${path}`)
                  } catch (e: unknown) {
                    if (e instanceof Error && e.name !== 'AbortError') {
                      toast.error('폴더 선택이 지원되지 않는 브라우저입니다.')
                    }
                  }
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              주문 엑셀 파일을 다운로드할 기본 폴더 경로
            </p>
          </div>

          {!useSameFolder && (
            <div className="space-y-2">
              <Label htmlFor="trackingUploadPath">운송장 업로드 폴더</Label>
              <div className="flex gap-2">
                <Input
                  id="trackingUploadPath"
                  value={trackingUploadPath}
                  onChange={(e) => setTrackingUploadPath(e.target.value)}
                  placeholder="예: C:\Downloads\운송장 또는 /Users/username/Downloads/tracking"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    try {
                      const windowWithPicker = window as Window & { showDirectoryPicker?: () => Promise<{ name: string }> }
                      if (!windowWithPicker.showDirectoryPicker) {
                        toast.error('폴더 선택이 지원되지 않는 브라우저입니다.')
                        return
                      }
                      const dirHandle = await windowWithPicker.showDirectoryPicker()
                      const path = dirHandle.name
                      setTrackingUploadPath(path)
                      toast.success(`폴더 선택: ${path}`)
                    } catch (e: unknown) {
                      if (e instanceof Error && e.name !== 'AbortError') {
                        toast.error('폴더 선택이 지원되지 않는 브라우저입니다.')
                      }
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                운송장 엑셀 파일을 업로드할 때 기본으로 열릴 폴더 경로
              </p>
            </div>
          )}

          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            <p>💡 설정된 폴더는 발송처리 페이지에서 주문 다운로드 및 운송장 업로드 시 기본 경로로 사용됩니다.</p>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>프로필 정보</CardTitle>
              <CardDescription>계정 및 스토어 기본 정보</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              value={profile.email}
              disabled
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="storeName">스토어 이름</Label>
            <Input
              id="storeName"
              value={profile.storeName}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, storeName: e.target.value }))
              }
              placeholder="내 스마트스토어"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform">플랫폼</Label>
            {/* The settings store is the primary Naver market account; other
                markets are added under 마켓 계정 */}
            <Input id="platform" value="네이버 스마트스토어" readOnly disabled />
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
