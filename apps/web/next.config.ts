import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
