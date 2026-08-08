/**
 * 모든 테스트 공통 환경 고정 (TEST_STRATEGY_DESIGN.md §3 결정성).
 *
 * TZ 는 package.json 스크립트에서 `TZ=Asia/Seoul` 로 먼저 넘긴다 — Node 가 TZ 를
 * 프로세스 초기에 캐시하므로 여기서 설정하는 것은 보조 수단이다.
 */
process.env.TZ ??= 'Asia/Seoul';
process.env.NODE_ENV = 'test';

// 시간 의존 로직의 기준 시각. 테스트에서 `jest.setSystemTime(FIXED_NOW)` 로 쓴다.
// KST 2026-07-15 14:30 = UTC 2026-07-15 05:30
export const FIXED_NOW = new Date('2026-07-15T05:30:00.000Z');
