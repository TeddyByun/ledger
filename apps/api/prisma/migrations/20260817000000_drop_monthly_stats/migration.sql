-- 저장형 월별 집계 테이블 제거.
-- 모든 화면·API 가 transaction 을 그 자리에서 집계(직접 집계)하도록 통일했다.
-- 저장형 경로는 '분류 제외' 필터가 빠져 값이 부풀려지는 결함이 있었고(감사 #8),
-- 데이터 규모상 직접 집계로 충분해 이중 경로 자체를 없앤다.
DROP TABLE IF EXISTS "ledger"."monthly_category_stat";
DROP TABLE IF EXISTS "ledger"."monthly_source_stat";
DROP TABLE IF EXISTS "ledger"."monthly_payment_stat";
DROP TABLE IF EXISTS "ledger"."monthly_summary";
