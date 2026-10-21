import type { MarketAdapter, MarketPlatform } from './types'
import { NaverAdapter } from './naver/adapter.ts'
import { CoupangAdapter } from './coupang/adapter.ts'

// market_accounts.api_config shape after app-level decryption.
// Keys mirror the settings UI field names per platform.
export interface MarketApiConfig {
  // naver
  naverClientId?: string
  naverClientSecret?: string
  naverSellerId?: string
  // NAVER API HUB (keyword trends), stored on the primary naver account
  naverApiHubClientId?: string
  naverApiHubClientSecret?: string
  // coupang
  coupangAccessKey?: string
  coupangSecretKey?: string
  coupangVendorId?: string
}

export const PLATFORM_LABELS: Record<MarketPlatform, string> = {
  naver: '스마트스토어',
  coupang: '쿠팡',
}

export function isMarketPlatform(value: string): value is MarketPlatform {
  return value === 'naver' || value === 'coupang'
}

/**
 * Resolve a platform + decrypted api_config into an adapter.
 * Returns an error string (not a throw) when credentials are missing so
 * callers surface it to settings UI instead of crashing sync jobs.
 */
export function createAdapter(
  platform: MarketPlatform,
  config: MarketApiConfig
): { adapter: MarketAdapter; error: null } | { adapter: null; error: string } {
  switch (platform) {
    case 'naver': {
      if (!config.naverClientId || !config.naverClientSecret) {
        return { adapter: null, error: '설정에서 네이버 커머스 API 키를 입력해주세요.' }
      }
      return {
        adapter: new NaverAdapter({
          clientId: config.naverClientId,
          clientSecret: config.naverClientSecret,
          sellerId: config.naverSellerId,
        }),
        error: null,
      }
    }
    case 'coupang': {
      return {
        adapter: new CoupangAdapter({
          accessKey: config.coupangAccessKey || '',
          secretKey: config.coupangSecretKey || '',
          vendorId: config.coupangVendorId || '',
        }),
        error: null,
      }
    }
  }
}
