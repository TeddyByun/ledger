/** @type {import('next').NextConfig} */
// 하위경로 프록시(code-server /proxy/3000) 뒤에서 정적 자원 경로 프리픽스.
// 라우팅은 단일 페이지(상태 기반)라 basePath 불필요 — assetPrefix 만 지정.
const assetPrefix = process.env.NEXT_ASSET_PREFIX || undefined;

const nextConfig = {
  reactStrictMode: true,
  ...(assetPrefix ? { assetPrefix } : {}),
};

export default nextConfig;
