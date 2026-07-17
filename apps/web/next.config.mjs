/** @type {import('next').NextConfig} */
// 하위경로 프록시(code-server /proxy/3000) 뒤에서 정적 자원 경로 프리픽스.
// 라우팅은 단일 페이지(상태 기반)라 basePath 불필요 — assetPrefix 만 지정.
const assetPrefix = process.env.NEXT_ASSET_PREFIX || undefined;

const nextConfig = {
  reactStrictMode: true,
  ...(assetPrefix ? { assetPrefix } : {}),
  // 프록시(code-server) 공유 캐시가 HTML 문서를 장기 캐시(s-maxage 1년)하지 않도록
  // 문서만 항상 재검증. 해시 붙은 정적 자원(_next/static)은 그대로 장기 캐시 유지.
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
