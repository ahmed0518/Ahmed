import type { NextConfig } from 'next';

const securityHeaders = [
  // Vercel adds HSTS itself; a Docker deploy behind its own TLS proxy needs it from here.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pin the tracing root to this checkout. With a package-lock.json in a parent directory (a
  // review worktree under .claude/worktrees/, a stray ~/package-lock.json) Next would infer
  // that parent as the workspace root and nest the server at
  // .next/standalone/<path from that root>/server.js, where `npm start`, the e2e harness and
  // the Dockerfile cannot find it.
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
