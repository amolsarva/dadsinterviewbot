/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
  
}
module.exports = nextConfig

module.exports = {
  experimental: { incrementalCacheHandlerPath: undefined },
}
