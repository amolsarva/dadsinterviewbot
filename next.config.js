/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
    serverActions: { allowedOrigins: ['*'] },
  },
  output: 'standalone',
}
module.exports = nextConfig
