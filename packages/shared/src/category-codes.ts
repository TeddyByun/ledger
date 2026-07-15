/**
 * 분류 코드 시드 (DATABASE.md §3.2) — Parent-Child 코드 관리.
 * 대분류 2자리, 소분류 4자리(상위코드 + 일련번호).
 * 실제 명세서 소비 패턴을 반영해 생활/교통/건강/교육/여가를 세분화.
 */
import { TransactionType } from './enums.js';

export interface CategorySeed {
  code: string;
  parentCode: string | null;
  name: string;
  type: TransactionType;
  depth: 1 | 2;
  sortOrder: number;
}

const E = TransactionType.EXPENSE;

export const EXPENSE_CATEGORIES: CategorySeed[] = [
  // 01 대출
  { code: '01', parentCode: null, name: '대출', type: E, depth: 1, sortOrder: 1 },
  { code: '0101', parentCode: '01', name: '이자', type: E, depth: 2, sortOrder: 1 },
  { code: '0102', parentCode: '01', name: '원금', type: E, depth: 2, sortOrder: 2 },
  // 02 투자·저축
  { code: '02', parentCode: null, name: '투자·저축', type: E, depth: 1, sortOrder: 2 },
  { code: '0201', parentCode: '02', name: '투자', type: E, depth: 2, sortOrder: 1 },
  { code: '0202', parentCode: '02', name: '적금·청약', type: E, depth: 2, sortOrder: 2 },
  // 03 보험
  { code: '03', parentCode: null, name: '보험', type: E, depth: 1, sortOrder: 3 },
  // 04 공과금·주거
  { code: '04', parentCode: null, name: '공과금·주거', type: E, depth: 1, sortOrder: 4 },
  { code: '0401', parentCode: '04', name: '관리비', type: E, depth: 2, sortOrder: 1 },
  { code: '0402', parentCode: '04', name: '전기·가스·수도', type: E, depth: 2, sortOrder: 2 },
  // 05 생활
  { code: '05', parentCode: null, name: '생활', type: E, depth: 1, sortOrder: 5 },
  { code: '0501', parentCode: '05', name: '외식', type: E, depth: 2, sortOrder: 1 },
  { code: '0502', parentCode: '05', name: '카페·간식', type: E, depth: 2, sortOrder: 2 },
  { code: '0503', parentCode: '05', name: '식료품·마트', type: E, depth: 2, sortOrder: 3 },
  { code: '0504', parentCode: '05', name: '생활용품', type: E, depth: 2, sortOrder: 4 },
  { code: '0505', parentCode: '05', name: 'ATM 출금', type: E, depth: 2, sortOrder: 5 },
  { code: '0506', parentCode: '05', name: '기타', type: E, depth: 2, sortOrder: 6 },
  // 06 통신
  { code: '06', parentCode: null, name: '통신', type: E, depth: 1, sortOrder: 6 },
  // 07 건강
  { code: '07', parentCode: null, name: '건강', type: E, depth: 1, sortOrder: 7 },
  { code: '0701', parentCode: '07', name: '병원', type: E, depth: 2, sortOrder: 1 },
  { code: '0702', parentCode: '07', name: '약국', type: E, depth: 2, sortOrder: 2 },
  // 08 교통
  { code: '08', parentCode: null, name: '교통', type: E, depth: 1, sortOrder: 8 },
  { code: '0801', parentCode: '08', name: '택시', type: E, depth: 2, sortOrder: 1 },
  { code: '0802', parentCode: '08', name: '대중교통', type: E, depth: 2, sortOrder: 2 },
  { code: '0803', parentCode: '08', name: '통행료·하이패스', type: E, depth: 2, sortOrder: 3 },
  // 09 차량
  { code: '09', parentCode: null, name: '차량', type: E, depth: 1, sortOrder: 9 },
  { code: '0901', parentCode: '09', name: '주유', type: E, depth: 2, sortOrder: 1 },
  { code: '0902', parentCode: '09', name: '주차·정비', type: E, depth: 2, sortOrder: 2 },
  // 10 경조사
  { code: '10', parentCode: null, name: '경조사', type: E, depth: 1, sortOrder: 10 },
  // 11 교육
  { code: '11', parentCode: null, name: '교육', type: E, depth: 1, sortOrder: 11 },
  { code: '1101', parentCode: '11', name: '도서·학술', type: E, depth: 2, sortOrder: 1 },
  { code: '1102', parentCode: '11', name: '강의·콘텐츠', type: E, depth: 2, sortOrder: 2 },
  // 12 여가
  { code: '12', parentCode: null, name: '여가', type: E, depth: 1, sortOrder: 12 },
  { code: '1201', parentCode: '12', name: '구독·디지털', type: E, depth: 2, sortOrder: 1 },
  { code: '1202', parentCode: '12', name: '취미·문화', type: E, depth: 2, sortOrder: 2 },
];

/** 수입 분류 (수기 시트의 수입 항목 기반, 13~ 코드대 사용) */
export const INCOME_CATEGORIES: CategorySeed[] = [
  { code: '13', parentCode: null, name: '급여', type: TransactionType.INCOME, depth: 1, sortOrder: 1 },
  { code: '14', parentCode: null, name: '상여/추가금', type: TransactionType.INCOME, depth: 1, sortOrder: 2 },
  { code: '15', parentCode: null, name: '캐시백/환급', type: TransactionType.INCOME, depth: 1, sortOrder: 3 },
  { code: '16', parentCode: null, name: '이자', type: TransactionType.INCOME, depth: 1, sortOrder: 4 },
  { code: '17', parentCode: null, name: '기타수입', type: TransactionType.INCOME, depth: 1, sortOrder: 5 },
];

export const ALL_CATEGORIES: CategorySeed[] = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
];
