# 가계부 API 명세 (v1) — as-built

> **단일 진실원은 코드**. 이 문서는 개요이며, 실제 스펙은 서버 기동 후 자동 생성된다.
> - Swagger UI: `GET /api/v1/docs`
> - OpenAPI JSON: `GET /api/v1/docs-json` (웹·모바일 클라이언트 코드 생성 소스)
>
> 공통: Base URL `/{host}/api/v1`, 인증 `Authorization: Bearer <accessToken>`(refresh 만 httpOnly 쿠키),
> 오류는 `common/filters/all-exceptions.filter.ts` 의 공통 포맷(API_CONVENTIONS_DESIGN §2).
>
> **갱신 기준: 2026-08-17** — `apps/api/src` 컨트롤러 14개(단일 파일 모듈 counterparty 포함) 전수 대조.

---

## 리소스 개요 (as-built)

| 태그 | 경로 | 설명 | 상태 |
|------|------|------|------|
| health | `/health`, `/health/live`, `/health/ready` | 라이브니스/레디니스 | ✅ |
| auth | `/auth` | 회원가입·로그인·refresh 회전·로그아웃·내 정보 | ✅ |
| household | `/household` | 내 가구 + 구성원(가족) CRUD | ✅ |
| admin | `/admin` | **전체 운영 관리자** 전용 — 전 가구 조회·생성·삭제 | ✅ |
| categories | `/categories` | 분류 코드 트리 **CRUD**(관리 화면에서 편집) | ✅ |
| payment-methods | `/payment-methods` | 결제수단(계좌·카드) CRUD + 명세서에서 감지된 카드 | ✅ |
| transactions | `/transactions` | 정규화 거래 CRUD + **통합 목록**(은행+카드) | ✅ |
| bank/card-transactions | `/bank-transactions`, `/card-transactions` | 원천 거래 목록·분류·일괄처리·불일치·엑셀 | ✅ |
| classify-keywords | `/classify-keywords` | 자동분류 키워드(`merchant_category_map`) CRUD | ✅ |
| recurring-expenses | `/recurring-expenses` | 정기지출 CRUD + 추천 | ✅ |
| recurring-incomes | `/recurring-incomes` | 정기수입 CRUD + 추천(정기지출과 동일 테이블·서비스, flow=income) | ✅ |
| statistics | `/stats` | 대시보드·추이·월별 집계·재집계·예상지출 | ✅ |
| imports | `/imports` | 명세서 업로드·잡 상태·미분류 조회 | ✅ |
| counterparties | `/counterparties` | 수입처/거래처 목록·등록(`GET`·`POST`, 단일 파일 모듈) | ✅ (화면 미사용) |

---

## 1. auth

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/auth/signup` | 회원가입(+기본 가구 생성, owner 부여) | ✕ |
| POST | `/auth/login` | 로그인 → Access + Refresh(쿠키) | ✕ |
| POST | `/auth/refresh` | Refresh 회전 → 새 Access | ✕(쿠키/바디) |
| POST | `/auth/logout` | 현재 Refresh 폐기 | ✓ |
| GET | `/auth/me` | 내 프로필 + 가구/역할 + `isSuperAdmin` | ✓ |

> 비밀번호 재설정(`/auth/password/*`)은 **설계만 존재, 미구현** — AUTH_DESIGN §6 참조.

## 2. household (가족 관리)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/household` | 내 가구 정보 + 구성원 요약 |
| PATCH | `/household` | 가구명 변경 |
| GET | `/household/members` | 구성원 목록 |
| POST | `/household/members` | 구성원 추가(로그인 계정 겸용 — email/password 선택) |
| PATCH | `/household/members/:id` | 구성원 수정(이름·관계·역할·활성) |
| DELETE | `/household/members/:id` | 구성원 삭제(비활성) |

## 3. admin (전체 운영 관리자)

`SuperAdminGuard` + 테넌시 스코프 밖 라우트. `household_member.is_super_admin` 만 접근.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/admin/households` | 전 가구 목록(구성원·거래 건수 집계) |
| POST | `/admin/households` | 가구 생성(+선택 초기 owner 계정 동시 생성) |
| PATCH | `/admin/households/:id` | 임의 가구명 변경 |
| DELETE | `/admin/households/:id` | 가구 삭제(하위 데이터 캐스케이드) |
| POST | `/admin/households/:id/members` | 임의 가구에 구성원 추가 |
| PATCH | `/admin/households/:id/members/:mid` | 임의 가구의 구성원 수정 |
| DELETE | `/admin/households/:id/members/:mid` | 임의 가구의 구성원 삭제 |

## 4. categories

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/categories?type=&tree=` | 분류 목록. `tree=true` 면 대/소분류 트리 |
| GET | `/categories/{code}` | 분류 단건 |
| POST | `/categories` | 분류 추가(대/소분류) |
| PATCH | `/categories/{code}` | 이름·정렬·사용여부 수정 |
| DELETE | `/categories/{code}` | 분류 삭제 |

- `type`: `income` | `expense` (선택)
- 트리 응답 노드: `{ code, name, type, depth, sortOrder, children[] }`
- **전역 코드성 모델**(가구 스코프 아님) — 분류 관리 화면의 편집은 전 가구에 영향.

## 5. payment-methods

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/payment-methods?methodType=` | 목록 (`bank`/`card` 필터) |
| GET | `/payment-methods/detected-cards` | 업로드된 명세서에서 감지된 카드 라벨·식별번호(미등록 카드 등록 유도) |
| GET | `/payment-methods/{id}` | 단건 |
| POST | `/payment-methods` | 등록 |
| PATCH | `/payment-methods/{id}` | 수정 |
| DELETE | `/payment-methods/{id}` | 삭제 |

- 바디: `{ name, methodType, issuer?, identifier?, cardNo?, accountNo?, owner?, memo?, excludeFromStats?, isActive? }`
- **`excludeFromStats`**: 켜면 그 결제수단의 거래가 수입·지출 집계에서 빠지고, 자동분류 시 방향별 **'분류 제외'** 로 매핑된다(투자·저축 계좌 등).
- **`isActive`**: `false` 면 사용 중지(더 이상 쓰지 않는 카드·계좌). `excludeFromStats`·`isActive` 는 PATCH 로 토글 가능.

## 6. transactions

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/transactions` | 목록 (필터·검색·정렬·커서/오프셋) |
| GET | `/transactions/summary` | 조회 조건 전체의 수입·지출·건수 합계 |
| GET | `/transactions/unified` | **전체 거래** — 은행+카드 원천을 한 목록으로 병합(화면: 전체 거래) |
| GET | `/transactions/{id}` | 단건 |
| POST | `/transactions` | 등록 |
| PATCH | `/transactions/{id}` | 수정 |
| DELETE | `/transactions/{id}` | 삭제 |

**목록 쿼리**: `type`, `categoryCode`(대분류 지정 시 하위 포함), `categoryCodes`(콤마 다중, `'-'`=미분류), `paymentMethodId`, `paymentMethodIds`(콤마), `methodType`, `from`, `to`(YYYY-MM-DD), `q`, `sort`(`col:dir,col:dir`), `offset`, `limit`(≤100), `cursor`.

**목록 응답**: `{ items[], page: { nextCursor, hasNext } }`(API_CONVENTIONS §3.1) · 합계는 `/summary` 로 분리 조회.
**`/unified` 응답**: `{ items[], summary: { incomeTotal, expenseTotal, net, incomeCount, expenseCount, count } }` — offset/limit 기반.

> 집계·목록에서 **'분류 제외'(18/19) 분류와 `excludeFromStats` 결제수단**은 기본 제외된다(`common/exclude-category.ts`, `common/exclude-payment.ts`).

## 7. bank-transactions / card-transactions (원천 거래)

두 리소스는 대칭 구조다(`statement-txn` 모듈, 컨트롤러 1개).

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/bank-transactions` · `/card-transactions` | 원천 거래 목록(정렬·필터·커서) |
| GET | `…/summary` | 조회 조건 전체 합계 |
| GET | `…/category-conflicts` | **분류 불일치** — 같은 내용(가맹점)이 서로 다른 분류로 잡힌 건 |
| GET | `…/export` | 조회 결과 전체를 **xlsx** 로 내보내기(ExcelJS) |
| POST | `…/auto-classify` | **자동분류 일괄 실행**(§9 규칙) |
| POST | `…/bulk-classify` | 선택 건 일괄 분류 `{ ids[], categoryCode }` |
| POST | `…/bulk-delete` | 선택 건 일괄 삭제 `{ ids[] }` |
| PATCH | `/bank-transactions/{id}` | 은행 거래 1건 분류/수정 |
| GET | `/bank-transactions/types` | 거래구분(`txn_type_raw`) 목록 — 필터용 |

**공통 쿼리(`StatementTxnQueryDto`)**: `paymentMethodId`·`paymentMethodIds`(콤마), `categoryCode`·`categoryCodes`(콤마 다중, `'-'`=미분류), `txnType`·`txnTypes`(콤마 다중), `installment`(`yes`/`no`, 카드), `from`·`to`, `q`, `sort`, `offset`, `limit`(≤100), `cursor`. 다중값 파라미터는 지정 시 단수 파라미터 대신 쓰인다.

**분류 불일치 응답**: 내용(정규화 키)별로 묶어 서로 다른 분류·건수·금액을 반환. 은행은 **방향(출금=지출/입금=수입)이 다르면 별개 그룹**으로 취급한다.

## 8. classify-keywords (자동분류 키워드)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/classify-keywords` | 규칙 목록(우선순위 순) |
| POST | `/classify-keywords` | 규칙 추가 `{ pattern, categoryCode, matchType?, priority? }` |
| PATCH | `/classify-keywords/{id}` | 수정(패턴·분류·우선순위·사용여부) |
| DELETE | `/classify-keywords/{id}` | 삭제 |

- `matchType`: `contains`(기본) · `exact` · `regex`. 매칭 시 **공백 무시**.
- 저장소는 `merchant_category_map`(**전역 코드성**). 변경 시 `ClassifierService` 캐시 무효화.

## 9. 자동분류 규칙 (as-built)

`POST /bank-transactions/auto-classify` · `/card-transactions/auto-classify` 가 수행하는 순서.
**설계 원문(⑤ 규칙 매칭만)보다 확장**되어 있다.

```
0) 선(先) 제외 매핑
   · excludeFromStats 결제수단     → 방향별 '분류 제외'(18/19)
   · 카드대금 결제 출금(구분에 '카드') → '지출 분류 제외'
   · 자기이체(동일 금액·동일 날짜·본인 명의 계좌 쌍) → 출금 18 / 입금 19
1) 정기지출 매칭   관리>정기지출의 match_key(또는 label 정규화)가 내용에 포함 → 그 분류
2) 이력 학습       과거 같은 내용(방향별)의 최신 분류를 그대로 적용 (exact → fuzzy)
3) 키워드 규칙     merchant_category_map (우선순위 오름차순)
4) 잔여 당행송금   위 1~3 에 안 걸린 '당행송금' → exclude_reason='transfer'
5) 영향 월 rebuild
```

- **우선순위 원칙**: 명시적 분류 신호(정기지출·이력·키워드)가 당행송금 제외보다 **우선**한다. 이미 `transfer` 로 제외된 행도 재분류 대상에 포함(키워드 등록 후 소급 반영).
- **카드**: 취소·환불행(`is_canceled='Y'`)과 0원·음수 조정행도 **금액 제한 없이** 분류한다(환불은 해당 분류에서 차감).
- 응답: `{ classifiedByRecurring, classifiedByHistory, classifiedByRule, excludedTransfer?, classifiedCardSettlement?, classifiedSelfTransfer?, remaining }`

## 10. recurring-expenses (정기지출)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/recurring-expenses` | 목록 |
| GET | `/recurring-expenses/suggestions` | **추천** — 과거 거래에서 반복 패턴 탐지(`recurringKey` 그룹화) |
| POST | `/recurring-expenses` | 등록 |
| PATCH | `/recurring-expenses/{id}` | 수정(금액·주기·만기·활성) |
| DELETE | `/recurring-expenses/{id}` | 삭제 |

- 바디: `{ label, categoryCode, paymentMethodId?, amount, amountType(fixed|variable), cadence(monthly|annual|schedule), months?[], startYm?, endYm?, dayOfMonth?, matchKey?, source?, memo?, isActive? }`
- `isActive='Y'` 인 항목만 예측(`/stats/forecast`)·자동분류에 쓰인다. 상세 규칙은 EXPENSE_FORECAST_DESIGN §4.

## 10.1 recurring-incomes (정기수입)

`/recurring-expenses` 와 **대칭** — 같은 테이블(`recurring_expense.flow='income'`)·같은 서비스(`RecurringExpenseService`/`SuggestionService`)를 방향만 수입으로 고정해 공유한다.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/recurring-incomes` | 목록(이번 달 입금 발생 상태 포함) |
| GET | `/recurring-incomes/suggestions` | **추천** — 수입 거래 이력에서 반복 패턴 탐지(미등록만) |
| POST | `/recurring-incomes` | 등록(추천 확정 또는 수기) |
| PATCH | `/recurring-incomes/{id}` | 수정(금액·만기·활성 토글 등) |
| DELETE | `/recurring-incomes/{id}` | 삭제 |

- 바디는 정기지출과 동일(`Create/UpdateRecurringExpenseDto`). 추천은 **수입** 거래 이력에서 뽑고, 목록은 이번 달 입금 발생 상태를 계산한다.
- `/stats/cashflow` 의 예상 수입은 이 등록 정기수입을 기준으로 산정된다.

## 11. statistics

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/stats/dashboard?year=` | **월별 거래 추이** 화면 — 올해 월별 계좌/카드/대분류 집계 |
| GET | `/stats/monthly-trend?from=&to=` | 월별 수입·지출 추이(+대분류 구성·결제수단별 지출). 기본 올해 |
| GET | `/stats/payment-trend?from=&to=` | **월별 결제수단별 지출 추이**. 기본 올해 |
| GET | `/stats/cashflow?ym=&accountId=&ignoreActual=` | **예상 수입·지출 + 일자별 잔액**(은행 기준, 카드는 전월 이용액→카드대금). 등록 정기수입·정기지출 기반 계획 vs 실제 대조, 자기이체 제외 |
| GET | `/stats/forecast?ym=` | **예상 지출**(규칙 엔진 — fixed/util/event/var 버킷, 소비 시점 기준) |
| GET | `/stats/monthly?ym=` \| `?recent=` | 월 전체 요약(미지정 시 최근 N개월) |
| GET | `/stats/monthly/category?ym=&type=` | 월 × 분류별 |
| GET | `/stats/monthly/source?ym=` | 월 × 수입처별 |
| GET | `/stats/monthly/payment?ym=&methodType=` | 월 × 결제수단별 |
| POST | `/stats/monthly/{ym}/rebuild` | 월 요약 재집계 |

- `from`/`to` 형식은 `YYYY-MM`(양끝 포함), 뒤집혀 오면 교환, 최대 60개월로 절단.
- **추이·대시보드는 `transaction` 에서 직접 집계**(항상 최신), `monthly_*` 테이블은 요약 조회용.
- 집계는 `settled` + 금액 존재 거래만. '분류 제외' 분류·집계제외 결제수단은 빠진다.
- `/stats/cashflow`: `accountId`(기준 은행 계좌, 미지정 시 거래 최다 주 거래 계좌), `ignoreActual`(1이면 실적 무시·월 전체 예측 — 예측 정확도 검증용). 규칙(C1~C8)·응답 구조는 EXPENSE_FORECAST_DESIGN §10.

## 12. imports (명세서 자동 입력)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/imports` | 명세서 파일 업로드(multipart) → 적재 잡 생성 |
| GET | `/imports` | 업로드 이력 목록 |
| GET | `/imports/{jobId}` | 잡 진행 상태 폴링 |
| GET | `/imports/{jobId}/pending` | 미분류(검토 대기) 건 조회 |

- 업로드: `multipart/form-data` — `issuer`(하나은행/하나·현대·신한·삼성카드), `paymentMethodId?`, `file`(xlsx/csv).
- `status`: `queued → parsing → classifying → review → completed`(또는 `failed`).
- 업로드 시 자동분류·대사(§9 의 0~3단계)와 월 재집계까지 수행된다.

---

## 클라이언트 코드 생성

```bash
curl http://localhost:4000/api/v1/docs-json > openapi.json
npx openapi-typescript openapi.json -o packages/api-client/src/schema.ts
```

> ⚠️ **as-built**: `packages/api-client` 생성 파이프라인은 아직 도입 전이다.
> 현재 웹은 `apps/web/src/lib/api.ts` 의 수기 fetch 래퍼 + `lib/types.ts` 의 수기 타입을 쓴다.
