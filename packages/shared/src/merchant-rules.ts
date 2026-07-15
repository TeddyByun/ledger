/**
 * 가맹점 자동분류 규칙 시드 (DATABASE.md §3.9).
 * 카드 명세서 가맹점명 → 분류 코드 매핑. priority 작을수록 우선.
 * 실제 명세서(하나/현대/삼성 3월)의 가맹점을 반영해 세분류 코드로 매핑.
 */
import { MatchType } from './enums.js';

export interface MerchantRuleSeed {
  pattern: string;
  matchType: MatchType;
  categoryCode: string;
  priority: number;
}

/** `contains` 규칙은 pattern을 OR 후보 배열로 정의해 펼친다. priority 작을수록 먼저 매칭. */
const CONTAINS_GROUPS: Array<{ patterns: string[]; categoryCode: string; priority: number }> = [
  // ── 차량 ──
  { patterns: ['주유소', '주유', '석유', 'GS칼텍스', 'SK에너지', '오일뱅크', '에스오일'], categoryCode: '0901', priority: 10 },
  { patterns: ['주차', '세차', '카센터', '정비'], categoryCode: '0902', priority: 12 },
  // ── 교통 ──
  { patterns: ['하이패스', '고속도로', '도로공사', '휴게소', '모바일이즐', '이즐'], categoryCode: '0803', priority: 10 },
  { patterns: ['카카오T', '택시', '티머니', '캐시비', '이동의즐거움', '타다'], categoryCode: '0801', priority: 14 },
  { patterns: ['고속버스', '운송사업조합', '지하철', '코레일', 'SRT', '철도', '시외버스'], categoryCode: '0802', priority: 16 },
  // ── 건강 ──
  { patterns: ['약국'], categoryCode: '0702', priority: 14 },
  { patterns: ['의원', '병원', '정형외과', '보건소', '치과', '한의원', '내과', '이비인후과', '클리닉'], categoryCode: '0701', priority: 16 },
  // ── 통신 ──
  { patterns: ['KT통신요금', '통신요금', 'SKT', 'LG유플러스', '유플러스', '알뜰폰', 'SMS이용요금'], categoryCode: '06', priority: 20 },
  // ── 공과금·주거 ──
  { patterns: ['아파트관리비', '관리비'], categoryCode: '0401', priority: 20 },
  { patterns: ['전기요금', '한국전력', '도시가스', '수도요금', '상수도'], categoryCode: '0402', priority: 20 },
  // ── 교육 ──
  { patterns: ['대학서적', '학술정보', '서점', '교보문고', '영풍문고', '알라딘'], categoryCode: '1101', priority: 20 },
  { patterns: ['팬딩', '인프런', '클래스101', '탈잉'], categoryCode: '1102', priority: 22 },
  // ── 여가: 구독·디지털 ──
  { patterns: ['구글페이먼트', '구글플레이', 'GOODNOTES', 'PADDLE', '앱스토어', '넷플릭스', '유튜브', '스포티파이', '스팀'], categoryCode: '1201', priority: 24 },
  { patterns: ['CGV', '롯데시네마', '메가박스', '영화', '노래방', 'PC방', '볼링', '헬스', '필라테스'], categoryCode: '1202', priority: 26 },
  // ── 생활: 생활용품(마트보다 먼저 — 다이소 등) ──
  { patterns: ['다이소', '올리브영', '무인양품', '이케아', '생활용품'], categoryCode: '0504', priority: 30 },
  // ── 생활: 식료품·마트 ──
  {
    patterns: [
      '마트', '이마트', '코스트코', '지에스25', 'GS25', 'CU', '씨유', '세븐일레븐',
      '이마트24', '식자재', '싱싱마트', '식자재마트', '농협하나로', '홈플러스', '롯데마트',
    ],
    categoryCode: '0503',
    priority: 34,
  },
  // ── 생활: 카페·간식 ──
  {
    patterns: [
      '커피', '카페', '스타벅스', '투썸', '이디야', '빽다방', '컴포즈', '메가커피',
      '베이커리', '파리바게', '뚜레쥬르', '도넛', '디저트', '빙수', '떡',
    ],
    categoryCode: '0502',
    priority: 40,
  },
  // ── 생활: 외식(음식점) ──
  {
    patterns: [
      '우아한형제들', '배민', '도시락', '국수', '국밥', '돈불', '칼국수', '피자',
      '버거킹', '롯데리아', '써브웨이', '맘스터치', '냉면', '제면', '순대국', '순대',
      '돌솥밥', '포차', '부안집', '맛찬방', '돈까스', '초밥', '스시', '파스타',
      '김밥', '분식', '치킨', '족발', '곱창', '감자탕', '삼겹', '고기', '밥상', '식당',
    ],
    categoryCode: '0501',
    priority: 50,
  },
  // ── 생활: 기타(미용 등) ──
  { patterns: ['헤어', '미용', '네일', '이발'], categoryCode: '0506', priority: 60 },
];

export const MERCHANT_RULES: MerchantRuleSeed[] = CONTAINS_GROUPS.flatMap((g) =>
  g.patterns.map((pattern) => ({
    pattern,
    matchType: MatchType.CONTAINS,
    categoryCode: g.categoryCode,
    priority: g.priority,
  })),
);
