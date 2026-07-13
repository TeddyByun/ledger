-- payment_method / counterparty: name 전역 unique → (household_id, name) 복합 unique
DROP INDEX "payment_method_name_key";
DROP INDEX "counterparty_name_key";
DROP INDEX "payment_method_household_id_idx";
DROP INDEX "counterparty_household_id_idx";

-- household_id NOT NULL 승격 (contract)
ALTER TABLE "payment_method"   ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "counterparty"     ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "transaction"      ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "bank_transaction" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "card_statement"   ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "card_transaction" ALTER COLUMN "household_id" SET NOT NULL;
ALTER TABLE "import_job"       ALTER COLUMN "household_id" SET NOT NULL;

-- 복합 unique 인덱스
CREATE UNIQUE INDEX "payment_method_household_id_name_key" ON "payment_method"("household_id", "name");
CREATE UNIQUE INDEX "counterparty_household_id_name_key" ON "counterparty"("household_id", "name");
