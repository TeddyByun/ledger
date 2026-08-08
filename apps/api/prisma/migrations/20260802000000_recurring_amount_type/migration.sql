-- 정기지출 금액 성격(고정/변동) — 매월 같은 금액인지, 달마다 달라지는지
CREATE TYPE "ledger"."AmountType" AS ENUM ('fixed', 'variable');

ALTER TABLE "ledger"."recurring_expense"
  ADD COLUMN "amount_type" "ledger"."AmountType" NOT NULL DEFAULT 'fixed';
