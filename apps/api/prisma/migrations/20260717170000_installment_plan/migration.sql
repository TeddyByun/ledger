-- 할부 원거래 테이블
CREATE TABLE "ledger"."installment_plan" (
  "id" SERIAL PRIMARY KEY,
  "household_id" INTEGER NOT NULL,
  "payment_method_id" INTEGER NOT NULL,
  "card_no" TEXT,
  "merchant_name" TEXT NOT NULL,
  "original_date" DATE NOT NULL,
  "total_amount" DECIMAL(15,2) NOT NULL,
  "total_months" INTEGER NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "installment_plan_household_id_dedup_key_key" ON "ledger"."installment_plan"("household_id","dedup_key");
CREATE INDEX "installment_plan_household_id_idx" ON "ledger"."installment_plan"("household_id");
ALTER TABLE "ledger"."installment_plan" ADD CONSTRAINT "installment_plan_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "ledger"."installment_plan" ADD CONSTRAINT "installment_plan_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "ledger"."payment_method"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- card_transaction → 할부 원거래 참조
ALTER TABLE "ledger"."card_transaction" ADD COLUMN "installment_plan_id" INTEGER;
ALTER TABLE "ledger"."card_transaction" ADD CONSTRAINT "card_transaction_installment_plan_id_fkey" FOREIGN KEY ("installment_plan_id") REFERENCES "ledger"."installment_plan"("id") ON UPDATE CASCADE ON DELETE SET NULL;
