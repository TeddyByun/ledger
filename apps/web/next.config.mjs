/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_BASE_PATH || undefined;

const nextConfig = {
  reactStrictMode: true,
  // code-server 등 하위경로 프록시(/absproxy/3000) 뒤에서 서빙할 때 경로 프리픽스.
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
