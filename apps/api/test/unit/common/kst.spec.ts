import { nowKst, currentYmKst } from '../../../src/common/kst.js';

/**
 * 회귀 테스트 — 서버가 UTC 로 돌 때 KST 새벽(00:00~09:00)에 날짜가 밀리던 결함.
 * (검증 2026-08-17 발견 · consistency-check I4)
 */
describe('nowKst — KST(UTC+9) 기준 오늘', () => {
  // ESM 모드라 전역 jest 객체가 없다 — Date.now 를 직접 갈아끼운다
  const realNow = Date.now;
  const at = (iso: string) => {
    Date.now = () => new Date(iso).getTime();
  };
  afterEach(() => {
    Date.now = realNow;
  });

  it('KST 새벽 07:00(= UTC 전날 22:00)에도 KST 날짜를 돌려준다', () => {
    at('2026-09-01T07:00:00+09:00'); // UTC 2026-08-31 22:00
    const d = nowKst();
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth() + 1).toBe(9);
    expect(d.getUTCDate()).toBe(1);
  });

  it('월 경계 — KST 9월 1일 00:30 이면 이번 달은 9월(UTC 로는 8월 31일)', () => {
    at('2026-09-01T00:30:00+09:00'); // UTC 2026-08-31 15:30
    expect(currentYmKst()).toBe('2026-09');
    expect(new Date(Date.now()).getUTCMonth() + 1).toBe(8); // 대조: 순수 UTC 로는 8월
  });

  it('KST 오전 9시 이후는 UTC 와 같은 날짜', () => {
    at('2026-09-01T18:00:00+09:00'); // UTC 2026-09-01 09:00
    expect(currentYmKst()).toBe('2026-09');
    expect(nowKst().getUTCDate()).toBe(1);
  });

  it('연말 경계 — KST 2027-01-01 02:00 이면 2027-01', () => {
    at('2027-01-01T02:00:00+09:00'); // UTC 2026-12-31 17:00
    expect(currentYmKst()).toBe('2027-01');
  });
});
