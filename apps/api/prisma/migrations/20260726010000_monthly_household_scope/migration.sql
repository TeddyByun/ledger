-- monthly_* 집계 4종을 가구 스코프로: household_id 추가 + PK 재구성 + FK (보안: 교차가구 오염·노출 차단)
-- (테이블은 비어 있어 NOT NULL 추가 안전)

-- monthly_summary
ALTER TABLE "ledger"."monthly_summary" DROP CONSTRAINT "monthly_summary_pkey";
ALTER TABLE "ledger"."monthly_summary" ADD COLUMN "household_id" INTEGER NOT NULL;
ALTER TABLE "ledger"."monthly_summary" ADD CONSTRAINT "monthly_summary_pkey" PRIMARY KEY ("household_id","ym");
ALTER TABLE "ledger"."monthly_summary" ADD CONSTRAINT "monthly_summary_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- monthly_category_stat
ALTER TABLE "ledger"."monthly_category_stat" DROP CONSTRAINT "monthly_category_stat_pkey";
ALTER TABLE "ledger"."monthly_category_stat" ADD COLUMN "household_id" INTEGER NOT NULL;
ALTER TABLE "ledger"."monthly_category_stat" ADD CONSTRAINT "monthly_category_stat_pkey" PRIMARY KEY ("household_id","ym","category_code");
ALTER TABLE "ledger"."monthly_category_stat" ADD CONSTRAINT "monthly_category_stat_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- monthly_source_stat
ALTER TABLE "ledger"."monthly_source_stat" DROP CONSTRAINT "monthly_source_stat_pkey";
ALTER TABLE "ledger"."monthly_source_stat" ADD COLUMN "household_id" INTEGER NOT NULL;
ALTER TABLE "ledger"."monthly_source_stat" ADD CONSTRAINT "monthly_source_stat_pkey" PRIMARY KEY ("household_id","ym","counterparty_id");
ALTER TABLE "ledger"."monthly_source_stat" ADD CONSTRAINT "monthly_source_stat_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- monthly_payment_stat
ALTER TABLE "ledger"."monthly_payment_stat" DROP CONSTRAINT "monthly_payment_stat_pkey";
ALTER TABLE "ledger"."monthly_payment_stat" ADD COLUMN "household_id" INTEGER NOT NULL;
ALTER TABLE "ledger"."monthly_payment_stat" ADD CONSTRAINT "monthly_payment_stat_pkey" PRIMARY KEY ("household_id","ym","payment_method_id");
ALTER TABLE "ledger"."monthly_payment_stat" ADD CONSTRAINT "monthly_payment_stat_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "ledger"."household"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
