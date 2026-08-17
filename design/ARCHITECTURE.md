# 가계부 서비스 아키텍처 설계서

> 전략: **1단계 웹 서비스 → 2단계 모바일 앱**. 처음부터 **API-First**로 설계해 동일 백엔드를 웹·모바일이 공유한다.
>
> **확정 사항**: 백엔드 = **NestJS(TypeScript)**, 명세서 입력 = **Excel/CSV 우선**(파서는 Node 내장, Python 분리 불필요). → 풀스택 TypeScript 모노레포로 진행.

---

## 1. 설계 원칙 (Architecture Principles)

| 원칙 | 내용 |
|------|------|
| **API-First** | 모든 기능은 백엔드 REST API로 노출. 웹은 첫 번째 API 소비자일 뿐, 모바일도 동일 API 사용 → 비즈니스 로직 재구현 0. |
| **클라이언트-서버 분리** | 화면(프론트)과 도메인 로직(백엔드)을 분리. UI 기술이 바뀌어도 백엔드 불변. |
| **모듈형 도메인** | 거래·분류·통계·적재(ingestion)를 독립 모듈로. 초기엔 단일 배포(모놀리식)지만 모듈 경계는 명확히. |
| **적재 파이프라인 1급 설계** | 명세서 업로드→파싱→정규화→자동분류가 핵심 가치 → 비동기 파이프라인으로 별도 설계. |
| **타입 일관성** | 웹·모바일·백엔드가 동일 데이터 타입/계약 공유 → 변경 시 컴파일 단계에서 불일치 검출. |
| **점진적 확장** | 모놀리식으로 시작, 부하·복잡도가 커지는 지점(파서 등)만 서비스 분리. |

---

## 2. 전체 구조 (High-Level)

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                              │
│   ┌──────────────┐         ┌──────────────────────────┐     │
│   │  Web (SPA)   │  1단계  │  Mobile App (2단계)       │     │
│   │ React/Next   │         │  React Native (Expo)      │     │
│   └──────┬───────┘         └────────────┬─────────────┘     │
│          │       동일 REST/JSON API      │                   │
└──────────┼──────────────────────────────┼───────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  API Gateway / BFF (선택)                    │
│           인증 · 라우팅 · Rate Limit · CORS                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Application)                    │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Auth    │ │Transaction│ │Category │ │ Statistics      │   │
│  │ 인증/계정│ │ 거래 CRUD │ │ 분류코드 │ │ 월별 집계        │   │
│  └─────────┘ └──────────┘ └──────────┘ └────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Ingestion  (업로드·파싱·정규화·자동분류 오케스트레이션) │   │
│  └───────────────┬──────────────────────────────────────┘   │
└──────────────────┼──────────────────────────────────────────┘
        async job  │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Worker (비동기 파서/분류 처리)                   │
│   format detector → 카드사/은행별 parser → 자동분류          │
└──────────────────┬──────────────────────────────────────────┘
                   │
   ┌───────────────┼───────────────┬─────────────────┐
   ▼               ▼               ▼                 ▼
┌────────┐   ┌──────────┐   ┌──────────┐     ┌──────────────┐
│ RDB    │   │ Object   │   │ Cache/Q  │     │ (선택) 오픈   │
│Postgres│   │ Storage  │   │ Redis    │     │ 뱅킹/스크래핑 │
│ 거래/집계│   │ 원본파일 │   │ 큐·세션  │     │ 외부 연동     │
└────────┘   └──────────┘   └──────────┘     └──────────────┘
```

---

## 3. 논리 계층 (Layered Architecture)

백엔드 내부는 **계층형 + 도메인 모듈** 구조.

```
[ Presentation ]  REST Controller / DTO / 입력검증 / 인증가드
        │
[ Application ]   UseCase·Service (트랜잭션 경계, 오케스트레이션)
        │
[ Domain ]        Entity·도메인 규칙 (분류 정책, 집계 규칙, 제외 규칙)
        │
[ Infrastructure ] Repository(ORM) · 파일스토리지 · 큐 · 외부 API 어댑터
```

> 핵심 비즈니스 규칙(예: 카드대금 제외, 할부 회차별 집계, 원금+이자 합산)은 **Domain 계층**에 두어 클라이언트·DB 기술과 무관하게 일관 적용.

---

## 4. 핵심 도메인 모듈

| 모듈 | 책임 | 주요 데이터(=DATABASE.md) | 구현 |
|------|------|---------------------------|------|
| **Auth/Account** | 회원가입·로그인·JWT 회전·가드(Jwt/Roles/SuperAdmin) | household_member, refresh_token | ✅ `auth/` |
| **Household(가족)** | 가구·구성원(가족) 관리, RBAC | household, household_member | ✅ `household/` |
| **Admin(운영)** | **전체 운영 관리자** — 전 가구 조회·생성·삭제(테넌시 밖) | household 전체 | ✅ `admin/` |
| **Ledger(거래)** | 수입/지출 CRUD·검색·필터·통합 목록 | transaction, counterparty | ✅ `transaction/`, `counterparty/` |
| **StatementTxn(원천 거래)** | 은행·카드 원천 목록/분류/일괄처리/불일치/엑셀 | bank_transaction, card_transaction | ✅ `statement-txn/` |
| **Category** | 분류 코드 관리(Parent-Child, CRUD) | category | ✅ `category/` |
| **MerchantRule(자동분류 키워드)** | 키워드 규칙 CRUD + 분류기 캐시 무효화 | merchant_category_map | ✅ `merchant-rule/` |
| **PaymentMethod** | 계좌·카드 관리, 명세서 감지 카드, **집계 제외** 지정 | payment_method(`exclude_from_stats`) | ✅ `payment-method/` |
| **Ingestion(적재)** | 파일 업로드·파싱·정규화·자동분류 | bank_transaction, card_statement, card_transaction | ✅ `ingestion/` |
| **Reconciliation(대사)** | 카드대금·자기이체·집계제외 결제수단 → **'분류 제외'** 매핑 | bank/card_transaction, exclude_reason | ✅ `ingestion/reconciliation/` |
| **RecurringExpense/Income(정기지출·정기수입)** | 정기지출·정기수입 CRUD + 반복 패턴 추천 | recurring_expense(`flow` 로 지출/수입 구분) | ✅ `recurring-expense/` (`recurring-income.controller` 가 같은 테이블·서비스 공유, `flow='income'`) |
| **Statistics(통계)** | 월별 집계·대시보드·추이·**예상 지출 규칙 엔진** | monthly_*, transaction | ✅ `statistics/`(+`forecast.service`) |
| **Budget(예산)** | 예산 설정·소진율 | budget | ❌ **미구현**(DOMAIN_MODEL_DESIGN §2 설계만) |
| **Audit/Export** | 감사 로그 / 데이터 내보내기 | audit_log | 감사로그 ❌ · 내보내기는 원천 거래 **xlsx** 로 구현 |

### 4.1 테넌시(가구 스코핑) — as-built

가구 단위 데이터 격리는 서비스마다 `where householdId` 를 수기로 붙이지 않고, **요청 스코프 테넌트 컨텍스트 + Prisma 미들웨어**로 자동 주입한다.

- **TenantContext** (`common/tenant/tenant-context.ts`): `AsyncLocalStorage<{ userId, householdId, role }>`. `auth/tenant.interceptor.ts` 가 인증된 요청마다 JWT 클레임으로 컨텍스트를 채운다(`tenantStorage.run`).
- **PrismaService `$use` 미들웨어** (`prisma/prisma.service.ts`): `SCOPED_MODELS` 에 속한 모델의 모든 쿼리(read/write)에 현재 테넌트의 `householdId` 를 **자동 주입** — `where`/`create`/`data` 에 붙여 가구 경계를 강제한다. 컨텍스트가 없으면(공개 라우트·시스템 작업) 주입을 건너뛴다.
- **경계 초월(운영 관리자)**: `runWithoutTenant(fn)` 은 `AsyncLocalStorage.exit` 로 스토어를 비워 자동 주입을 끄고(반드시 명시적 where/data 로 대상 가구 지정), `runWithTenant(ctx, fn)` 은 임의 가구 컨텍스트로 기존 가구 스코프 서비스를 재사용한다. Admin 모듈이 전 가구 작업에 사용.
- **가드**: `auth/guards/` = `jwt-auth.guard` · `roles.guard`(가구 내 역할) · `super-admin.guard`(플랫폼 운영 관리자 — `isSuperAdmin`, Admin 라우트 보호).

---

## 5. 명세서 적재 파이프라인 (핵심)

업로드 파일이 가계부 거래가 되기까지의 비동기 흐름. **블로킹 방지**를 위해 큐+워커로 처리.

```
① Upload        클라이언트 → POST /imports (파일)
                  → Object Storage에 원본 저장, import_job 레코드 생성(status=queued)
                  → 큐에 작업 등록, 즉시 202 Accepted(jobId) 반환
        │
② Detect        워커: 파일 포맷/발급사 감지 (하나/현대/신한/삼성/은행)
        │
③ Parse         발급사별 Parser 어댑터 → 행 추출
        │
④ Normalize     공통 스키마로 정규화 → bank_transaction / card_statement+card_transaction (staging) 적재
        │
⑤ Auto-Classify merchant_category_map 규칙 적용 → category_code 부여
                  · 매칭 → transaction 생성(status=settled)
                  · 미매칭 → pending(검토 대기)
        │
⑥ Reconcile     카드대금·자기이체 매칭 → exclude_reason 표시(집계 제외)
        │
⑦ Review        사용자: 미분류·이상 건 확인/수정 (UI)  → 확정
        │
⑧ Aggregate     해당 월 monthly_* 재집계(rebuild)
        │
        ▼  status=completed  (클라이언트는 폴링 또는 푸시로 알림)
```

**설계 포인트**
- **Parser는 발급사별 어댑터 패턴**: 신규 카드사 추가 = 새 어댑터 1개 + `merchant_category_map` 규칙. 공통 인터페이스 `parse(rows) → NormalizedRows[]`.
- **멱등성(idempotency)**: (계좌/카드, 거래일시, 금액, 잔액) 해시로 **중복 적재 차단** → 같은 명세서 재업로드해도 안전.
- **사람 개입 단계(⑦)**: 자동분류는 추천, 최종 확정은 사용자. 확정 결과를 규칙으로 **학습(피드백)** → 정확도 향상.

**구현 매핑 (`apps/api/src/ingestion/`)**

| 파이프라인 단계 | 구현 |
|-----------------|------|
| ① Upload | `ingestion.controller` `POST /imports` → `ingestion.service.enqueue` (원본 저장 `storage/`, `ImportJob` 생성, 큐 등록) |
| ② Detect / ③ Parse | `parsers/parser.registry` → `parsers/bank.parser` · `parsers/card.parser` (헤더 별칭 기반 컬럼 매핑, `parsers/tabular` 로 xlsx/csv 읽기) |
| ④ Normalize | `parsers/types` 정규화 타입 → `pipeline/import-pipeline.service` 가 staging(`bank_transaction`/`card_statement`+`card_transaction`) 적재 (dedupHash 멱등) |
| ⑤ Auto-Classify | `classification/classifier.service` (`merchant_category_map` 우선순위 매칭) + `statement-txn.service` 의 정기지출·이력 매칭 → `transaction` 생성 or pending |
| ⑥ Reconcile | `reconciliation/reconciler.service` (카드대금·자기이체·집계제외 결제수단 → **'분류 제외' 분류로 매핑**, 폴백 `exclude_reason`) |
| ⑦ Review | `GET /imports/:jobId/pending` + **as-built 주경로**: 은행/카드 거래 화면의 인라인 분류·일괄 분류·자동분류 재실행 |
| ⑧ Aggregate | `StatisticsService.rebuild(ym)` — 영향 월 재집계 |
| 큐/워커 | `pipeline/import.processor` (BullMQ `@Processor`), `pipeline/import.queue` |

> **파서(as-built)**: 은행은 `GenericBankParser`, 카드는 **발급사별 전용 파서 4종**(`hana-card` / `hyundai-card` / `shinhan-card` / `samsung-card`)을 `parser.registry` 에서 매핑한다. 공통 로직(헤더 탐색·금액/날짜 파싱·dedupHash)은 `generic.ts` · `tabular.ts` 에 모아 두고, 카드사별 헤더 별칭·특이 포맷(청구회차·사용월/청구월 분리 등)만 각 파서가 갖는다.

### 5.1 자동분류 규칙 (as-built)

⑤는 초기 설계의 "키워드 규칙 매칭" 하나가 아니라, **선(先) 제외 매핑 + 3단계 우선순위**로 확장되었다.
업로드 파이프라인과 화면의 **자동분류 버튼**(`POST /bank-transactions/auto-classify`, `/card-transactions/auto-classify`)이 같은 로직을 공유한다.

```
0) 선(先) 제외 매핑 (reconciler)
   · exclude_from_stats 결제수단      → 방향별 '분류 제외'(지출 18 / 수입 19)
   · 카드대금 결제 출금(구분에 '카드')  → '지출 분류 제외'
   · 자기이체(같은 내용·같은 날·동일 금액·본인 명의 계좌 쌍) → 출금 18 / 입금 19
     └ 계좌를 나눠 업로드해 한쪽이 먼저 분류된 경우도 짝을 맞춰 보정
1) 정기지출 매칭  recurring_expense.match_key(또는 label) 토큰이 내용에 포함 → 그 분류
2) 이력 학습      과거 같은 내용(은행은 방향별)의 최신 분류 (exact → fuzzy)
3) 키워드 규칙    merchant_category_map (priority 오름차순, 공백 무시)
4) 잔여 당행송금  1~3 에 안 걸린 '당행송금' → exclude_reason='transfer'
5) 영향 월 rebuild
```

- **명시적 신호 우선**: 정기지출·이력·키워드가 당행송금 제외보다 우선한다. 이미 `transfer` 로 제외된 행도 재분류 대상에 포함해, 키워드를 나중에 등록해도 소급 반영된다.
- **카드 취소·0원 행**: `is_canceled='Y'` 와 0원·음수 조정행도 금액 제한 없이 분류한다(환불이 해당 분류 지출에서 차감되도록).
- **분류 불일치 점검**: `GET …/category-conflicts` — 같은 내용이 서로 다른 분류로 잡힌 건을 화면에서 모아 보여주고 일괄 교정한다(이력 학습의 오염 방지).
- 규칙 상세·응답 필드는 [API_SPEC.md](API_SPEC.md) §9.

---

## 6. 기술 스택 제안

> **추천 = 풀스택 TypeScript**: 웹(React)·모바일(React Native)·백엔드(NestJS)가 **타입과 API 클라이언트를 공유** → 1인/소규모로 웹→모바일 확장 시 생산성 최상.

| 영역 | 추천 | 대안 | 선정 이유 |
|------|------|------|-----------|
| **웹 프론트** | React + Next.js + TypeScript | Vue/Nuxt, SvelteKit | 생태계·채용·모바일(RN)과 지식 공유 |
| **모바일(2단계)** | React Native (Expo) | Flutter | 웹 React 코드·타입·API 클라이언트 재사용 |
| **백엔드** | NestJS (Node + TS) | Spring Boot(Java/Kotlin), FastAPI(Python) | TS 단일 언어, 모듈/DI 구조가 계층 설계에 적합 |
| **DB** | PostgreSQL | MySQL | 트랜잭션·집계·JSON 지원, 안정성 |
| **ORM** | Prisma | TypeORM, Drizzle | 타입 안전 스키마, 마이그레이션 |
| **큐/캐시** | Redis + BullMQ | RabbitMQ, SQS | 적재 비동기 잡·세션·캐시 |
| **파일 저장** | S3 호환 오브젝트 스토리지 | 로컬 디스크(초기) | 원본 명세서 보관 |
| **인증** | JWT(Access)+Refresh, 또는 세션 | Auth0/Clerk(외부) | 모바일 친화(토큰), 자체 통제 |
| **API 계약** | OpenAPI(자동생성) + 공유 타입 패키지 | tRPC(웹 전용이면) | 모바일까지 고려해 OpenAPI 권장 |
| **차트** | Recharts(웹) / Victory Native(앱) | Chart.js | 월별 통계 시각화 |
| **인프라** | Docker + (Fly.io/Render/AWS) | k8s(후기) | 초기 단순 배포, 후기 확장 |

**파싱 모듈 (확정: Excel/CSV, Node 내장)**: 명세서를 Excel/CSV로 받아 Node 라이브러리(`exceljs`/`papaparse`)로 파싱한다. **Python 분리 불필요** → 워커도 NestJS 프로세스로 단일 언어 유지. 향후 PDF/OCR 요구가 생기면 그때 Python 파서를 별도 서비스로 추가(파이프라인 ⑤ 이전 단계만 교체, 나머지 불변).

> 백엔드를 다른 언어로 가더라도 **2~7장의 구조·파이프라인 설계는 그대로 유효**하지만, 본 프로젝트는 **NestJS(TS) 확정**.

---

## 7. API 설계 방향

- **REST + JSON**, URI 버전닝(`/api/v1/...`). OpenAPI 스펙을 단일 진실원으로 두고 **웹·모바일 클라이언트 코드 자동 생성**.
- **인증**: `Authorization: Bearer <accessToken>` (JWT). 모바일은 토큰을 안전 저장소(Keychain/Keystore)에 보관. 웹은 httpOnly 쿠키 또는 메모리+refresh.
- **공유 타입 패키지**: `@ledger/shared`(DTO·enum·분류코드 타입)를 모노레포로 웹·모바일·백엔드가 의존.
- **대표 엔드포인트(예시)**
  - `POST /api/v1/auth/login` · `POST /auth/refresh`
  - `GET/POST/PUT/DELETE /api/v1/transactions` (검색·필터·페이지네이션)
  - `GET /api/v1/categories` (트리)
  - `POST /api/v1/imports` (명세서 업로드) · `GET /imports/{jobId}` (진행상태)
  - `GET /api/v1/imports/{jobId}/pending` (검토 대기 건) · `PATCH .../classify`
  - `GET /api/v1/stats/monthly?ym=2026-03` · `/stats/monthly/category` · `/category|source|payment`

---

## 8. 모바일 확장 전략 (2단계)

- **API 재사용**: 백엔드·집계·분류 로직 100% 재사용. 모바일은 **화면 + 디바이스 기능**만 추가 구현.
- **코드 공유**: React Native(Expo)로 웹의 React 컴포넌트 로직·API 클라이언트·타입 공유. (UI는 플랫폼별 최적화)
- **모바일 강점 기능**: 카메라로 영수증 촬영·OCR, 푸시 알림(예산 초과), 생체 인증 앱 잠금, 오프라인 캐시 후 동기화.
- **모노레포 구성(권장)**:
  ```
  /apps
    /web        (Next.js)
    /mobile     (Expo)            ← 2단계
    /api        (NestJS)
  /packages
    /shared     (타입·DTO·검증 스키마)
    /api-client (생성된 API 클라이언트)
  ```

---

## 9. 데이터 · 저장소

- **RDB(PostgreSQL)**: 거래·분류·집계 등 정형 데이터(=DATABASE.md 스키마).
- **오브젝트 스토리지**: 업로드 원본 명세서 보관(감사·재처리용). DB엔 메타+경로만.
- **Redis**: 적재 잡 큐, 세션/리프레시 토큰, 대시보드 캐시(월별 통계 짧은 TTL).
- **민감정보 암호화**: 계좌번호 등은 저장 시 암호화(at-rest), 전송 TLS(in-transit).

---

## 10. 보안 · 인증

- 금융성 개인정보 → **HTTPS 강제, 토큰 만료/회전, 비밀번호 해시(bcrypt/argon2)**.
- **권한 모델**: 사용자별 데이터 격리. 가구 공유 기능 시 household 단위 RBAC.
- **업로드 검증**: 파일 타입/크기 제한, 바이러스 스캔(선택), 파서 샌드박싱.
- **민감정보 마스킹**: 화면·로그에서 계좌/카드번호 마스킹(`56991*****7307`).
- **감사 로그**: 거래 수정·삭제·업로드 이력 기록.

---

## 11. 배포 · 운영

- **컨테이너화(Docker)**: api / worker / web 이미지. 로컬은 docker-compose(api+worker+postgres+redis).
- **환경 분리**: dev / staging / prod, 환경변수·시크릿 관리.
- **CI/CD**: 빌드·테스트·마이그레이션·배포 자동화.
- **초기 호스팅**: Fly.io/Render/Railway 같은 PaaS로 단순 시작 → 트래픽 증가 시 AWS/k8s.
- **관측성**: 구조화 로그·에러 추적(Sentry)·기본 메트릭(잡 처리시간, 실패율).

---

## 12. 단계별 로드맵

### 1단계 — 웹 MVP
- 인증, 거래 CRUD·검색, 분류 코드, 수동 입력, 월별 요약 대시보드
- 명세서 업로드·파싱(우선 1~2개 발급사) + 자동분류 + 검토 UI
- 모놀리식 백엔드 + 동기/간단 큐

### 2단계 — 웹 고도화
- 발급사 파서 확대(하나·현대·신한·삼성·은행 전부), 대사 자동화, 예산 기능
- 통계 강화(추세·비중), 캐시·성능 튜닝

### 3단계 — 모바일 앱
- React Native 앱, 동일 API 연동
- 영수증 OCR, 푸시 알림, 생체 인증, 오프라인 동기화

### 4단계 — 확장
- 가구 공유, 오픈뱅킹 자동연동, AI 소비 분석·추천, 다중 통화

---

## 13. 의사결정 현황

| # | 결정 사항 | 상태 |
|---|-----------|------|
| 1 | 백엔드 언어/프레임워크 | ✅ **확정: NestJS(TypeScript)** |
| 5 | 파싱 입력 형식 | ✅ **확정: Excel/CSV 우선** (Node 파서, Python 미사용) |
| 2 | 단일 배포 vs 마이크로서비스 | 권장: 모놀리식 시작(파서도 동일 프로세스), 부하 시 분리 |
| 3 | 인증 자체구현 vs 외부(Clerk/Auth0) | 권장: 자체 JWT (통제·비용). 빠른 출시면 외부 |
| 4 | 호스팅 | 권장: PaaS(Fly/Render/Railway) 시작 |

> #1·#5 확정으로 스택은 **풀스택 TypeScript 모노레포**(Next.js + NestJS + 추후 React Native)로 고정. #2~4는 1단계 개발 중 확정해도 무방.
