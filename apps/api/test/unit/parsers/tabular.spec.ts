/**
 * 표 파일 공통 정규화 유틸 단위 테스트 (TEST_STRATEGY_DESIGN.md §2.1).
 *
 * 여기서 깨지면 모든 발급사 파서가 함께 틀어지므로 최우선 회귀 지점이다.
 */
import {
  parseAmount,
  parseDate,
  parseDateTime,
} from '../../../src/ingestion/parsers/tabular.js';

describe('parseAmount', () => {
  it.each([
    ['6,700,225', 6_700_225],
    ['-22,000', -22_000],
    ['1 000 원', 1_000],
    ['0', 0],
    ['22000', 22_000],
  ])('%s → %s', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each([
    ['빈 문자열', ''],
    ["잔액 '-' (NULL 규약)", '-'],
    ['undefined', undefined],
  ])('%s 는 null', (_label, raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it('숫자로 해석 불가한 값은 null (0 으로 뭉개지 않는다)', () => {
    // 호출부가 `parseAmount(x) ?? 0` 으로 받으므로, null 반환은 "0원 적재"와
    // 구분되지 않는다. 최소한 이 함수가 NaN 을 흘리지 않는 것은 보장한다.
    expect(parseAmount('해당없음')).toBeNull();
    expect(parseAmount('1,2,3원짜리')).toBeNull();
  });
});

describe('parseDate — 발급사별 표기 정규화', () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it.each([
    ['2026-03-01', utc(2026, 3, 1)],
    ['2026.03.01', utc(2026, 3, 1)],
    ['2026/03/01', utc(2026, 3, 1)],
    ['2026년 03월 01일', utc(2026, 3, 1)],
    ['20260301', utc(2026, 3, 1)], // 삼성 무구분자
    ['26-01-04', utc(2026, 1, 4)], // 2자리 연도
  ])('%s 를 파싱한다', (raw, expected) => {
    expect(parseDate(raw)).toEqual(expected);
  });

  it('벽시계 날짜를 UTC 성분에 담는다 (저장 규약)', () => {
    // TZ=Asia/Seoul 에서도 날짜가 하루 밀리지 않아야 한다.
    const d = parseDate('2026-03-01')!;
    expect(d.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('날짜가 없으면 null', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('합계')).toBeNull();
  });

  // ── 알려진 미구현 (감사보고서 '미검증 저순위' — tabular.ts:106) ──
  // test.failing 은 본문이 실패할 때 통과한다. 구현이 고쳐지면 이 테스트가
  // 빨개지므로, 그때 `.failing` 을 떼면 정상 회귀 테스트가 된다.
  it.failing('2자리 연도 + 시각 조합을 파싱한다 (미구현)', () => {
    // 2자리 연도 정규식이 `$` 로 끝나 뒤에 시각이 붙으면 매칭에 실패한다.
    expect(parseDate('26.03.15 14:22')).toEqual(utc(2026, 3, 15));
  });

  it.failing('월·일 범위를 검증한다 (미구현)', () => {
    // 현재는 Date.UTC 가 자동 롤오버해 2027-02-14 같은 엉뚱한 날짜가 된다.
    expect(parseDate('2026.13.45')).toBeNull();
  });
});

describe('parseDateTime — 은행 거래일시', () => {
  it('시각을 덧입힌다', () => {
    expect(parseDateTime('2026-03-21 05:16:17')?.toISOString()).toBe(
      '2026-03-21T05:16:17.000Z',
    );
  });

  it('시각이 없으면 자정', () => {
    expect(parseDateTime('2026-03-21')?.toISOString()).toBe('2026-03-21T00:00:00.000Z');
  });

  it('비정상 시각은 무시하고 날짜만 반환', () => {
    expect(parseDateTime('2026-03-21 99:99')?.toISOString()).toBe(
      '2026-03-21T00:00:00.000Z',
    );
  });
});
