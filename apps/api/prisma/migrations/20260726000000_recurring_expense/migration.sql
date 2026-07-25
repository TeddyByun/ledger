-- 정기지출(예측 규칙 R4/R6/R7) 테이블
CREATE TYPE "ledger"."RecurringCadence" AS ENUM ('monthly','annual','schedule');
CREATE TYPE "ledger"."RecurringSource" AS ENUM ('auto','manual');

CREATE TABLE "ledger"."recurring_expense" (
  "id" SERIAL PRIMARY KEY,
  "household_id" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "category_code" TEXT NOT NULL,
  "payment_method_id" INTEGER,
  "amount" DECIMAL(15,2) NOT NULL,
  "cadence" "ledger"."RecurringCadence" NOT NULL DEFAULT 'monthly',
  "months" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "start_ym" CHAR(7),
  "end_ym" CHAR(7),
  "day_of_month" INTEGER,
  "match_key" TEXT,
  "source" "ledger"."RecurringSource" NOT NULL DEFAULT 'manual',
  "is_active" "ledger"."YesNo" NOT NULL DEFAULT 'Y',
  "memo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "recurring_expense_household_id_is_active_idx" ON "ledger"."recurring_expense"("household_id","is_active");
CREATE INDEX "recurring_expense_household_id_category_code_idx" ON "ledger"."recurring_expense"("household_id","category_code");
ALTER TABLE "ledger"."recurring_expense" ADD CONSTRAINT "recurring_expense_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "ledger"."recurring_expense" ADD CONSTRAINT "recurring_expense_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "ledger"."category"("code") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "ledger"."recurring_expense" ADD CONSTRAINT "recurring_expense_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "ledger"."payment_method"("id") ON UPDATE CASCADE ON DELETE SET NULL;
