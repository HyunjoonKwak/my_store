'use client'

import { useState, useEffect, useTransition } from 'react'
import { Save, LogOut, User, Key, Bell, Loader2, RefreshCw, Store, Bot } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layouts/Header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  getUserProfile,
  getStoreProfile,
  createOrUpdateStore,
  updateNotificationSettings,
  testNaverConnection,
} from '@/lib/actions/settings'
import { useDefaultFolder } from '@/hooks/useDefaultFolder'
import type { Platform } from '@/types/database.types'
import { type ApiConnectionState } from './components/ApiStatusBadge'
import { GeneralTab } from './components/GeneralTab'
import { IntegrationsTab } from './components/IntegrationsTab'
import { AutomationTab } from './components/AutomationTab'
import { NotificationsTab } from './components/NotificationsTab'
import { NotificationSettingsDialog } from './components/NotificationSettingsDialog'
import { MarketAccountsTab } from './components/MarketAccountsTab'
import { AiTab } from './components/AiTab'
import { getMarketAccounts, type MarketAccountInfo } from '@/lib/actions/market-accounts'

export default function SettingsPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isTesting, setIsTesting] = useState(false)
  const [isTestingApiHub, setIsTestingApiHub] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false)
  const [marketAccounts, setMarketAccounts] = useState<MarketAccountInfo[]>([])

  useEffect(() => {
    getMarketAccounts().then((result) => {
      if (result.data) setMarketAccounts(result.data)
    })
  }, [])

  const [notificationStatus, setNotificationStatus] = useState({
    smsConfigured: false,
    kakaoConfigured: false,
  })

  const [profile, setProfile] = useState({
    email: '',
    storeName: '',
    platform: 'Naver' as Platform,
  })

  const [apiKeys, setApiKeys] = useState({
    naverClientId: '',
    naverClientSecret: '',
    naverApiHubClientId: '',
    naverApiHubClientSecret: '',
  })

  const [apiConfigured, setApiConfigured] = useState({
    naverCommerce: false,
    naverApiHub: false,
  })

  const [editingApi, setEditingApi] = useState({
    naverCommerce: false,
    naverApiHub: false,
  })

  const [apiConnectionState, setApiConnectionState] = useState<{
    naverCommerce: ApiConnectionState
    naverApiHub: ApiConnectionState
  }>({
    naverCommerce: 'idle',
    naverApiHub: 'idle',
  })

  const [notifications, setNotifications] = useState({
    newOrders: true,
    orderStatus: true,
    aiComplete: false,
  })


  const [discordSettings, setDiscordSettings] = useState({
    webhookUrl: '',
    enabled: false,
  })

  const {
    orderDownloadPath,
    trackingUploadPath,
    setOrderDownloadPath,
    setTrackingUploadPath,
    isLoaded: isFolderSettingsLoaded,
  } = useDefaultFolder()

  const [useSameFolder, setUseSameFolder] = useState(false)

  useEffect(() => {
    if (isFolderSettingsLoaded && orderDownloadPath && orderDownloadPath === trackingUploadPath) {
      setUseSameFolder(true)
    } else {
      setUseSameFolder(false)
    }
  }, [isFolderSettingsLoaded, orderDownloadPath, trackingUploadPath])

  useEffect(() => {
    async function loadProfile() {
      const [userResult, storeResult] = await Promise.all([
        getUserProfile(),
        getStoreProfile(),
      ])

      if (userResult.data) {
        setProfile((prev) => ({
          ...prev,
          email: userResult.data!.email,
        }))
      }

      if (storeResult.data) {
        setProfile((prev) => ({
          ...prev,
          storeName: storeResult.data!.storeName,
          platform: storeResult.data!.platform,
        }))
        setApiKeys({
          naverClientId: storeResult.data.apiConfig.naverClientId || '',
          naverClientSecret: storeResult.data.apiConfig.naverClientSecret || '',
          naverApiHubClientId: storeResult.data.apiConfig.naverApiHubClientId || '',
          naverApiHubClientSecret: storeResult.data.apiConfig.naverApiHubClientSecret || '',
        })
        setApiConfigured(storeResult.data.apiConfigStatus)
        if (storeResult.data.notificationSettings) {
          setDiscordSettings(storeResult.data.notificationSettings)
        }
      }

      setIsLoading(false)
    }

    loadProfile()
    checkNotificationStatus()
  }, [])

  const checkNotificationStatus = async () => {
    try {
      const response = await fetch('/api/notifications/status')
      if (response.ok) {
        const data = await response.json()
        setNotificationStatus(data)
      }
    } catch {
      // Silently ignore; notification status stays unknown
    }
  }

  const handleSaveProfile = () => {
    if (!profile.storeName) {
      toast.error('스토어 이름을 입력해주세요.')
      return
    }

    const hasPartialCommerceKey = Boolean(apiKeys.naverClientId) !== Boolean(apiKeys.naverClientSecret)
    const hasPartialApiHubKey = Boolean(apiKeys.naverApiHubClientId) !== Boolean(apiKeys.naverApiHubClientSecret)
    if (hasPartialCommerceKey || hasPartialApiHubKey) {
      toast.error('Client ID와 Client Secret을 모두 입력해주세요.')
      return
    }

    startTransition(async () => {
      const result = await createOrUpdateStore({
        storeName: profile.storeName,
        platform: profile.platform,
        naverClientId: apiKeys.naverClientId || undefined,
        naverClientSecret: apiKeys.naverClientSecret || undefined,
        naverApiHubClientId: apiKeys.naverApiHubClientId || undefined,
        naverApiHubClientSecret: apiKeys.naverApiHubClientSecret || undefined,
      })

      if (result.success) {
        setApiConfigured((prev) => ({
          naverCommerce: prev.naverCommerce || Boolean(apiKeys.naverClientId && apiKeys.naverClientSecret),
          naverApiHub: prev.naverApiHub || Boolean(apiKeys.naverApiHubClientId && apiKeys.naverApiHubClientSecret),
        }))
        setApiKeys({
          naverClientId: '',
          naverClientSecret: '',
          naverApiHubClientId: '',
          naverApiHubClientSecret: '',
        })
        setEditingApi({ naverCommerce: false, naverApiHub: false })
        setApiConnectionState({ naverCommerce: 'idle', naverApiHub: 'idle' })
        toast.success('설정이 저장되었습니다.')
      } else {
        toast.error(result.error || '저장에 실패했습니다.')
      }
    })
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    try {
      const result = await testNaverConnection()
      if (result.success) {
        setApiConnectionState((prev) => ({ ...prev, naverCommerce: 'success' }))
        toast.success('네이버 API 연결 성공!')
      } else {
        setApiConnectionState((prev) => ({ ...prev, naverCommerce: 'error' }))
        toast.error(result.error || '연결 테스트 실패')
      }
    } catch {
      setApiConnectionState((prev) => ({ ...prev, naverCommerce: 'error' }))
      toast.error('연결 테스트 중 오류가 발생했습니다.')
    } finally {
      setIsTesting(false)
    }
  }

  const handleTestApiHub = async () => {
    setIsTestingApiHub(true)
    try {
      const response = await fetch('/api/trends/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['스마트스토어', '온라인쇼핑'], days: 14 }),
      })
      const result = await response.json()
      if (response.ok) {
        setApiConnectionState((prev) => ({ ...prev, naverApiHub: 'success' }))
        toast.success('NAVER API HUB 연결 성공!')
      } else {
        setApiConnectionState((prev) => ({ ...prev, naverApiHub: 'error' }))
        toast.error(result.message || '연결 테스트 실패')
      }
    } catch {
      setApiConnectionState((prev) => ({ ...prev, naverApiHub: 'error' }))
      toast.error('연결 테스트 중 오류가 발생했습니다.')
    } finally {
      setIsTestingApiHub(false)
    }
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('로그아웃되었습니다.')
    router.push('/login')
    router.refresh()
  }

  const handleSaveDiscordSettings = () => {
    startTransition(async () => {
      const result = await updateNotificationSettings({
        webhookUrl: discordSettings.webhookUrl,
        enabled: discordSettings.enabled,
      })

      if (result.success) {
        toast.success('Discord 알림 설정이 저장되었습니다.')
      } else {
        toast.error(result.error || '저장에 실패했습니다.')
      }
    })
  }

  const handleTestDiscordWebhook = async () => {
    if (!discordSettings.webhookUrl) {
      toast.error('Discord 웹훅 URL을 입력해주세요.')
      return
    }

    try {
      const response = await fetch('/api/notifications/discord/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: discordSettings.webhookUrl }),
      })
      const result = await response.json()

      if (result.success) {
        toast.success('테스트 메시지가 전송되었습니다.')
      } else {
        toast.error(result.error || '테스트 전송에 실패했습니다.')
      }
    } catch {
      toast.error('테스트 전송 중 오류가 발생했습니다.')
    }
  }

  if (isLoading) {
    return (
      <>
        <Header title="설정" subtitle="Settings" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      </>
    )
  }

  return (
    <>
      <Header title="설정" subtitle="Settings" />

      <div className="flex-1 overflow-y-auto p-4 pb-20 lg:p-6 lg:pb-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">설정 센터</p>
              <p className="text-sm text-muted-foreground">
                필요한 영역만 열어보고, 기본 정보와 API 변경사항은 여기서 저장하세요.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={handleSaveProfile} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                기본 정보 · API 저장
              </Button>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </Button>
            </div>
          </div>

          <Tabs
            defaultValue="general"
            className="gap-4 [&_[data-slot=card]]:gap-4 [&_[data-slot=card]]:py-5 [&_[data-slot=card-content]]:px-5 [&_[data-slot=card-header]]:px-5"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-6">
              <TabsTrigger value="markets" className="py-2.5">
                <Store className="h-4 w-4" />
                마켓 계정
              </TabsTrigger>
              <TabsTrigger value="general" className="py-2.5">
                <User className="h-4 w-4" />
                기본 설정
              </TabsTrigger>
              <TabsTrigger value="integrations" className="py-2.5">
                <Key className="h-4 w-4" />
                서비스 연동
              </TabsTrigger>
              <TabsTrigger value="automation" className="py-2.5">
                <RefreshCw className="h-4 w-4" />
                자동화
              </TabsTrigger>
              <TabsTrigger value="ai" className="py-2.5">
                <Bot className="h-4 w-4" />
                AI
              </TabsTrigger>
              <TabsTrigger value="notifications" className="py-2.5">
                <Bell className="h-4 w-4" />
                알림
              </TabsTrigger>
            </TabsList>

            <TabsContent value="markets" className="mt-0">
              <MarketAccountsTab
                accounts={marketAccounts}
                onChanged={() => {
                  getMarketAccounts().then((result) => {
                    if (result.data) setMarketAccounts(result.data)
                  })
                }}
              />
            </TabsContent>

            <TabsContent value="general" className="mt-0">
              <GeneralTab
                useSameFolder={useSameFolder}
                setUseSameFolder={setUseSameFolder}
                orderDownloadPath={orderDownloadPath}
                trackingUploadPath={trackingUploadPath}
                setOrderDownloadPath={setOrderDownloadPath}
                setTrackingUploadPath={setTrackingUploadPath}
                profile={profile}
                setProfile={setProfile}
              />
            </TabsContent>

            <TabsContent value="integrations" className="mt-0">
              <IntegrationsTab
                apiKeys={apiKeys}
                setApiKeys={setApiKeys}
                apiConfigured={apiConfigured}
                editingApi={editingApi}
                setEditingApi={setEditingApi}
                apiConnectionState={apiConnectionState}
                isTesting={isTesting}
                isTestingApiHub={isTestingApiHub}
                handleTestConnection={handleTestConnection}
                handleTestApiHub={handleTestApiHub}
              />
            </TabsContent>

            <TabsContent value="automation" className="mt-0">
              <AutomationTab />
            </TabsContent>

            <TabsContent value="ai" className="mt-0">
              <AiTab />
            </TabsContent>

            <TabsContent value="notifications" className="mt-0">
              <NotificationsTab
                notificationStatus={notificationStatus}
                setIsNotificationDialogOpen={setIsNotificationDialogOpen}
                discordSettings={discordSettings}
                setDiscordSettings={setDiscordSettings}
                notifications={notifications}
                setNotifications={setNotifications}
                handleTestDiscordWebhook={handleTestDiscordWebhook}
                handleSaveDiscordSettings={handleSaveDiscordSettings}
                isPending={isPending}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <NotificationSettingsDialog
        open={isNotificationDialogOpen}
        onOpenChange={setIsNotificationDialogOpen}
      />
    </>
  )
}
