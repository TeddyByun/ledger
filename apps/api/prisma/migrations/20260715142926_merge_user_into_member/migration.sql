-- household_member: 로그인(선택) 필드 추가
ALTER TABLE "household_member"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "role" "MemberRole" NOT NULL DEFAULT 'member',
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "last_login_at" TIMESTAMP(3),
  ADD COLUMN "_legacy_user_id" INTEGER;

-- 기존 User + Membership → household_member 로 이관
INSERT INTO "household_member"
  ("household_id","name","email","password_hash","role","is_active","last_login_at","created_at","is_self","use_yn","sort_order","_legacy_user_id")
SELECT m."household_id", COALESCE(NULLIF(u."display_name",''), u."email"),
       u."email", u."password_hash", m."role", u."is_active", u."last_login_at", u."created_at",
       false, 'Y', 0, u."id"
FROM "user" u JOIN "membership" m ON m."user_id" = u."id";

-- transaction.user_id → member_id
UPDATE "transaction" t SET "user_id" = hm."id"
  FROM "household_member" hm WHERE hm."_legacy_user_id" = t."user_id" AND t."user_id" IS NOT NULL;
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_user_id_fkey";
ALTER TABLE "transaction" RENAME COLUMN "user_id" TO "member_id";
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "household_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 토큰 폐기 후 FK 재지정 (사용자 재로그인)
TRUNCATE "refresh_token";
TRUNCATE "password_reset_token";
ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_user_id_fkey";
DROP INDEX "refresh_token_user_id_idx";
ALTER TABLE "refresh_token" RENAME COLUMN "user_id" TO "member_id";
CREATE INDEX "refresh_token_member_id_idx" ON "refresh_token"("member_id");
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "household_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset_token" DROP CONSTRAINT "password_reset_token_user_id_fkey";
ALTER TABLE "password_reset_token" RENAME COLUMN "user_id" TO "member_id";
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "household_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- email unique
CREATE UNIQUE INDEX "household_member_email_key" ON "household_member"("email");

-- 정리
ALTER TABLE "household_member" DROP COLUMN "_legacy_user_id";
DROP TABLE "membership";
DROP TABLE "user";
