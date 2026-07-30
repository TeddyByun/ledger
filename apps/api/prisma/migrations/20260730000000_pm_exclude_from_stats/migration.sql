-- 결제수단 수입·지출 집계 제외 플래그
ALTER TABLE "ledger"."payment_method" ADD COLUMN "exclude_from_stats" BOOLEAN NOT NULL DEFAULT false;
