/**
 * 시드 스크립트 — 코드성 마스터 데이터 초기화.
 * 실행: pnpm --filter @ledger/api prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_CATEGORIES,
  BANK_TXN_TYPES,
  MERCHANT_RULES,
} from '@ledger/shared';

const prisma = new PrismaClient();

async function main() {
  // 1) 분류 코드 — 부모를 먼저 넣어야 self-FK 충족 (depth 오름차순 정렬)
  for (const c of [...ALL_CATEGORIES].sort((a, b) => a.depth - b.depth)) {
    await prisma.category.upsert({
      where: { code: c.code },
      update: { name: c.name, parentCode: c.parentCode, sortOrder: c.sortOrder },
      create: {
        code: c.code,
        parentCode: c.parentCode,
        name: c.name,
        type: c.type,
        depth: c.depth,
        sortOrder: c.sortOrder,
      },
    });
  }
  console.log(`✔ categories: ${ALL_CATEGORIES.length}`);

  // 2) 은행 거래구분 코드
  for (const t of BANK_TXN_TYPES) {
    await prisma.bankTxnType.upsert({
      where: { code: t.code },
      update: { name: t.name, direction: t.direction },
      create: { code: t.code, name: t.name, direction: t.direction },
    });
  }
  console.log(`✔ bank_txn_types: ${BANK_TXN_TYPES.length}`);

  // 3) 가맹점 자동분류 규칙 (멱등 위해 전체 삭제 후 재삽입)
  await prisma.merchantCategoryMap.deleteMany();
  await prisma.merchantCategoryMap.createMany({
    data: MERCHANT_RULES.map((r) => ({
      pattern: r.pattern,
      matchType: r.matchType,
      categoryCode: r.categoryCode,
      priority: r.priority,
    })),
  });
  console.log(`✔ merchant_rules: ${MERCHANT_RULES.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
