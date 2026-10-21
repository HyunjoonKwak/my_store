// Naver Commerce API rate-limit handling. The gateway answers 429
// (GW.RATE_LIMIT) before the request reaches the service, so retrying is
// safe even for POST/PUT. Other statuses are never retried here.

export const MAX_RATE_LIMIT_RETRIES = 2

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 5000

export function shouldRetryRateLimit(status: number, attempt: number): boolean {
  return status === 429 && attempt < MAX_RATE_LIMIT_RETRIES
}

/**
 * Delay before retry number `attempt` (0-based). A numeric Retry-After
 * header wins; otherwise exponential backoff plus up to 25% jitter.
 * Always capped so a cron tick cannot stall on one account.
 */
export function rateLimitDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number {
  const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS)
  }

  const base = BASE_DELAY_MS * 2 ** attempt
  const jitter = Math.floor(base * 0.25 * random())
  return Math.min(base + jitter, MAX_DELAY_MS)
}
