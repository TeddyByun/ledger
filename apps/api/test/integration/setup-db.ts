/**
 * 통합/e2e 테스트 간 격리 — 각 테스트 전에 도메인 테이블만 truncate 한다.
 * 코드성 마스터(category / bank_txn_type / merchant_category_map)는 시드 상태를
 * 유지해 매 테스트마다 재시드하지 않는다. (TEST_STRATEGY_DESIGN.md §3)
 */
import { PrismaClient } from '@prisma/client';

/** truncate 대상 — 자식 → 부모 순서. CASCADE 를 쓰므로 순서 자체는 보험이다. */
const DOMAIN_TABLES = [
  'installment_plan',
  'card_transaction',
  'card_statement',
  'bank_transaction',
  'transaction',
  'recurring_expense',
  'import_job',
  'counterparty',
  'payment_method',
  'refresh_token',
  'password_reset_token',
  'household_member',
  'household',
] as const;

/** 코드성 마스터 — truncate 하지 않는다. */
export const CODE_TABLES = ['category', 'bank_txn_type', 'merchant_category_map'] as const;

export const prisma = new PrismaClient();

export async function truncateDomainTables(): Promise<void> {
  const list = DOMAIN_TABLES.map((t) => `"ledger"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateDomainTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});
