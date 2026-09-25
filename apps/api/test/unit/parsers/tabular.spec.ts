/**
 * 표 파일 공통 정규화 유틸 단위 테스트 (TEST_STRATEGY_DESIGN.md §2.1).
 *
 * 여기서 깨지면 모든 발급사 파서가 함께 틀어지므로 최우선 회귀 지점이다.
 */
import * as XLSX from 'xlsx';
import {
  readTabular,
  parseAmount,
  parseDate,
  parseDateTime,
} from '../../../src/ingestion/parsers/tabular.js';

describe('readTabular — 실제 엑셀 형식', () => {
  it.each(['xlsx', 'biff8'] as const)('%s의 셀 값과 여러 시트를 유지한다', async (bookType) => {
    const wb = XLSX.utils.book_new();
    const first = [['이용가맹점', '이용금액'], ['테스트 </td   >', 12_500]];
    const second = [['이용가맹점', '이용금액'], ['테스트카페', -1_000]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(first), '일시불');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(second), '할부');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;

    const rows = await readTabular(buffer, bookType === 'xlsx' ? 'test.xlsx' : 'test.xls');

    expect(rows).toEqual([...first, ...second].map((row) => row.map(String)));
  });
});

describe('엑셀 날짜 셀의 원래 일시', () => {
  it.each(['xlsx', 'biff8'] as const)('%s에 날짜만 표시되어도 숨겨진 시각을 보존한다', async (bookType) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['이용일'], [null], [''], [46247 + (10 * 3600 + 12 * 60) / 86400]]);
    ws['A4']!.z = 'm/d/yy';
    XLSX.utils.book_append_sheet(wb, ws, '내역');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
    const rows = await readTabular(buffer, bookType === 'xlsx' ? 'test.xlsx' : 'test.xls');
    const date = rows.map((r) => parseDateTime(r[0])).find(Boolean);
    expect(date?.toISOString()).toBe('2026-08-13T10:12:00.000Z');
  });
});

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
    ['8/13/26', utc(2026, 8, 13)],
    ['8/1/26', utc(2026, 8, 1)],
    ['12/31/2026', utc(2026, 12, 31)],
    ['26/08/13', utc(2026, 8, 13)],
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

  it('2자리 연도 + 시각 조합을 파싱한다', () => {
    expect(parseDate('26.03.15 14:22')).toEqual(utc(2026, 3, 15));
  });

  it('월·일 범위를 검증한다', () => {
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

  it('비정상 시각을 자정으로 조작하지 않는다', () => {
    expect(parseDateTime('2026-03-21 99:99')).toBeNull();
  });
});
