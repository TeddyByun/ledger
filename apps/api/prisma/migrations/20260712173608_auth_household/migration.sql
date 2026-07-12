-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'member', 'viewer');

-- AlterTable
ALTER TABLE "bank_transaction" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "card_statement" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "card_transaction" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "counterparty" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "import_job" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "payment_method" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "household_id" INTEGER;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "household" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "household_id" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_household_id_idx" ON "membership"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_user_id_household_id_key" ON "membership"("user_id", "household_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE INDEX "bank_transaction_household_id_idx" ON "bank_transaction"("household_id");

-- CreateIndex
CREATE INDEX "card_statement_household_id_idx" ON "card_statement"("household_id");

-- CreateIndex
CREATE INDEX "card_transaction_household_id_idx" ON "card_transaction"("household_id");

-- CreateIndex
CREATE INDEX "counterparty_household_id_idx" ON "counterparty"("household_id");

-- CreateIndex
CREATE INDEX "import_job_household_id_idx" ON "import_job"("household_id");

-- CreateIndex
CREATE INDEX "payment_method_household_id_idx" ON "payment_method"("household_id");

-- CreateIndex
CREATE INDEX "transaction_household_id_transaction_date_idx" ON "transaction"("household_id", "transaction_date");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty" ADD CONSTRAINT "counterparty_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;
