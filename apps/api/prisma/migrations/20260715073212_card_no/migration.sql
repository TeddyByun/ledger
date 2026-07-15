-- DropForeignKey
ALTER TABLE "bank_transaction" DROP CONSTRAINT "bank_transaction_household_id_fkey";

-- DropForeignKey
ALTER TABLE "card_statement" DROP CONSTRAINT "card_statement_household_id_fkey";

-- DropForeignKey
ALTER TABLE "card_transaction" DROP CONSTRAINT "card_transaction_household_id_fkey";

-- DropForeignKey
ALTER TABLE "counterparty" DROP CONSTRAINT "counterparty_household_id_fkey";

-- DropForeignKey
ALTER TABLE "import_job" DROP CONSTRAINT "import_job_household_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_method" DROP CONSTRAINT "payment_method_household_id_fkey";

-- DropForeignKey
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_household_id_fkey";

-- AlterTable
ALTER TABLE "card_transaction" ADD COLUMN     "card_no" TEXT;

-- AlterTable
ALTER TABLE "payment_method" ADD COLUMN     "card_no" TEXT;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty" ADD CONSTRAINT "counterparty_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
