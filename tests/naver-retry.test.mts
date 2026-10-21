import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_RATE_LIMIT_RETRIES,
  rateLimitDelayMs,
  shouldRetryRateLimit,
} from '../src/lib/naver/retry.ts'

test('shouldRetryRateLimit: only 429 within the retry budget', () => {
  assert.equal(MAX_RATE_LIMIT_RETRIES, 2)
  assert.equal(shouldRetryRateLimit(429, 0), true)
  assert.equal(shouldRetryRateLimit(429, 1), true)
  assert.equal(shouldRetryRateLimit(429, 2), false)
  assert.equal(shouldRetryRateLimit(500, 0), false)
  assert.equal(shouldRetryRateLimit(400, 0), false)
})

test('rateLimitDelayMs: honours a numeric Retry-After header, capped', () => {
  assert.equal(rateLimitDelayMs(0, '2', () => 0), 2000)
  assert.equal(rateLimitDelayMs(0, '120', () => 0), 5000)
})

test('rateLimitDelayMs: exponential backoff with jitter without a header', () => {
  assert.equal(rateLimitDelayMs(0, null, () => 0), 1000)
  assert.equal(rateLimitDelayMs(1, null, () => 0), 2000)
  assert.equal(rateLimitDelayMs(1, null, () => 0.999), 2499)
  assert.equal(rateLimitDelayMs(0, 'not-a-number', () => 0), 1000)
})
