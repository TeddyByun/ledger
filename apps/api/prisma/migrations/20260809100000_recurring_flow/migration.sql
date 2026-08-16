-- 정기 항목 방향(지출/수입) — 정기수입을 같은 테이블에 담기 위한 구분자
CREATE TYPE "ledger"."RecurringFlow" AS ENUM ('expense', 'income');

ALTER TABLE "ledger"."recurring_expense"
  ADD COLUMN "flow" "ledger"."RecurringFlow" NOT NULL DEFAULT 'expense';

CREATE INDEX "recurring_expense_household_id_flow_idx" ON "ledger"."recurring_expense"("household_id","flow");
