import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const isDev = process.env.NODE_ENV === 'development'

// Generate a per-request CSP nonce using Web Crypto (Edge-safe, no node:crypto).
function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

// Derive Supabase origins from env at runtime instead of hardcoding.
function getSupabaseSources(): string[] {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!rawUrl) return []
  try {
    const url = new URL(rawUrl)
    return [url.origin, `wss://${url.host}`]
  } catch {
    return []
  }
}

function buildCsp(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Next.js dev tooling requires eval; never allowed in production.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ]

  const connectSrc = [
    "'self'",
    ...getSupabaseSources(),
    // HMR websocket in development only.
    ...(isDev ? ['ws://localhost:*'] : []),
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // Tailwind and Next.js emit inline style attributes/tags; Pretendard
    // webfont CSS is served from jsdelivr (see src/app/layout.tsx).
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    // Scraped product images come from arbitrary https hosts.
    "img-src 'self' https: data: blob:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    `connect-src ${connectSrc.join(' ')}`,
    // External competitor page previews are embedded in iframes.
    'frame-src https:',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce()
  const csp = buildCsp(nonce)

  // Set CSP on the request headers BEFORE updateSession runs. updateSession
  // forwards the whole request via NextResponse.next({ request }) (both on its
  // initial response and after Supabase cookie writes), so Next.js sees this
  // header as a request-header override and applies the nonce to its own
  // framework inline scripts. Cookie handling is untouched: Supabase mutates
  // request.cookies on this same request object.
  request.headers.set('content-security-policy', csp)
  // Expose the nonce to server components (e.g. layout passes it to
  // next-themes so its theme-init inline script survives the CSP).
  request.headers.set('x-nonce', nonce)

  const response = await updateSession(request)

  // Mirror the policy on the outgoing response so browsers enforce it.
  response.headers.set('content-security-policy', csp)

  return response
}

export const config = {
  matcher: [
    // api/exchange takes ZIP uploads larger than the proxy's 10MB body
    // buffer (proxyClientMaxBodySize); those routes check auth themselves.
    '/((?!_next/static|_next/image|favicon.ico|api/exchange/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
