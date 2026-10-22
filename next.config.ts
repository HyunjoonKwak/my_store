import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Keep browser-automation packages external so their runtime assets
  // (e.g. playwright-core/browsers.json) are traced into the standalone
  // output instead of being bundled without them
  serverExternalPackages: ['playwright-core', 'juice', 'sharp'],
  outputFileTracingIncludes: {
    '/api/analyze/**': ['./node_modules/playwright-core/browsers.json'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'shop-phinf.pstatic.net',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
