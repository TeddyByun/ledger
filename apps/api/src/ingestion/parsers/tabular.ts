import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

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
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows: string[][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false, // 셀 서식대로 문자열화(날짜/숫자)
      defval: '',
      blankrows: false,
    });
    for (const r of aoa) rows.push(r.map((c) => String(c ?? '').trim()));
  }
  return rows;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    // 하이퍼링크/리치텍스트/날짜 등
    const anyV = v as { text?: string; result?: unknown };
    if (typeof anyV.text === 'string') return anyV.text.trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (anyV.result !== undefined) return String(anyV.result).trim();
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

  // 26-01-04 (2자리 연도)
  m = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return toUtc(2000 + +m[1]!, +m[2]!, +m[3]!);

  // 일(day)만 있는 경우 — defaultYear/월 컨텍스트 필요 → 호출부에서 처리
  return null;
}

function toUtc(y: number, mo: number, d: number): Date {
  return new Date(Date.UTC(y, mo - 1, d));
}
