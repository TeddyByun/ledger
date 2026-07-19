import type { PrismaService } from '../prisma/prisma.service.js';

/** 집계에서 빼는 '집계제외' 분류의 이름. 사용자가 분류 관리에서 만든 특수 분류. */
export const EXCLUDE_CATEGORY_NAME = '집계제외';

/**
 * '분류제외'(집계 제외용) 분류의 코드 목록 — 대분류 + 소분류.
 * 전체 거래 목록·합계·대시보드 집계에서 이 분류의 거래를 숨기는 데 쓴다.
 * (Category 는 전역 코드성 모델이라 테넌트 스코프 대상 아님)
 */
export async function excludeCategoryCodes(prisma: PrismaService): Promise<string[]> {
  const roots = await prisma.category.findMany({
    where: { name: EXCLUDE_CATEGORY_NAME },
    select: { code: true },
  });
  if (roots.length === 0) return [];
  const codes = roots.map((r) => r.code);
  const children = await prisma.category.findMany({
    where: { parentCode: { in: codes } },
    select: { code: true },
  });
  return [...codes, ...children.map((c) => c.code)];
}
