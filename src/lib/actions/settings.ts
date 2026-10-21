'use server'

import { revalidatePath } from 'next/cache'
import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { getPrimaryNaverAccount } from '@/lib/markets/primary-account'
import { getCurrentNaverClient } from '@/lib/naver/current-client'
import { encryptApiConfigSecrets } from '@/lib/secret-crypto'
import type { Platform } from '@/types/database.types'
import type { Json } from '@/types/redesign.types'

export interface UserProfile {
  id: string
  email: string
  role: string
}

// The settings "store" is the user's primary Naver market account
// (see getPrimaryNaverAccount); the shape is kept for the settings UI.
export interface StoreProfile {
  id: string
  storeName: string
  platform: Platform
  apiConfigStatus: {
    naverCommerce: boolean
    naverApiHub: boolean
  }
  apiConfig: {
    naverClientId?: string
    naverClientSecret?: string
    naverApiHubClientId?: string
    naverApiHubClientSecret?: string
  }
  notificationSettings?: {
    webhookUrl: string
    enabled: boolean
  }
}

interface ApiConfigJson {
  naverClientId?: string
  naverClientSecret?: string
  naverApiHubClientId?: string
  naverApiHubClientSecret?: string
}

async function getSessionUserId() {
  const supabase = await createRedesignClient()
  const { data: userData } = await supabase.auth.getUser()
  return { supabase, userId: userData.user?.id ?? null }
}

export async function getUserProfile(): Promise<{ data: UserProfile | null; error: string | null }> {
  const supabase = await createRedesignClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { data: null, error: 'Unauthorized' }
  }

  return {
    data: {
      id: userData.user.id,
      email: userData.user.email || '',
      role: 'owner',
    },
    error: null,
  }
}

export async function getStoreProfile(): Promise<{ data: StoreProfile | null; error: string | null }> {
  const { supabase, userId } = await getSessionUserId()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const { account, error } = await getPrimaryNaverAccount(supabase, userId)
  if (error) return { data: null, error }
  if (!account) return { data: null, error: null }

  const apiConfig = (account.api_config || {}) as ApiConfigJson

  return {
    data: {
      id: account.id,
      storeName: account.name,
      platform: 'Naver',
      apiConfigStatus: {
        naverCommerce: Boolean(apiConfig.naverClientId && apiConfig.naverClientSecret),
        naverApiHub: Boolean(apiConfig.naverApiHubClientId && apiConfig.naverApiHubClientSecret),
      },
      // Credential values never leave the server
      apiConfig: {
        naverClientId: '',
        naverClientSecret: '',
        naverApiHubClientId: '',
        naverApiHubClientSecret: '',
      },
      notificationSettings: {
        webhookUrl: account.notification_webhook_url || '',
        enabled: account.notification_enabled ?? false,
      },
    },
    error: null,
  }
}

interface CreateOrUpdateStoreInput {
  storeName: string
  platform: Platform
  naverClientId?: string
  naverClientSecret?: string
  naverApiHubClientId?: string
  naverApiHubClientSecret?: string
}

export async function createOrUpdateStore(
  input: CreateOrUpdateStoreInput
): Promise<{ success: boolean; error: string | null }> {
  const { supabase, userId } = await getSessionUserId()
  if (!userId) return { success: false, error: 'Unauthorized' }

  const storeName = input.storeName.trim()
  if (!storeName || storeName.length > 100) {
    return { success: false, error: '스토어 이름은 1~100자로 입력해주세요.' }
  }

  const { account, error: lookupError } = await getPrimaryNaverAccount(supabase, userId)
  if (lookupError) return { success: false, error: lookupError }

  // Merge over the stored config so partial credential updates keep untouched keys
  const apiConfig: Record<string, unknown> = {
    ...((account?.api_config || {}) as Record<string, unknown>),
  }
  if (input.naverClientId) apiConfig.naverClientId = input.naverClientId.trim()
  if (input.naverClientSecret) apiConfig.naverClientSecret = input.naverClientSecret.trim()
  if (input.naverApiHubClientId) apiConfig.naverApiHubClientId = input.naverApiHubClientId.trim()
  if (input.naverApiHubClientSecret) {
    apiConfig.naverApiHubClientSecret = input.naverApiHubClientSecret.trim()
  }

  // Encrypt secret fields before persisting so the anon client only sees ciphertext
  const storedApiConfig = encryptApiConfigSecrets(apiConfig) as Json

  const { error } = account
    ? await supabase
        .from('market_accounts')
        .update({ name: storeName, api_config: storedApiConfig })
        .eq('id', account.id)
    : await supabase.from('market_accounts').insert({
        user_id: userId,
        platform: 'naver',
        name: storeName,
        api_config: storedApiConfig,
      })

  if (error) return { success: false, error: error.message }

  revalidatePath('/settings')
  return { success: true, error: null }
}

export interface NotificationSettingsInput {
  webhookUrl: string
  enabled: boolean
}

export async function updateNotificationSettings(
  input: NotificationSettingsInput
): Promise<{ success: boolean; error: string | null }> {
  const { supabase, userId } = await getSessionUserId()
  if (!userId) return { success: false, error: 'Unauthorized' }

  const webhookUrl = input.webhookUrl.trim()
  if (webhookUrl && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
    return { success: false, error: 'Discord 웹훅 URL 형식이 아닙니다.' }
  }

  const { account, error: lookupError } = await getPrimaryNaverAccount(supabase, userId)
  if (lookupError) return { success: false, error: lookupError }
  if (!account) {
    return { success: false, error: '설정 > 마켓 계정에서 스마트스토어 계정을 먼저 추가해주세요.' }
  }

  const { error } = await supabase
    .from('market_accounts')
    .update({
      notification_webhook_url: webhookUrl || null,
      notification_enabled: input.enabled,
    })
    .eq('id', account.id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/settings')
  return { success: true, error: null }
}

export async function testNaverConnection(): Promise<{ success: boolean; error: string | null }> {
  const { client, error } = await getCurrentNaverClient()
  if (!client) return { success: false, error }

  try {
    await client.getAccessToken()
    return { success: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : '연결 테스트 실패'
    return { success: false, error: message }
  }
}
