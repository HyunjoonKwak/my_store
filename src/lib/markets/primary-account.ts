import 'server-only'

import { decryptApiConfigSecrets } from '@/lib/secret-crypto'
import type { MarketApiConfig } from './registry'
import type { MarketAccountRow, RedesignClient } from '@/types/redesign.types'

/**
 * Store-level features (settings profile, commerce/trend APIs) predate
 * multi-market accounts and act on a single store. They now resolve to the
 * user's primary Naver account: the oldest active one, else the oldest one.
 */
export async function getPrimaryNaverAccount(
  supabase: RedesignClient,
  userId: string
): Promise<{ account: MarketAccountRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('market_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'naver')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) return { account: null, error: error.message }
  return { account: (data as unknown as MarketAccountRow | null) ?? null, error: null }
}

/** Decrypted api_config of the primary Naver account. */
export async function getPrimaryNaverConfig(
  supabase: RedesignClient,
  userId: string
): Promise<{ config: MarketApiConfig | null; error: string | null }> {
  const { account, error } = await getPrimaryNaverAccount(supabase, userId)
  if (error) return { config: null, error }
  if (!account) {
    return { config: null, error: '설정 > 마켓 계정에서 스마트스토어 계정을 먼저 추가해주세요.' }
  }

  try {
    return {
      config: decryptApiConfigSecrets((account.api_config || {}) as MarketApiConfig),
      error: null,
    }
  } catch (decryptError) {
    console.error('Failed to decrypt market credentials:', decryptError)
    return {
      config: null,
      error: '저장된 API 키를 복호화할 수 없습니다. 서버 암호화 키 설정을 확인해주세요.',
    }
  }
}
