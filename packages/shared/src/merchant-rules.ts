/**
 * 가맹점 자동분류 규칙 시드 (DATABASE.md §3.9).
 * 카드 명세서 가맹점명 → 분류 코드 매핑. priority 작을수록 우선.
 */
import { MatchType } from './enums.js';

export interface MerchantRuleSeed {
  pattern: string;
  matchType: MatchType;
  categoryCode: string;
  priority: number;
}

/** `contains` 규칙은 pattern을 OR 후보 배열로 정의해 펼친다. */
const CONTAINS_GROUPS: Array<{ patterns: string[]; categoryCode: string; priority: number }> = [
  { patterns: ['주유소'], categoryCode: '09', priority: 10 },
  { patterns: ['하이패스', '고속도로', '도로공사'], categoryCode: '08', priority: 10 },
  { patterns: ['카카오T', '택시', '티머니', '캐시비', '이동의즐거움'], categoryCode: '08', priority: 20 },
  { patterns: ['고속버스', '운송사업조합', '버스', '지하철'], categoryCode: '08', priority: 20 },
  { patterns: ['약국', '의원', '보건소', '병원', '정형외과'], categoryCode: '07', priority: 20 },
  { patterns: ['KT통신요금', '통신요금', 'SKT'], categoryCode: '06', priority: 20 },
  { patterns: ['아파트관리비', '관리비'], categoryCode: '04', priority: 20 },
  { patterns: ['구글페이먼트', '구글플레이'], categoryCode: '0503', priority: 30 },
  { patterns: ['대학서적', '학술정보', '팬딩'], categoryCode: '11', priority: 20 },
  {
    patterns: ['마트', '다이소', 'GS25', 'CU', '세븐일레븐', '이마트24', '코스트코', '식자재'],
    categoryCode: '0501',
    priority: 40,
  },
  {
    patterns: [
      '우아한형제들', '배민', '도시락', '국수', '국밥', '돈불', '칼국수', '피자',
      '버거킹', '롯데리아', '써브웨이', '맘스터치', '커피', '카페', '냉면', '제면',
      '순대국', '돌솥밥', '포차', '부안집', '맛찬방',
    ],
    categoryCode: '0501',
    priority: 50,
  },
  { patterns: ['헤어', '미용'], categoryCode: '0501', priority: 50 },
];

export const MERCHANT_RULES: MerchantRuleSeed[] = CONTAINS_GROUPS.flatMap((g) =>
  g.patterns.map((pattern) => ({
    pattern,
    matchType: MatchType.CONTAINS,
    categoryCode: g.categoryCode,
    priority: g.priority,
  })),
);
