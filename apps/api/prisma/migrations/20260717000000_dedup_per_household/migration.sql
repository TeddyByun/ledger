-- dedup_hash: 전역 unique → 가구별 unique (같은 명세서를 다른 가구가 올려도 충돌 없음)
DROP INDEX IF EXISTS "ledger"."bank_transaction_dedup_hash_key";
DROP INDEX IF EXISTS "ledger"."card_transaction_dedup_hash_key";

CREATE UNIQUE INDEX "bank_transaction_household_id_dedup_hash_key"
  ON "ledger"."bank_transaction" ("household_id", "dedup_hash");
CREATE UNIQUE INDEX "card_transaction_household_id_dedup_hash_key"
  ON "ledger"."card_transaction" ("household_id", "dedup_hash");
