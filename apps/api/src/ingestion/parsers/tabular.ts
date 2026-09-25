import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import XLSX from 'xlsx';

/** 표 형태 파일(xlsx/xls/csv)을 셀 문자열 2차원 배열로 읽는다. */
export async function readTabular(
  buffer: Buffer,
  filename: string,
): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return readCsv(buffer);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return readXlsx(buffer);
  // 확장자 불명 → CSV 우선 시도
  return readCsv(buffer);
}

function readCsv(buffer: Buffer): string[][] {
  // 한글 CSV는 보통 UTF-8(BOM) 또는 EUC-KR. 우선 UTF-8 처리.
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return parsed.data.map((row) => row.map((c) => (c ?? '').toString().trim()));
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  try {
    return await readXlsxExcelJS(buffer);
  } catch {
    // 일부 카드사(예: 신한) 파일은 메타데이터 누락으로 exceljs 가 실패 → SheetJS 폴백
    return readXlsxSheetJS(buffer);
  }
}

async function readXlsxExcelJS(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const rows: string[][] = [];
  // 여러 시트(예: 삼성카드 일시불/할부)를 순서대로 이어붙인다. 단일 시트는 그대로.
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // values[0] 은 비어있음(1-base)
      const values = row.values as unknown[];
      for (let i = 1; i < values.length; i++) {
        cells.push(cellToString(values[i]));
      }
      rows.push(cells);
    });
  }
  return rows;
}

/** SheetJS 폴백 리더 — exceljs 가 못 여는 파일 처리. 전 시트 concat. */
function readXlsxSheetJS(buffer: Buffer): string[][] {
  // HTML을 .xls로 제공하는 명세서도 있다. SheetJS는 </td   > 같은 닫는 태그를
  // 셀 경계로 인식하지 못하므로 정규화한다. latin1 왕복으로 원본 인코딩을 보존한다.
  const isHtml = /^\s*<(?:!doctype\s+html|html|table)\b/i.test(
    buffer.toString('utf8', 0, 1024),
  );
  const source = isHtml
    ? Buffer.from(buffer.toString('latin1').replace(/<\/(td|th)\s+>/gi, '</$1>'), 'latin1')
    : buffer;
  const wb = XLSX.read(source, {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
    // HTML의 할부/회차 "3/2" 등이 날짜로 자동 변환되지 않도록 문자열을 유지한다.
    raw: isHtml,
  });
  const rows: string[][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // 표시 서식(8/13/26) 대신 실제 날짜 셀 값을 보존한다. 일반 숫자·회차는 그대로 둔다.
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let ri = range.s.r; ri <= range.e.r; ri++) {
      const cells = Array.from({ length: range.e.c - range.s.c + 1 }, (_, ci) => ws[XLSX.utils.encode_cell({ r: ri, c: range.s.c + ci })]);
      if (!cells.some((c) => c && c.t !== 'z' && c.v != null && c.v !== '')) continue;
      rows.push(cells.map((c) => {
        if (!c) return '';
        if (c.t === 'n' && typeof c.v === 'number' && XLSX.SSF.is_date(c.z ?? '')) {
          // SheetJS Date 변환은 서버의 로컬 시간대를 적용하므로 시리얼을 직접 해석한다.
          const d = XLSX.SSF.parse_date_code(c.v, { date1904: !!wb.Workbook?.WBProps?.date1904 });
          if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S)).toISOString();
        }
        return XLSX.utils.format_cell(c).trim();
      }));
    }
  }
  return rows;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    // 하이퍼링크/리치텍스트/날짜 등
    const anyV = v as { text?: string; result?: unknown };
    if (typeof anyV.text === 'string') return anyV.text.trim();
    if (v instanceof Date) return v.toISOString();
    if (anyV.result !== undefined) return cellToString(anyV.result);
  }
  return String(v).trim();
}

/** "6,700,225", "-22,000", "" → number (빈값은 null) */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[,\s원]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 다양한 날짜 표기를 Date 로 정규화. (26-01-04, 2026.03.01, 20260301, 2026-03-01 등) */
export function parseDate(raw: string | undefined, defaultYear?: number): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m: RegExpMatchArray | null;

  // 2026-03-01 / 2026.03.01 / 2026/03/01 / 2026년 03월 01일
  m = s.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m) return toUtc(+m[1]!, +m[2]!, +m[3]!);

  // 20260301
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return toUtc(+m[1]!, +m[2]!, +m[3]!);

  // SheetJS/Excel의 미국식 표시(8/13/26). 연도 우선 표기(26/08/13)와 월 범위로 구분한다.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:$|[ T])/);
  if (m && +m[1]! <= 12) return toUtc(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[1]!, +m[2]!);

  // 26-01-04 (2자리 연도)
  m = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:$|[ T])/);
  if (m) return toUtc(2000 + +m[1]!, +m[2]!, +m[3]!);

  // 일(day)만 있는 경우 — defaultYear/월 컨텍스트 필요 → 호출부에서 처리
  return null;
}

function toUtc(y: number, mo: number, d: number): Date | null {
  const value = new Date(Date.UTC(y, mo - 1, d));
  return value.getUTCFullYear() === y && value.getUTCMonth() === mo - 1 && value.getUTCDate() === d ? value : null;
}

/**
 * 날짜 + 시간 파싱. 날짜는 parseDate 로 정규화하고, 문자열에 "HH:MM(:SS)" 시각이
 * 있으면 그 시각을 덧입힌다. 시간이 없으면 자정. (은행 거래일시: "2026-03-21 05:16:17")
 * 벽시계 시각을 그대로 UTC 성분으로 저장(날짜와 동일 규약).
 */
export function parseDateTime(
  raw: string | undefined,
  defaultYear?: number,
): Date | null {
  const base = parseDate(raw, defaultYear);
  if (!base || !raw) return base;
  const t = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!t) return base;
  const hh = +t[1]!;
  const mm = +t[2]!;
  const ss = t[3] ? +t[3] : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm, ss),
  );
}
