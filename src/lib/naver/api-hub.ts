import 'server-only'

import { createRedesignClient } from '@/lib/supabase/redesign-server'
import { getPrimaryNaverConfig } from '@/lib/markets/primary-account'

const API_HUB_BASE = 'https://naverapihub.apigw.ntruss.com'

interface ApiHubConfig {
  naverApiHubClientId?: string
  naverApiHubClientSecret?: string
}

export async function getCurrentApiHubConfig(): Promise<{
  config: ApiHubConfig | null
  error: string | null
}> {
  const supabase = await createRedesignClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { config: null, error: '로그인이 필요합니다.' }

  const { config, error } = await getPrimaryNaverConfig(supabase, user.id)
  if (!config) return { config: null, error }

  if (!config.naverApiHubClientId || !config.naverApiHubClientSecret) {
    return { config: null, error: '설정에서 NAVER API HUB 키를 입력해주세요.' }
  }
  return {
    config: {
      naverApiHubClientId: config.naverApiHubClientId,
      naverApiHubClientSecret: config.naverApiHubClientSecret,
    },
    error: null,
  }
}

export async function apiHubPost(path: string, body: Record<string, unknown>) {
  const { config, error } = await getCurrentApiHubConfig()
  if (!config) throw new Error(error || 'NAVER API HUB 설정이 필요합니다.')

  const response = await fetch(`${API_HUB_BASE}${path}`, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': config.naverApiHubClientId!,
      'X-NCP-APIGW-API-KEY': config.naverApiHubClientSecret!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || data?.errorMessage || data?.errMsg
    throw new Error(message || `NAVER API HUB 요청이 거절되었습니다. (${response.status})`)
  }
  return data
}
