import type { NextConfig } from 'next';

// The Fastify API has no CORS layer (browser cross-origin calls to :4000 are
// blocked). Rather than call it cross-origin, the browser hits same-origin
// `/api/*` and Next proxies to the server — this also mirrors the single-origin
// (ngrok) deployment model. Set NEXT_PUBLIC_API_BASE_URL='' so the client uses
// relative paths that hit these rewrites (see apps/web/.env.local).
const serverOrigin = process.env.SERVER_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${serverOrigin}/api/:path*` }];
  },
  webpack(config) {
    // packages/shared uses NodeNext-style relative imports ("./foo.js") that
    // resolve to .ts files via tsc/vitest's "Bundler" moduleResolution, but
    // webpack doesn't know to try .ts for a literal ".js" import by default.
    // Do not "fix" this in packages/shared — it's frozen (see CLAUDE.md).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
