# 프론트엔드 설계서 (Web, Next.js)

> 전략: **웹 먼저**, 이후 모바일(RN)과 타입·검증·API 클라이언트를 `packages/`로 공유.
> 백엔드는 **API-First** — 프론트는 OpenAPI에서 생성한 `@ledger/api-client`를 소비한다.
>
> ⚠️ **§2~§4·§7 은 목표(to-be) 설계이며 현행 구현과 다르다. 현행은 아래 §0 을 정본으로 본다.**

---

## 0. 현행 구현 (as-built, 2026-08-01)

### 0.1 실제 스택 — 설계 대비 차이

| 영역 | 설계(§2) | **현행 구현** |
|------|----------|---------------|
| 프레임워크 | Next.js App Router | Next.js 14 App Router **셸만** — `app/page.tsx` 단일 진입, URL 라우팅 없이 `Shell` 의 `useState<View>` 로 화면 전환(code-server 하위경로 프록시에서 라우팅이 깨지는 문제 회피) |
| 서버 상태 | TanStack Query | **미도입** — 각 view 에서 `useEffect` + `api.get` 직접 호출 |
| 클라이언트 상태 | Zustand | **미도입** — `lib/auth.tsx` 의 React Context(세션) + 화면 로컬 state |
| 스타일/UI | Tailwind + shadcn/ui | **미도입** — `app/globals.css` 수기 CSS(뉴모피즘 다크 테마, `.btn`·`.card`·`.nav` 등 클래스) |
| 폼/검증 | react-hook-form + zod | **미도입** — 제어 컴포넌트 + 서버 검증(class-validator) 의존 |
| 차트 | Recharts | **미도입** — 자체 SVG 컴포넌트(`TrendChart`·`MonthlyBars`·`GroupedBarChart`·`StackedBarChart`) |
| API 클라이언트 | openapi-typescript 생성물 | **수기** `lib/api.ts` fetch 래퍼 + `lib/types.ts` 수기 타입. 401 → `/auth/refresh` 자동 재시도는 구현됨 |
| 의존성 | — | `apps/web/package.json` = next·react·react-dom·@ledger/shared **뿐** |

> 즉 현행 웹은 **의존성 없는 SPA**다. TanStack Query·shadcn·zod·Recharts 도입은 남은 과제이며,
> 도입 전까지 §2·§4 는 목표 상태로만 읽는다.

### 0.2 실제 앱 구조

```
apps/web/src/
├─ app/{layout.tsx, page.tsx, globals.css}   # 셸 + 뉴모피즘 테마 CSS
├─ components/   Shell · Sidebar · Login · MultiSelect · sortable
│                TrendChart · MonthlyBars · GroupedBarChart · StackedBarChart · chart-utils
├─ views/        화면 1개 = 파일 1개 (아래 §0.3)
└─ lib/          api.ts(fetch 래퍼·토큰) · auth.tsx(Context) · types.ts · format.ts
```

### 0.3 실제 화면 인벤토리 (사이드바 = `components/Sidebar.tsx`)

| 그룹 | 화면(view) | 핵심 기능 |
|------|-----------|-----------|
| 집계 | **월별 거래 추이** `dashboard` | 기간 선택(기본 올해), 월별 수입·지출 추이, 대분류별 지출 비교, 계좌/카드 집계 |
| | **월별 결제수단별 지출 추이** `payment-trend` | 기간 선택, 계좌·카드 그룹 단일 비교 막대 |
| | **예상 수입•지출** `forecast` | 월 선택 · 예상 수입/지출 목록 · **일자별 현금흐름(1일~말일 수입·지출·잔액)** · 소비 기준 예측(규칙 엔진) |
| 거래내역 | **전체 거래** `all-transactions` | `/transactions/unified` — 은행+카드 통합 목록·필터·합계 |
| | **은행 거래** `bank-transactions` | 목록·정렬·필터·인라인 분류·일괄 분류/삭제·**자동분류**·**분류 불일치**·xlsx 내보내기 |
| | **카드 거래** `card-transactions` | 은행과 동형(+할부 필터·취소행 표시) |
| 관리 | **가족 관리** `family` | 가구명·구성원 CRUD(로그인 계정 겸용·역할) |
| | **카드 관리** `cards` | 카드 등록·수정, 명세서에서 **감지된 카드** 매핑 |
| | **결제수단** `payment-methods` | 계좌·카드 목록, **수입·지출 집계 제외** 지정 |
| | **분류 관리** `categories` | 분류 코드 트리 CRUD(대/소분류·정렬·사용여부) |
| | **정기지출** `recurring-expenses` | 정기지출 CRUD + 반복 패턴 **추천** 확정 |
| | **자동분류 키워드** `classify-keywords` | 키워드 규칙 CRUD(패턴·매칭방식·우선순위) |
| | **명세서 업로드** `imports` | 발급사·결제수단 선택 업로드, 잡 상태, 업로드 이력 |
| 운영 관리자 | **가구 관리** `admin-households` | `isSuperAdmin` 에게만 노출 — 전 가구 목록·생성·삭제 |

**설계(§5) 대비 차이**
- **미구현**: 예산 화면, 회원가입/비밀번호 재설정 화면(로그인만), 거래 빠른 입력(+ FAB), 모바일 하단 탭, 잡 상태 SSE.
- **설계에 없던 as-built 화면**: 월별 결제수단별 지출 추이 · 예상 지출 · 전체 거래 · 은행/카드 거래 · 카드 관리 · 정기지출 · 자동분류 키워드 · 운영 관리자 가구 관리.
- **검토(pending) 전용 화면 없음** → 아래 §0.4.

### 0.4 검토(Review) 플로 — 실제 구현

설계 §7 의 "잡 단위 검토 화면"은 만들지 않았다. 대신 **원천 거래 목록 화면이 검토 화면 역할**을 한다.

```
명세서 업로드 → (업로드 시점에 자동분류·대사까지 수행) → 은행/카드 거래 화면
   · 미분류 행을 목록에서 직접 인라인 분류
   · 체크박스 선택 → 일괄 분류 / 일괄 삭제
   · [자동분류] 버튼으로 규칙·정기지출·이력 기반 재분류 (키워드 추가 후 소급 적용)
   · [분류 불일치] 패널에서 같은 내용이 다른 분류로 잡힌 건을 모아 교정
   · 규칙 학습 = 관리>자동분류 키워드 화면에서 명시적으로 등록(체크박스 학습 아님)
```

즉 검토는 **잡 단위(job-scoped)가 아니라 목록 단위(list-scoped)** 이며, 확정 버튼 대신 분류 즉시 반영 + 월 재집계다. REVIEW_WORKFLOW_DESIGN.md 의 as-built 절도 같은 내용을 담는다.

---

## 1. 원칙

- **서버 상태 ≠ 클라이언트 상태 분리**: 서버 데이터는 **TanStack Query**(캐시·무효화), 화면 로컬 상태만 경량 스토어.
- **타입/검증 공유**: DTO·enum은 `@ledger/shared`, 폼 검증은 **zod 스키마 공유**(백엔드 DTO와 일치).
- **컴포넌트 우선 재사용**: 로직/포맷/훅은 공유 가능하게, UI는 플랫폼별 최적화(추후 RN).
- **반응형 우선**: 모바일 웹부터 잘 되게(추후 앱 전환 자연스럽게).

---

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|------|------|------|
| 프레임워크 | **Next.js (App Router) + TS** | RSC 셸 + 클라이언트 데이터 컴포넌트 |
| 서버 상태 | **TanStack Query** | 캐시·낙관적 업데이트·무효화 |
| 클라이언트 상태 | **Zustand**(경량) | 가구 컨텍스트·UI 토글 |
| 스타일/UI | **Tailwind CSS + shadcn/ui** | 토큰·다크모드·접근성 |
| 폼/검증 | **react-hook-form + zod** | `@ledger/shared` 스키마 재사용 |
| 차트 | **Recharts** | 월별 통계 시각화 |
| API 클라이언트 | **openapi-typescript**(+fetch 래퍼) | OpenAPI JSON → 타입/클라이언트 생성 |
| 포맷 | **Intl API**(ko-KR, KRW) | 통화·날짜·숫자 |

---

## 3. 렌더링 · 인증 게이팅

- **RSC 셸(레이아웃·정적)** + **클라이언트 컴포넌트(데이터·상호작용)** 혼합.
- **보호 라우트**: Next `middleware.ts`에서 인증 쿠키 확인 → 미인증 시 `/login` 리다이렉트.
- **토큰 처리(AUTH_DESIGN 연동)**: Access=메모리, Refresh=httpOnly 쿠키. API 래퍼가 **401 → `/auth/refresh` 자동 재시도** 후 원요청 재실행.
- **가구 컨텍스트**: 로그인 후 활성 가구를 스토어에 보관, 요청 헤더 `X-Household-Id`로 전달.

---

## 4. 앱 구조 (`apps/web/`)

```
src/
├─ app/                      # App Router
│  ├─ (auth)/login, signup, reset/         # 비인증 레이아웃
│  ├─ (app)/                               # 인증 레이아웃(사이드바/탭)
│  │  ├─ page.tsx            # 대시보드
│  │  ├─ transactions/       # 목록·상세·입력
│  │  ├─ imports/            # 업로드·검토
│  │  ├─ statistics/
│  │  ├─ budgets/
│  │  └─ settings/           # 분류·결제수단·가구/구성원·프로필
│  └─ layout.tsx
├─ features/                 # 도메인별 훅·컴포넌트 (transactions, imports, stats, auth ...)
├─ components/ui/            # shadcn 기반 공용 UI
├─ lib/                      # api-client 래퍼, query client, format, auth
└─ hooks/
```

---

## 5. 화면 인벤토리 · 정보구조(IA)

> ⚠️ 아래는 초기 설계안. **실제 구현된 화면 목록은 §0.3** 를 본다(예산·빠른입력·검토 화면 미구현, 추이/예상지출/원천거래/키워드/운영관리자 화면 추가).

| 그룹 | 화면 | 핵심 |
|------|------|------|
| 인증 | 로그인 / 회원가입 / 비밀번호 재설정 | AUTH_DESIGN 흐름 |
| **대시보드** | 홈 | 이번 달 수입·지출·순액, 예산 소진율, 최근 거래, 분류 도넛 |
| 거래 | 목록 / 상세 / 입력·수정 | 필터·검색·페이지네이션, 빠른 입력 |
| **업로드·검토** | 업로드 / 진행상태 / **검토(pending)** | 명세서 자동입력의 핵심 |
| 통계 | 월별·분류별·결제수단별·추세 | 차트 |
| 예산 | 예산 설정 / 대비 실적 | 카테고리별 소진율 |
| 설정 | 분류 / 결제수단 / **가구·구성원** / 프로필 | 코드·마스터·RBAC |

**내비게이션**: 데스크톱=좌측 사이드바, 모바일=하단 탭(홈·거래·추가(+)·통계·설정). 중앙 **+** = 빠른 지출 입력.

---

## 6. 핵심 UX 플로우

### ① 빠른 지출 입력 (3탭 내 완료)
```
[+] → 금액 입력(숫자패드) → 분류 선택(최근/자주) → 저장
        └ 결제수단·날짜는 기본값(오늘/최근수단), 필요 시 펼치기
```

### ② 명세서 업로드 → 검토 → 확정
```
업로드 화면
  발급사 선택(하나/현대/신한/삼성/은행) · 결제수단 선택 · 파일 첨부
        │  POST /imports  → jobId
        ▼
진행상태 (폴링/SSE)  queued→parsing→classifying→review/completed
        │
        ▼  status=review (미분류 존재)
검토 화면 (§7)  →  분류 확정  →  월 자동 재집계  →  완료
```

### ③ 월말 리뷰
```
대시보드(이번 달 요약) → 통계(분류/결제수단 비중·추세) → 예산 대비 확인
```

---

## 7. 검토(Review) UI — 가장 복잡

> ⚠️ **미구현(설계안)**. 실제로는 은행/카드 거래 목록 화면이 이 역할을 대신한다 — §0.4 참조.

자동분류 실패(pending) 건을 사람이 확정하는 화면. **추천 분류 표시 · 인라인 수정 · 일괄 확정 · 규칙 학습**.

```
┌─ 검토: 하나카드 2026-04 명세서 ─────────── 12건 대기 ┐
│ [전체선택]         추천분류 일괄적용 ▸   [n건 확정]   │
├───────────────────────────────────────────────────┤
│ ☑ 03.30 산들푸드           5,800  [생활>월생활비 ▾]✨│
│ ☑ 03.29 카카오T 택시      12,500  [교통 ▾]        ✨│
│ ☐ 03.16 365정형외과      100,110  [건강 ▾]        ✨│
│ ☑ 03.20 GS25 군자점          230  [분류 선택 ▾]    │
│    └ ☐ "GS25" 는 앞으로 '생활>월생활비'로 자동분류   │  ← 규칙 학습
├───────────────────────────────────────────────────┤
│  선택 8건  합계 ₩142,340         [확정하고 집계]     │
└───────────────────────────────────────────────────┘
```
- ✨ = 규칙 추천(있으면 미리 채움). 없으면 사용자 선택.
- **규칙 학습**: 체크 시 `merchant_category_map`에 규칙 추가 → 다음부터 자동분류(피드백 루프).
- 확정 시: pending → `transaction` 생성/연결 + 해당 월 `rebuild`.
- 필요한 백엔드 API(설계 예정): `PATCH /imports/{jobId}/classify`(일괄 확정), `POST /merchant-rules`(규칙 학습).

---

## 8. 데이터 페칭 계층

- **api-client 생성**: `openapi-typescript`로 OpenAPI JSON → 타입 + 얇은 fetch 래퍼(`packages/api-client`). 웹·모바일 공유.
- **QueryClient**: 캐시 키 규약 `['transactions', filters]`, `['stats','monthly', ym]` 등.
- **낙관적 업데이트**: 거래 추가/수정 시 목록 즉시 반영 후 서버 확정.
- **무효화 규칙**: 거래 변경·업로드 완료 → `transactions`, `stats/*` 쿼리 invalidate.
- **인증 래퍼**: 401 → refresh 회전 → 재요청. 실패 시 로그아웃.

---

## 9. 폼 · 검증

- **공유 zod 스키마**(`@ledger/shared`): 거래 입력·결제수단·업로드 폼을 백엔드 DTO와 동일 규칙으로 검증(단일 소스).
- **react-hook-form + zodResolver**: 인라인 에러, 제출 상태.
- 예: 거래 입력 = `transactionCreateSchema` (금액>0, 날짜 형식, 분류 필수 …) → 프론트·백엔드 동시 사용.

---

## 10. 디자인 시스템

- **Tailwind + shadcn/ui**: Button·Input·Select·Dialog·Table·Tabs·Toast 등 공용 컴포넌트.
- **토큰**: 색/간격/타이포 CSS 변수, **다크모드**(class 전략).
- **수입/지출 색 규약**: 수입=파랑 계열, 지출=빨강 계열, 순액 강조.
- 반응형: 모바일 우선 → 브레이크포인트로 사이드바 전환.

---

## 11. 포맷 · i18n

- 통화: `Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW'})` → `₩6,700,225`.
- 날짜: `ko-KR` 로케일, 상대표기(오늘/어제) 옵션.
- 다국어는 후순위 — 문자열은 처음부터 상수/사전으로 분리(추후 i18n 도입 용이).

---

## 12. 상태 UX

- 로딩=스켈레톤, 빈=안내+행동 유도(첫 거래 추가/명세서 업로드), 에러=재시도.
- 알림(Toast): 저장/삭제/업로드 완료, **예산 초과 경고**.

---

## 13. 웹 ↔ 모바일 공유 전략 (2단계 대비)

| 공유(packages) | 플랫폼별(apps) |
|----------------|----------------|
| 타입·enum·**zod 검증**(`@ledger/shared`) | 화면·내비게이션 |
| **api-client**(`@ledger/api-client`) | UI 컴포넌트(웹=shadcn / 앱=RN) |
| 포맷·도메인 훅 로직(가능한 범위) | 디바이스 기능(카메라·푸시·생체) |

---

## 14. 확정 필요 / 후순위

1. UI 라이브러리 확정: **shadcn/ui**(권장) vs MUI vs Chakra
2. 잡 진행 표시: **폴링**(단순) vs SSE(실시간) — 백엔드 통지 방식과 연동
3. 후순위: 다국어(i18n), 오프라인 캐시, 접근성 상세, 스토리북/디자인 QA
