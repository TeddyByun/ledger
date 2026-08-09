-- 결제수단 사용 중지 플래그(false=중지)
ALTER TABLE "ledger"."payment_method" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
