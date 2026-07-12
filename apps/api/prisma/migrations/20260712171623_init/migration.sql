-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "MethodType" AS ENUM ('bank', 'card');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('settled', 'pending', 'info');

-- CreateEnum
CREATE TYPE "ExcludeReason" AS ENUM ('card_settlement', 'self_transfer');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('contains', 'exact', 'regex');

-- CreateEnum
CREATE TYPE "BankTxnDirection" AS ENUM ('in', 'out', 'both');

-- CreateEnum
CREATE TYPE "YesNo" AS ENUM ('Y', 'N');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('queued', 'parsing', 'classifying', 'review', 'completed', 'failed');

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "method_type" "MethodType" NOT NULL,
    "issuer" TEXT,
    "identifier" TEXT,
    "account_no" TEXT,
    "owner" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "code" TEXT NOT NULL,
    "parent_code" TEXT,
    "name" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "depth" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "use_yn" "YesNo" NOT NULL DEFAULT 'Y',

    CONSTRAINT "category_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "counterparty" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,

    CONSTRAINT "counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" SERIAL NOT NULL,
    "type" "TransactionType" NOT NULL,
    "category_code" TEXT NOT NULL,
    "counterparty_id" INTEGER,
    "payment_method_id" INTEGER NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(15,2),
    "transaction_date" DATE NOT NULL,
    "settled_date" DATE,
    "status" "TransactionStatus" NOT NULL DEFAULT 'settled',
    "memo" TEXT,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_txn_type" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "BankTxnDirection",
    "use_yn" "YesNo" NOT NULL DEFAULT 'Y',

    CONSTRAINT "bank_txn_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "bank_transaction" (
    "id" SERIAL NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "txn_at" TIMESTAMP(3) NOT NULL,
    "txn_type_code" TEXT,
    "txn_type_raw" TEXT,
    "counterpart_org" TEXT,
    "description" TEXT,
    "withdrawal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deposit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(15,2),
    "branch" TEXT,
    "transaction_id" INTEGER,
    "is_classified" "YesNo" NOT NULL DEFAULT 'N',
    "exclude_reason" "ExcludeReason",
    "import_batch" TEXT,
    "dedup_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_statement" (
    "id" SERIAL NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "statement_ym" CHAR(7) NOT NULL,
    "billing_date" DATE,
    "settle_account_id" INTEGER,
    "settle_account_raw" TEXT,
    "total_amount" DECIMAL(15,2),
    "lump_sum" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "installment_amt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cash_advance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "card_loan" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "revolving" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "annual_fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "prev_unpaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "late_fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_count" INTEGER,
    "benefit_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit_from" DATE,
    "credit_to" DATE,
    "created_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_transaction" (
    "id" SERIAL NOT NULL,
    "statement_id" INTEGER NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "card_label" TEXT,
    "txn_date" DATE NOT NULL,
    "merchant_name" TEXT NOT NULL,
    "usage_amount" DECIMAL(15,2) NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "installment_period" TEXT,
    "billing_round" TEXT,
    "installment_total_amt" DECIMAL(15,2),
    "benefit_type" TEXT,
    "benefit_rate" DECIMAL(5,2),
    "benefit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "benefit_note" TEXT,
    "region" TEXT,
    "sale_type" TEXT,
    "is_canceled" "YesNo" NOT NULL DEFAULT 'N',
    "balance_after" DECIMAL(15,2),
    "point_name" TEXT,
    "point" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transaction_id" INTEGER,
    "is_classified" "YesNo" NOT NULL DEFAULT 'N',
    "dedup_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_category_map" (
    "id" SERIAL NOT NULL,
    "pattern" TEXT NOT NULL,
    "match_type" "MatchType" NOT NULL DEFAULT 'contains',
    "category_code" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "use_yn" "YesNo" NOT NULL DEFAULT 'Y',

    CONSTRAINT "merchant_category_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_summary" (
    "ym" CHAR(7) NOT NULL,
    "income_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "expense_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "income_count" INTEGER NOT NULL DEFAULT 0,
    "expense_count" INTEGER NOT NULL DEFAULT 0,
    "transfer_excluded" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "card_settle_excluded" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_summary_pkey" PRIMARY KEY ("ym")
);

-- CreateTable
CREATE TABLE "monthly_category_stat" (
    "ym" CHAR(7) NOT NULL,
    "category_code" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tx_count" INTEGER NOT NULL DEFAULT 0,
    "ratio" DECIMAL(5,2),

    CONSTRAINT "monthly_category_stat_pkey" PRIMARY KEY ("ym","category_code")
);

-- CreateTable
CREATE TABLE "monthly_source_stat" (
    "ym" CHAR(7) NOT NULL,
    "counterparty_id" INTEGER NOT NULL,
    "amount_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tx_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "monthly_source_stat_pkey" PRIMARY KEY ("ym","counterparty_id")
);

-- CreateTable
CREATE TABLE "monthly_payment_stat" (
    "ym" CHAR(7) NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "method_type" "MethodType" NOT NULL,
    "income_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "expense_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tx_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "monthly_payment_stat_pkey" PRIMARY KEY ("ym","payment_method_id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'queued',
    "file_key" TEXT NOT NULL,
    "original_name" TEXT,
    "payment_method_id" INTEGER,
    "statement_ym" CHAR(7),
    "parsed_rows" INTEGER NOT NULL DEFAULT 0,
    "classified_rows" INTEGER NOT NULL DEFAULT 0,
    "pending_rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_name_key" ON "payment_method"("name");

-- CreateIndex
CREATE INDEX "category_parent_code_idx" ON "category"("parent_code");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_name_key" ON "counterparty"("name");

-- CreateIndex
CREATE INDEX "transaction_transaction_date_idx" ON "transaction"("transaction_date");

-- CreateIndex
CREATE INDEX "transaction_type_idx" ON "transaction"("type");

-- CreateIndex
CREATE INDEX "transaction_category_code_idx" ON "transaction"("category_code");

-- CreateIndex
CREATE INDEX "transaction_payment_method_id_idx" ON "transaction"("payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_transaction_id_key" ON "bank_transaction"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_dedup_hash_key" ON "bank_transaction"("dedup_hash");

-- CreateIndex
CREATE INDEX "bank_transaction_payment_method_id_idx" ON "bank_transaction"("payment_method_id");

-- CreateIndex
CREATE INDEX "bank_transaction_txn_at_idx" ON "bank_transaction"("txn_at");

-- CreateIndex
CREATE INDEX "bank_transaction_is_classified_idx" ON "bank_transaction"("is_classified");

-- CreateIndex
CREATE UNIQUE INDEX "card_statement_payment_method_id_statement_ym_key" ON "card_statement"("payment_method_id", "statement_ym");

-- CreateIndex
CREATE UNIQUE INDEX "card_transaction_transaction_id_key" ON "card_transaction"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_transaction_dedup_hash_key" ON "card_transaction"("dedup_hash");

-- CreateIndex
CREATE INDEX "card_transaction_statement_id_idx" ON "card_transaction"("statement_id");

-- CreateIndex
CREATE INDEX "card_transaction_payment_method_id_idx" ON "card_transaction"("payment_method_id");

-- CreateIndex
CREATE INDEX "card_transaction_txn_date_idx" ON "card_transaction"("txn_date");

-- CreateIndex
CREATE INDEX "card_transaction_is_classified_idx" ON "card_transaction"("is_classified");

-- CreateIndex
CREATE INDEX "merchant_category_map_priority_idx" ON "merchant_category_map"("priority");

-- CreateIndex
CREATE INDEX "import_job_status_idx" ON "import_job"("status");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "category"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_txn_type_code_fkey" FOREIGN KEY ("txn_type_code") REFERENCES "bank_txn_type"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_settle_account_id_fkey" FOREIGN KEY ("settle_account_id") REFERENCES "payment_method"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "card_statement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_category_map" ADD CONSTRAINT "merchant_category_map_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_category_stat" ADD CONSTRAINT "monthly_category_stat_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_source_stat" ADD CONSTRAINT "monthly_source_stat_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_payment_stat" ADD CONSTRAINT "monthly_payment_stat_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
