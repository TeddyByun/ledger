# 설계 백로그 (Design Backlog)

> 가계부 서비스의 **설계 진행 현황 추적 체크리스트**.
> 각 항목을 설계 완료할 때마다 `[ ]` → `[x]` 로 체크한다. 완료 항목은 관련 산출물(문서/코드) 링크를 함께 남긴다.
>
> 범례: ✅ 완료 · 🔴 높음 · 🟡 중간 · 🟢 낮음

---

## 0. 진행 요약

| 구분 | 완료 | 남음 |
|------|------|------|
| 기획/데이터 | 3 | 0 |
| 백엔드 | 16 | 0 |
| 프론트엔드 | 11 | 0 |
| 공통(Cross-cutting) | 7 | 0 |
| 인프라/운영 | 6 | 0 |

> ⚠️ 위 표는 **설계 완료** 기준이다. 설계됐지만 **구현되지 않은** 항목이 있으므로, 구현 기준 현황은 아래 §0.1 을 본다.

---

## 0.1 구현 현황 (as-built, 2026-08-17)

코드(`apps/api` 컨트롤러 13개 · `apps/web` 화면 16개 · `schema.prisma` 테이블 20개) ↔ 설계 문서 전수 대조 결과.

### A. 설계 O / 구현 O

인증·멀티테넌시(가구 스코프 미들웨어·RBAC·SuperAdmin) · 적재 파이프라인(업로드→파싱→정규화→자동분류→대사→집계) ·
거래/분류/결제수단/가구 CRUD · 월별 집계 4종 + 재집계 · 예상 지출 규칙 엔진 + 정기지출 ·
API 에러 계약(traceId 봉투) · 커서 페이지네이션 · 로컬 dev 환경 · 마이그레이션 · 헬스체크/env 검증 · 테스트 하네스(jest projects).

### B. 설계 O / 구현 X — **설계안으로만 유지**

| 항목 | 문서 | 비고 |
|------|------|------|
| **예산(Budget)** | DOMAIN_MODEL_DESIGN §2 | 테이블·API·화면 전무. 예산 소진율·초과 경고도 없음 |
| **검토(pending) 확정 워크플로** | REVIEW_WORKFLOW_DESIGN | 잡 단위 확정 API·검토 화면 미구현 → 목록 화면 방식으로 대체(§0 as-built 절) |
| **구글 드라이브 연동**(앱 내 파일저장·시트 가져오기) | GOOGLE_DRIVE_DESIGN | 앱 레벨 미구현. 업로드 원본은 로컬 디스크. *단, 운영 DB 백업은 rclone 로 드라이브에 올린다 → §5* |
| **감사 로그** | BACKEND_FEATURES_DESIGN §1 | `audit_log` 테이블 없음 |
| **비밀번호 재설정 / 가구원 초대** | AUTH_DESIGN §5·§6 | 토큰 테이블만 존재. 초대 대신 owner 직접 생성 |
| **CI/CD 파이프라인** | INFRA_OPS_DESIGN §3 | `.github/workflows` 없음 → PM2 수동 배포 |
| **SSE 잡 통지** | API_CONVENTIONS_DESIGN §4.3 | 폴링만 구현 |
| **프런트 스택**(TanStack Query·shadcn/Tailwind·zod 폼·Recharts·api-client 생성) | FRONTEND_DESIGN §2·§8~§10 | 전부 미도입 — 수기 fetch + 수기 CSS + 자체 SVG 차트 |
| **DB V2 규칙(`_mt`/`_ct`/`_tt`)** | DATABASE_V2_DESIGN | 재설계 제안. 현행 스키마는 V1 계열 |

### C. 구현 O / 설계에 없던 것 — **본 정비에서 문서 반영 완료**

| 구현 | 반영 위치 |
|------|-----------|
| 자동분류 확장(정기지출 → 이력 학습 → 키워드 3단계 + 잔여 이체 처리) | ARCHITECTURE §5.1 · API_SPEC §9 |
| 자동분류 재실행 버튼(`POST …/auto-classify`) | API_SPEC §7 |
| **분류 제외** 대분류(지출 18 / 수입 19) 기반 집계 제외 | DATABASE §3.2 · §7.1.1 |
| **집계 제외 결제수단**(`exclude_from_stats`) → 방향별 분류 제외 매핑 | DATABASE §3.1 · §7.1.1 |
| 자기이체 짝 맞춤 보정(계좌 분할 업로드 대응) · 카드대금 승격 | DATABASE §7.1.1 |
| **분류 불일치**(`category-conflicts`) 조회·교정 | API_SPEC §7 · ARCHITECTURE §5.1 |
| **자동분류 키워드 관리** CRUD 화면·API | API_SPEC §8 · FRONTEND_DESIGN §0.3 |
| 분류 관리(category) CRUD 화면 | API_SPEC §4 |
| 원천 거래 화면(은행·카드) — 인라인/일괄 분류·일괄 삭제·정렬·필터 | FRONTEND_DESIGN §0.3·§0.4 |
| **전체 거래 통합 목록**(`/transactions/unified`) + `/summary` | API_SPEC §6 |
| **xlsx 내보내기**(은행·카드) | BACKEND_FEATURES_DESIGN 머리말 · API_SPEC §7 |
| 대시보드/월별 추이/**결제수단별 추이** 조회 API·화면 | API_SPEC §11 · FRONTEND_DESIGN §0.3 |
| **전체 운영 관리자** 가구 생성·삭제 | AUTH_DESIGN §12.4 |
| 카드 관리 + 명세서 **감지 카드**(`detected-cards`) 매핑 | API_SPEC §5 |
| 카드사별 **전용 파서 4종** | ARCHITECTURE §5 |
| 단일 페이지(SPA) 셸 구조 — URL 라우팅 없음 | FRONTEND_DESIGN §0.1·§0.2 |
| **월 현금흐름 예측**(`/stats/cashflow`) — 예상 수입 탐지·카드대금(전월 이용액)·일자별 잔액 | EXPENSE_FORECAST_DESIGN §10 · API_SPEC §11 |
| 예상 수입·지출 강화 — 등록 정기수입/지출을 **계획**으로 항상 표시 + **계획 vs 실제** 대조·합계, 자기이체 제외(이중계상 방지) | EXPENSE_FORECAST_DESIGN §10 |
| **정기수입**(recurring income) 관리 — CRUD·추천·이번 달 발생 상태, `recurring_expense.flow='income'` 공유 테이블·전용 컨트롤러/화면 | (신규 — 정기지출과 대칭) |
| 결제수단 **사용 중지**(`isActive`) 플래그 — 신규 사용 목록에서 제외 | DATABASE §3.1 |
| **다중 선택 필터**(MultiSelect) — 원천·통합 거래 목록 | FRONTEND_DESIGN §0.4 |
| 커스텀 **달력**(DatePicker/MonthPicker) — 네이티브 입력 대체(뉴모피즘 통일) | FRONTEND_DESIGN §0.1 |
| Refresh 회전 **유예창(20s)** + 동시 refresh **de-dup**(단일 in-flight 공유) — 멀티탭·재시도 경쟁에도 세션 유지 | AUTH_DESIGN §2.2 |

---

## 1. 기획 · 데이터 (Foundation)

- [x] **요구사항 정의** — 기능/비기능 요구사항 · [REQUIREMENTS.md](REQUIREMENTS.md)
- [x] **DB 설계** — 테이블·DDL·집계·정책(카드대금/자기이체/할부/원금+이자) · [DATABASE.md](DATABASE.md)
- [x] **월별 요약 통계 설계** — monthly_summary / category / source / payment · [DATABASE.md](DATABASE.md) §8

---

## 2. 백엔드 (Backend)

### 완료
- [x] **전체 아키텍처** — API-First, 계층 구조, 스택 확정(NestJS/Prisma/PG) · [ARCHITECTURE.md](ARCHITECTURE.md)
- [x] **Prisma 스키마** — 전 테이블 + ImportJob · [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)
- [x] **REST API 설계 + 도메인 모듈** — categories/payment-methods/counterparties/transactions/statistics/imports, OpenAPI 자동생성 · [API_SPEC.md](API_SPEC.md)
- [x] **적재 파이프라인** — 파서(발급사별)·자동분류·대사·집계·큐 · [ARCHITECTURE.md](ARCHITECTURE.md) §5

### 남음
- [x] 🔴 **인증/인가** — 회원가입·로그인·JWT(Access/Refresh)·비밀번호 재설정·가드 · [AUTH_DESIGN.md](AUTH_DESIGN.md)
- [x] 🔴 **멀티테넌시/데이터 소유권** — household 스코프, 쿼리 격리, 가구 RBAC · [AUTH_DESIGN.md](AUTH_DESIGN.md) §3·§4
- [x] 🔴 **검토(pending) 확정 워크플로** — 확정 API + 규칙 학습(피드백) · [REVIEW_WORKFLOW_DESIGN.md](REVIEW_WORKFLOW_DESIGN.md) · ⚙️ *설계만 — 목록 화면 방식으로 대체 구현(§0.1 B)*
- [x] 🟡 **예산(Budget) 모델·API** — 예산 설정·소진율·초과 판정 · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §2 · ⚙️ *설계만 — 미구현*
- [x] 🟡 **반복/고정 지출** — is_recurring + 자동 생성 규칙 · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §3 · ⚙️ *구현 형태 상이 — `recurring_expense`(`flow`=expense/income 으로 정기지출·정기수입 공유, 예측·자동분류용, 거래 자동생성 없음)*
- [x] 🟡 **가족 구성원(member) 모델** — 지출 명의 귀속(본인/가족) · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §1 · ⚙️ *구성원 CRUD 만 구현, `transaction.member_id` 미사용*
- [x] 🟡 **API 규약 표준화** — 에러 포맷/코드, 정렬·필터 컨벤션, 커서 페이지네이션 · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §1·§2·§3
- [x] 🟡 **잡 상태 통지 방식** — 폴링 vs SSE/WebSocket, 큐 재시도·DLQ · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §4 · ⚙️ *폴링만 구현, SSE 미구현*
- [x] 🟡 **테스트 전략** — 단위/통합/e2e, 테스트 DB, 파서 픽스처(실파일·EUC-KR) · [TEST_STRATEGY_DESIGN.md](TEST_STRATEGY_DESIGN.md)
- [x] 🟢 **감사 로그** — 거래 수정·삭제·업로드 이력 · [BACKEND_FEATURES_DESIGN.md](BACKEND_FEATURES_DESIGN.md) §1 · ⚙️ *설계만 — 미구현*
- [x] 🟢 **데이터 내보내기** — CSV/Excel export · [BACKEND_FEATURES_DESIGN.md](BACKEND_FEATURES_DESIGN.md) §2 · ⚙️ *원천 거래 xlsx 동기 다운로드로 구현(잡·CSV 아님)*
- [x] 🔴 **구글 드라이브 연동(파일 저장 + 기존 시트 가져오기)** — Google OAuth(별도 레이어)·drive.file+Picker·StorageService·가구 폴더 · [GOOGLE_DRIVE_DESIGN.md](GOOGLE_DRIVE_DESIGN.md) · ⚙️ *설계만 — 미구현(로컬 디스크 저장)*

---

## 3. 프론트엔드 (Frontend)

- [x] 🔴 **프론트 아키텍처** — Next.js 구조·라우팅·렌더링·TanStack Query · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §2·§3·§4
- [x] 🔴 **화면 목록 + IA** — 화면 인벤토리 + 내비게이션 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §5
- [x] 🔴 **핵심 UX 플로우/와이어프레임** — 빠른입력·업로드→검토→확정·월말리뷰 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §6
- [x] 🔴 **검토(review) UI 설계** — 추천 분류·일괄 확정·규칙 학습 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §7 · ⚙️ *설계안 — 실제는 목록 화면 검토(§0.4)*
- [x] 🟡 **디자인 시스템** — Tailwind + shadcn/ui·다크모드·토큰 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §10 · ⚙️ *구현은 수기 CSS 뉴모피즘 테마(globals.css)*
- [x] 🟡 **데이터 페칭 계층** — api-client·캐싱·낙관적 업데이트·무효화 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §8 · ⚙️ *TanStack Query 미도입 — useEffect + fetch*
- [x] 🟡 **폼/검증** — 공유 zod + react-hook-form · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §9 · ⚙️ *미도입 — 제어 컴포넌트 + 서버 검증*
- [x] 🟡 **포맷팅/i18n** — 원화·날짜 로케일(ko-KR) · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §11
- [x] 🟡 **시각화 상세** — 차트별 데이터·인터랙션 정교화(Recharts) · [FRONTEND_UI_SPEC.md](FRONTEND_UI_SPEC.md) §1 · ⚙️ *Recharts 대신 자체 SVG 차트 4종*
- [x] 🟢 **상태 UX 상세** — 로딩/에러/빈/알림 컴포넌트 규격 · [FRONTEND_UI_SPEC.md](FRONTEND_UI_SPEC.md) §2
- [x] 🟢 **반응형·접근성 상세** — 브레이크포인트·a11y 체크리스트 · [FRONTEND_UI_SPEC.md](FRONTEND_UI_SPEC.md) §3

---

## 4. 공통 (Cross-cutting) — 웹·모바일·백엔드 걸침

### 완료
- [x] **모노레포 구조** — pnpm workspaces + Turborepo · [README.md](README.md)
- [x] **공유 패키지(@ledger/shared)** — enum·분류코드·규칙 시드 · [packages/shared](packages/shared)

### 남음
- [x] 🔴 **인증/세션 전략 통합** — 웹(쿠키) vs 모바일(토큰) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §2.3
- [x] 🟡 **공유 검증 스키마(zod)** — 프론트 폼 ↔ 백엔드 DTO 단일 소스 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §9·§13 · ⚙️ *설계만 — 미도입*
- [x] 🟡 **api-client 생성 파이프라인** — OpenAPI JSON → packages/api-client · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §8·§13 · ⚙️ *설계만 — 수기 fetch 래퍼 사용*
- [x] 🟡 **공통 에러 계약** — 에러 타입을 양쪽이 공유 · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §2
- [x] 🟢 **실시간 잡 상태 전송 규약** — 폴링/SSE 선택(양쪽 영향) · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §4 · ⚙️ *폴링만 구현*

---

## 5. 인프라 · 운영 (Infra / Ops)

### 완료
- [x] **DB 연결·스키마** — raw.so4.kr PostgreSQL 18.4, `ledger` 스키마 전용
- [x] **DB 백업·복구** — `pg_dump | gzip` 야간 cron(PM2 `ledger-db-backup`) → rclone 로 Google Drive 업로드·복구 스크립트 · [../docs/DB_BACKUP_RECOVERY.md](../docs/DB_BACKUP_RECOVERY.md) · ⚙️ *운영 레벨 백업 — 앱 내 드라이브 파일저장/시트가져오기(GOOGLE_DRIVE_DESIGN)와는 별개*

### 남음
- [x] 🟡 **로컬 개발 환경** — docker-compose(PostgreSQL + Redis), Node/pnpm 설치 가이드 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §1
- [x] 🟡 **DB 마이그레이션 실행 전략** — dev/staging/prod, 시드 자동화 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §2
- [x] 🟡 **CI/CD** — 빌드·테스트·마이그레이션·배포 자동화 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §3 · ⚙️ *설계만 — PM2 수동 배포 중*
- [x] 🟢 **관측성** — 구조화 로그·메트릭·readiness·Sentry, env 검증 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §4·§1.3

---

## 6. 추천 설계 순서

1. 🔴 **인증/인가** (백엔드 + 공통) — 모든 화면·API의 전제
2. 🔴 **프론트엔드 아키텍처 + 화면/플로우** — 화면 인벤토리·핵심 UX
3. 🔴 **검토(pending) 워크플로** (백엔드 API + 프론트 화면 동시) — 자동입력 완성
4. 🟡 **예산 · 반복 · member 모델 보강**
5. 🟡 **공유 검증(zod) · api-client 생성 · 로컬 dev 환경**

> 각 항목 설계 완료 시: 위 체크박스 `[x]` 처리 + 산출물 링크 추가 + §0 요약 카운트 갱신.
