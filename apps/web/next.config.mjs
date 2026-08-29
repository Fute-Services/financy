/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages are consumed as TypeScript source rather than as built
  // artefacts, so a design-token change shows up on the next hot reload
  // instead of after a package rebuild.
  transpilePackages: ['@financy/ui', '@financy/core'],

  // A type or lint error must fail the build. Suppressing them here is how a
  // codebase ends up with a green pipeline and a broken contract.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
