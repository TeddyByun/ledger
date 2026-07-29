-- 전체 운영(플랫폼) 관리자 플래그
ALTER TABLE "ledger"."household_member" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;
