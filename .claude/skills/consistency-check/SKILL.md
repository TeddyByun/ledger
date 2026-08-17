---
name: consistency-check
description: "가계부(Ledger)를 완성하거나 수정한 뒤 논리적 모순·계산 오류·미흡한 처리를 찾아내는 검증 절차. 4계층(자동 검사 → 계약 일치 → 도메인 불변식 → 사용자 시나리오)으로 나눠, 이 서비스 고유의 불변식(이중 계상 금지, 잔액 연속성, 합계 일치, 시간축·시간대, 멱등성, 상태 정합성)을 SQL·API 교차 검증으로 확인한다. 변경 종류별 영향 매트릭스, 실행 가능한 검증 명령, 판정 기준과 리포트 양식 포함. 기능 완성·수정 직후, 배포 전, '검증해줘'·'모순 없는지 봐줘'·'숫자가 이상해', 집계·예측·분류 로직 변경, 스키마 변경 시 사용."
---

# 논리 검증 (모순 · 오류 · 미흡) — Ledger

> 목적: **"돌아간다"가 아니라 "숫자와 규칙이 서로 어긋나지 않는다"를 확인**한다.
> 이 서비스의 버그는 대부분 크래시가 아니라 **조용한 금액 오류**로 나타난다.

---

## 0. 검증 4계층 (아래로 갈수록 비싸다 — 반드시 순서대로)

```
L0 자동 검사     typecheck · build · test          — 2분, 무조건 통과해야 다음으로
L1 계약 일치     코드 ↔ API ↔ 화면 ↔ 설계 문서      — 필드·라우트·규칙이 서로 같은 말을 하는가
L2 도메인 불변식  SQL ↔ API 교차 검증               — 숫자가 서로 맞는가 (핵심)
L3 시나리오      사용자 여정 · 과거 데이터 백테스트   — 실제로 쓸 때 말이 되는가
```

**L2가 이 스킬의 본체다.** L0/L1만 통과하고 배포하면 "화면은 뜨는데 금액이 틀린" 상태가 된다.

---

## 1. L0 — 자동 검사

```bash
cd /home/coder/ledger
pnpm -r typecheck                      # 타입 = 최소한의 계약
pnpm --filter @ledger/api test         # 단위(파서·스키마 규칙)
pnpm --filter @ledger/api build && pnpm --filter @ledger/web build
```
실패하면 여기서 멈춘다. 아래 계층은 의미 없다.

---

## 2. L1 — 계약 일치 (코드 ↔ API ↔ 화면 ↔ 문서)

### 2-1. 라우트 ↔ 문서
```bash
# 실제 라우트 목록
for f in $(find apps/api/src -name "*.controller.ts"); do
  grep -HnE "@(Get|Post|Patch|Delete)\(" $f; done | sed 's/.*@/@/' | sort | uniq -c
# 문서에 없는 라우트 / 문서에만 있는 라우트 대조
grep -n "GET \|POST \|PATCH \|DELETE " design/API_SPEC.md
```
- [ ] 새 엔드포인트가 `design/API_SPEC.md` 에 있나
- [ ] 삭제·개명된 엔드포인트가 문서에 남아 있지 않나

### 2-2. 응답 키 ↔ 프론트 인터페이스
프론트는 수기 타입(`apps/web/src/lib/types.ts`, 각 view 의 `interface`)이라 **컴파일러가 서버 응답 변화를 잡아주지 못한다.**
```bash
T=$(curl -s -X POST localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
    -d '{"email":"<계정>","password":"<비번>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s "localhost:4000/api/v1/stats/cashflow?ym=$(date +%Y-%m)" -H "authorization: Bearer $T" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(sorted(d.keys()))"
```
- [ ] 위 키 목록이 화면의 `interface` 와 일치하나 (누락 키는 `undefined` → 화면에 조용히 `NaN`·빈칸)
- [ ] 옵셔널이 아닌 필드가 실제로 항상 오나

### 2-3. 같은 규칙이 여러 곳에 복제돼 있지 않나 (모순의 최대 원인)
이 프로젝트에서 **한 규칙이 3곳에 흩어져 있는 지점들** — 하나만 고치면 즉시 모순이 생긴다.

| 규칙 | 있는 곳 |
|------|---------|
| 정기지출 적용 창(`start_ym ≤ 대상월 ≤ end_ym`, 주기 판정) | `recurring-expense.service`(상태) · `forecast.service` · `cashflow.service` |
| 집계 제외(분류 18/19 + `exclude_from_stats`) | `common/exclude-category.ts` · `common/exclude-payment.ts` 를 쓰는 **모든** 서비스 |
| 카드 금액 정의(`principal + fee`) | 적재 · 통계 · 예측 |
| 반복 매칭 키 | `common/fuzzy-key.ts`(`recurringKey`) — 추천·자동분류·예측이 **같은 함수**를 써야 함 |

```bash
git grep -n "startYm\|endYm" -- apps/api/src | grep -i "cmpYm\|inWindow"   # 창 규칙 3곳 비교
git grep -n "excludeCategoryCodes\|excludedPaymentMethodIds" -- apps/api/src
git grep -n "recurringKey\|fuzzyKey" -- apps/api/src
```
- [ ] 세 곳의 창 판정 로직이 **문자 그대로 같은가**
- [ ] 새로 만든 집계 경로가 제외 헬퍼를 쓰나 (전례: `rebuild()` 만 제외 필터가 없어 이중 계상)

---

## 3. L2 — 도메인 불변식 (핵심)

각 항목은 **"이 등식이 깨지면 버그"** 라는 형태로 쓴다. 하나씩 실제로 계산해 확인한다.

### I1. 이중 계상 금지
> 같은 돈이 두 번 지출로 잡히면 안 된다.

| 쌍 | 규칙 |
|----|------|
| 카드 이용액 ↔ 카드대금 은행 출금 | **명세서를 올린 카드**에 한해: 실지출은 카드 건별만, 은행의 카드대금 출금은 '지출 분류 제외'. → **예외는 아래 참조** |
| 자기이체 출금 ↔ 입금 | 가구 집계에선 **양쪽 모두 제외**. 계좌 1개 기준 현금흐름에선 **양쪽 모두 포함**(잔액이 실제로 변하므로) |
| 정기지출 등록분 ↔ 자동 탐지분 | 같은 항목이 두 줄로 나오면 안 됨(토큰 매칭으로 제외) |
| 이름만 바뀐 반복 항목(`대출금`→`집대출`) | 옛 이름은 **최근 3개월 미발생이면 예측 제외** |

> ⚠️ **의도된 예외 — 명세서를 올릴 수 없는 카드(가족 카드 등)**
> 그 카드는 건별 이용내역이 아예 없으므로 **카드대금 출금 자체가 유일한 지출 기록**이다.
> 이런 행은 '분류 제외'가 아니라 **실제 분류**(예: 온라인쇼핑·마트)를 붙이는 것이 정상이며,
> 이중 계상이 아니다(대응하는 카드 건별 데이터가 존재하지 않으므로).
> → 따라서 "카드대금 출금 = 무조건 분류 제외"로 검사하면 **오탐**이 난다. 아래처럼 명세서와 매칭해서 본다.

```sql
-- 카드대금 출금 ↔ 명세서 청구액 매칭
--   · '명세서 있음' 인데 실분류 → 🔴 이중 계상 (진짜 위반)
--   · '명세서 없음' 의 분류 상태 → ℹ️ 의도 확인용(가족 카드 등은 실분류가 정상)
WITH settle AS (
  SELECT b.id, to_char(b.txn_at,'YYYY-MM') ym, b.description issuer, round(b.withdrawal) amt, c.name cat
  FROM ledger.bank_transaction b
  LEFT JOIN ledger.transaction t ON t.id=b.transaction_id
  LEFT JOIN ledger.category c ON c.code=t.category_code
  WHERE b.withdrawal>0 AND b.txn_type_raw LIKE '%카드%'
), stmt AS (
  SELECT s.statement_ym ym, p.issuer, round(s.total_amount) amt
  FROM ledger.card_statement s JOIN ledger.payment_method p ON p.id=s.payment_method_id
  WHERE s.total_amount IS NOT NULL
)
SELECT CASE WHEN st.amt IS NOT NULL THEN '명세서 있음' ELSE '명세서 없음' END 구분,
       coalesce(se.cat,'(미분류)') 분류, count(*) 건, round(sum(se.amt)) 금액
FROM settle se LEFT JOIN stmt st ON st.ym=se.ym AND st.issuer=se.issuer AND st.amt=se.amt
GROUP BY 1,2 ORDER BY 1,4 DESC;
-- 위반 판정: '명세서 있음' 행 중 분류가 '지출 분류 제외' 가 아닌 것
```

> **검증 기록(2026-08-02)**: '명세서 있음' 13건 전부 '지출 분류 제외' → 위반 0건 ✅
> '명세서 없음' 중 온라인쇼핑·마트 14건(7,875,976원)은 **가족 카드 대금으로 의도된 분류**.

### I2. 합계 일치
```
① cashflow:  opening + Σ(daily[].net) == closing
② cashflow:  Σ(daily[].income) == income.total,  Σ(daily[].expense) == expense.total
③ forecast:  abc.A + abc.B + abc.C == total (반올림 오차 ±범위 내)
④ 목록 ↔ 요약: /transactions 전체 합 == /transactions/summary
⑤ 집계 테이블 ↔ 거래: monthly_summary(ym) == transaction 직접 집계(같은 제외 규칙 적용)
⑥ 화면 간: 월별 거래 추이의 월 지출 == 결제수단별 추이의 월 합계
```
```bash
# ①②를 실제 응답으로 검산
curl -s "localhost:4000/api/v1/stats/cashflow?ym=2026-08" -H "authorization: Bearer $T" | python3 -c "
import sys,json; d=json.load(sys.stdin)
o=d['opening']['balance']; net=sum(x['net'] for x in d['daily'])
inc=sum(x['income'] for x in d['daily']); exp=sum(x['expense'] for x in d['daily'])
print('① opening+Σnet == closing :', o+net == d['closing']['balance'], o+net, d['closing']['balance'])
print('② Σincome == income.total :', inc == d['income']['total'], inc, d['income']['total'])
print('② Σexpense == expense.total:', exp == d['expense']['total'], exp, d['expense']['total'])
"
```

### I3. 잔액 연속성
```
직전 행 balance ± (deposit - withdrawal) == 현재 행 balance   (은행 원천, balance NULL 제외)
```
```sql
WITH x AS (
  SELECT payment_method_id pm, txn_at, id, balance, deposit, withdrawal,
         LAG(balance) OVER (PARTITION BY payment_method_id ORDER BY txn_at, id) prev
  FROM ledger.bank_transaction WHERE balance IS NOT NULL
)
SELECT pm, txn_at::date, prev, balance, (prev + deposit - withdrawal) expected
FROM x WHERE prev IS NOT NULL AND prev + deposit - withdrawal <> balance
ORDER BY txn_at LIMIT 20;   -- 결과가 있으면 누락/중복 적재 의심
```

### I4. 시간축 · 시간대
- [ ] 카드 거래: `transaction_date`=**이용일**, `settled_date`=**결제일**. 월 집계 기본축은 이용일
- [ ] '이번 달'·'오늘'을 **KST 기준**으로 계산하나 (전례: UTC 기준이라 KST 00~09시에 지난달로 동작)
- [ ] 월 경계 쿼리가 `gte 1일 00:00 / lt 익월 1일`(반열린 구간)인가 — `lte 말일`은 말일 시간분을 누락
```bash
git grep -n "getUTCMonth\|getUTCDate\|toISOString" -- apps/api/src | grep -v "\.spec\." | head -20
TZ=UTC date; TZ=Asia/Seoul date      # 두 기준의 '오늘'이 다른 시간대인지 인지
```

### I5. 멱등성 (같은 작업을 두 번 해도 결과가 같아야)
- [ ] **같은 명세서 재업로드** → `bank_transaction`/`card_transaction` 건수 불변 (dedupHash)
- [ ] **자동분류 재실행** → 새 `transaction` 이 생기지 않음(이미 분류된 건 건너뜀)
- [ ] **`rebuild(ym)` 2회 실행** → `monthly_*` 결과 동일
```sql
-- dedup 유일성 실제 확인
SELECT household_id, dedup_hash, count(*) FROM ledger.bank_transaction
GROUP BY 1,2 HAVING count(*)>1;      -- 기대: 0행
SELECT household_id, dedup_hash, count(*) FROM ledger.card_transaction
GROUP BY 1,2 HAVING count(*)>1;      -- 기대: 0행
```

### I6. 상태 정합성 (모순된 조합이 DB에 없어야)
```sql
-- 분류됐는데 플래그가 N / 연결 없는데 Y
SELECT count(*) FROM ledger.bank_transaction WHERE transaction_id IS NOT NULL AND is_classified='N';
SELECT count(*) FROM ledger.bank_transaction WHERE transaction_id IS NULL AND is_classified='Y' AND exclude_reason IS NULL;
-- 고아 거래(원천에서 끊긴 거래)
SELECT count(*) FROM ledger.transaction t
LEFT JOIN ledger.bank_transaction b ON b.transaction_id=t.id
LEFT JOIN ledger.card_transaction c ON c.transaction_id=t.id
WHERE b.id IS NULL AND c.id IS NULL;   -- 수기 입력분만 남아야 함
-- 존재하지 않는 분류 참조
SELECT count(*) FROM ledger.transaction t
LEFT JOIN ledger.category c ON c.code=t.category_code WHERE c.code IS NULL;   -- 기대: 0
```

### I7. 예측 규칙의 자기모순
- [ ] 예측 라인의 근거(`basis`)가 **실제 계산 방식과 일치**하나 (근거는 '전월 이용액'인데 코드는 평균을 쓰는 식의 불일치)
- [ ] 같은 항목이 **수입과 지출 양쪽**에 잡히지 않나
- [ ] 만기(`end_ym`) 지난 항목이 예측에 남아 있지 않나
- [ ] 신뢰도(high/med/low)가 표본 수와 모순되지 않나(표본 2개월인데 '높음')

---

## 4. L3 — 시나리오 · 백테스트

### 4-1. 과거 데이터로 예측 검증 (숫자가 말이 되는지)
```bash
# 실적을 무시하고 그 달 이전 데이터만으로 예측 → 실제와 비교
for M in 2026-05 2026-06 2026-07; do
  curl -s "localhost:4000/api/v1/stats/cashflow?ym=$M&accountId=12&ignoreActual=1" -H "authorization: Bearer $T" \
  | python3 -c "
import sys,json; d=json.load(sys.stdin); o=d['opening']['balance']
pi,pe,ai,ae=d['income']['predicted'],d['expense']['predicted'],d['income']['actual'],d['expense']['actual']
print(f\"{d['ym']} 월말 예측 {o+pi-pe:,} / 실제 {o+ai-ae:,} / 차 {(pi-pe)-(ai-ae):+,}\")"
done
```
- [ ] 오차가 **커진 방향으로 회귀**하지 않았나(직전 검증값과 비교 — 아래 표에 기록)
- [ ] 오차가 큰 달은 **원인이 설명되나**(설명 못 하면 규칙 결함)

### 4-2. 사용자 여정 점검 (화면을 실제로 따라간다)
```
업로드 → 자동분류 → 분류 불일치 교정 → 전체 거래 합계 → 월별 추이 → 예상 수입·지출
```
각 단계에서:
- [ ] 앞 화면의 숫자가 뒤 화면과 **같은가**(다르면 어느 쪽이 맞는지 판정할 것)
- [ ] 빈 상태(데이터 0건)·에러·로딩이 각각 처리되나
- [ ] 되돌리기 불가능한 동작(일괄 삭제)에 확인 절차가 있나
- [ ] 필터를 걸었을 때 합계도 **필터 기준으로** 바뀌나(전체 합계를 그대로 두면 모순)

### 4-3. 경계값
| 경계 | 확인 |
|------|------|
| 금액 0 · 음수(환불) | 집계에서 차감되나, 절댓값으로 더해지지 않나 |
| 월말(31일 없는 달) | `dayOfMonth=31` 인 정기지출이 2월에 어떻게 되나(말일로 클램프) |
| 데이터 0건 | 신규 가구 로그인 시 모든 화면이 빈 상태로 뜨나(500 아님) |
| 이력 1개월뿐 | 예측이 표본 부족을 표시하나(중앙값·평균이 폭주하지 않나) |
| 미래 월 조회 | 실적 0 + 전량 예측으로 동작하나 |

---

## 5. 변경 영향 매트릭스 (무엇을 고쳤으면 무엇을 다시 볼 것인가)

| 변경한 것 | 반드시 재검증 |
|-----------|--------------|
| 분류 체계·제외 규칙 | I1, I2⑤⑥, `rebuild` 재계산, 대시보드/추이/전체 거래 합계 |
| 자동분류 규칙 | I1, I5(재실행 멱등), 분류 불일치 목록, 미분류 잔여 건수 |
| 파서·적재 | I3(잔액 연속성), I5(dedup), I6(상태), 카드 명세서 총액 == 건별 합 |
| 집계·통계 | I2 전체, 화면 간 교차(4-2) |
| 예측(forecast/cashflow) | I2①②③, I7, L3 백테스트 3개월 |
| 정기지출 모델 | L1 2-3(창 규칙 3곳), I7, 만기/주기 경계값 |
| 스키마·마이그레이션 | I6, `pnpm prisma migrate deploy` 후 전 화면 스모크, 롤백 경로 확인 |
| 프론트 화면 | L1 2-2(응답 키), 4-2 여정, 4-3 빈/에러 상태 |

---

## 6. 판정 · 리포트 양식

```markdown
## 검증 리포트 — <기능/변경> · <날짜>

| 계층 | 결과 | 비고 |
|------|------|------|
| L0 자동 | ✅ / ❌ | typecheck·test·build |
| L1 계약 | ✅ / ⚠️ | 문서 미갱신 N건 |
| L2 불변식 | ✅ / ❌ | I1~I7 중 위반 N건 |
| L3 시나리오 | ✅ / ⚠️ | 백테스트 오차 X% |

### 발견
| # | 계층 | 유형(모순/오류/미흡) | 내용 | 근거(수치·쿼리) | 조치 |
|---|------|---------------------|------|----------------|------|
| 1 | L2 | 오류 | 6월 지출 합계가 API와 SQL 간 12,000원 차이 | `SELECT …` 결과 vs `/stats/monthly` | 수정함 / 백로그 |

### 판정
- **통과**: L0·L2 전부 통과, L1·L3 경미 사항만
- **조건부**: 금액에 영향 없는 미흡만 남음 → 백로그 등록 후 배포
- **실패**: 불변식 위반 또는 금액 오차 → 배포 금지
```

**유형 구분**
- **모순**: 두 곳이 서로 다른 답을 낸다(A화면 100만, B화면 95만) → 어느 쪽이 옳은지 먼저 정한다
- **오류**: 정답이 있는데 틀렸다(합계 계산 실수)
- **미흡**: 틀리진 않았으나 처리가 없다(빈 상태 미처리, 근거 미표시, 경계값 미정의)

---

## 7. 원칙

1. **숫자로 증명한다.** "맞는 것 같다"는 검증이 아니다. 쿼리 결과나 응답값을 붙인다.
2. **모순은 반드시 한쪽을 틀렸다고 판정한다.** 양쪽 다 살려두면 다음에 또 만난다.
3. **못 고친 것은 반드시 남긴다.** 조용히 넘어간 미흡이 다음 달의 '숫자가 이상해'가 된다.
4. **검증 결과를 설계 문서에 반영한다.** 규칙이 바뀌었으면 `design/` 의 해당 절을 같은 커밋에서 갱신.
5. **직전 검증값과 비교한다.** 백테스트 오차 같은 지표는 절대값보다 **회귀 여부**가 중요하다.
6. **위반이 나오면 먼저 "의도된 설계인가"를 사용자에게 확인한다.** 불변식은 도메인 지식의 근사치라
   완전하지 않다. 확인 결과 정상이면 **불변식을 그때 정교하게 고치고 예외를 문서에 남긴다**
   (같은 오탐을 다음 검증에서 또 만나지 않도록). 실제로 I1이 이 과정을 거쳐 다듬어졌다.

### 검증 이력 (갱신하며 사용)

| 날짜 | 대상 | 백테스트 오차(하나은행47307 월말 잔액) | 비고 |
|------|------|------------------------------------|------|
| 2026-08-02 | cashflow 최초 | 5월 −234K(0.6%) · 6월 −395K(1.0%) | 일할 분산 포함 |
| 2026-08-02 | 일할 분산 제거 후 | 6월 **−126K(0.3%)** · 7월 −11.3M(이례적 입금) | 정확도 개선 확인 |
