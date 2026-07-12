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
| 백엔드 | 13 | 2 |
| 프론트엔드 | 8 | 3 |
| 공통(Cross-cutting) | 7 | 0 |
| 인프라/운영 | 5 | 0 |

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
- [x] 🔴 **검토(pending) 확정 워크플로** — 확정 API + 규칙 학습(피드백) · [REVIEW_WORKFLOW_DESIGN.md](REVIEW_WORKFLOW_DESIGN.md)
- [x] 🟡 **예산(Budget) 모델·API** — 예산 설정·소진율·초과 판정 · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §2
- [x] 🟡 **반복/고정 지출** — is_recurring + 자동 생성 규칙 · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §3
- [x] 🟡 **가족 구성원(member) 모델** — 지출 명의 귀속(본인/가족) · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §1
- [x] 🟡 **API 규약 표준화** — 에러 포맷/코드, 정렬·필터 컨벤션, 커서 페이지네이션 · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §1·§2·§3
- [x] 🟡 **잡 상태 통지 방식** — 폴링 vs SSE/WebSocket, 큐 재시도·DLQ · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §4
- [x] 🟡 **테스트 전략** — 단위/통합/e2e, 테스트 DB, 파서 픽스처(실파일·EUC-KR) · [TEST_STRATEGY_DESIGN.md](TEST_STRATEGY_DESIGN.md)
- [ ] 🟢 **감사 로그** — 거래 수정·삭제·업로드 이력
- [ ] 🟢 **데이터 내보내기** — CSV/Excel export

---

## 3. 프론트엔드 (Frontend)

- [x] 🔴 **프론트 아키텍처** — Next.js 구조·라우팅·렌더링·TanStack Query · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §2·§3·§4
- [x] 🔴 **화면 목록 + IA** — 화면 인벤토리 + 내비게이션 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §5
- [x] 🔴 **핵심 UX 플로우/와이어프레임** — 빠른입력·업로드→검토→확정·월말리뷰 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §6
- [x] 🔴 **검토(review) UI 설계** — 추천 분류·일괄 확정·규칙 학습 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §7
- [x] 🟡 **디자인 시스템** — Tailwind + shadcn/ui·다크모드·토큰 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §10
- [x] 🟡 **데이터 페칭 계층** — api-client·캐싱·낙관적 업데이트·무효화 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §8
- [x] 🟡 **폼/검증** — 공유 zod + react-hook-form · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §9
- [x] 🟡 **포맷팅/i18n** — 원화·날짜 로케일(ko-KR) · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §11
- [ ] 🟡 **시각화 상세** — 차트별 데이터·인터랙션 정교화(Recharts)
- [ ] 🟢 **상태 UX 상세** — 로딩/에러/빈/알림 컴포넌트 규격 (방향만 §12)
- [ ] 🟢 **반응형·접근성 상세** — 브레이크포인트·a11y 체크리스트 (방향만 §10)

---

## 4. 공통 (Cross-cutting) — 웹·모바일·백엔드 걸침

### 완료
- [x] **모노레포 구조** — pnpm workspaces + Turborepo · [README.md](README.md)
- [x] **공유 패키지(@ledger/shared)** — enum·분류코드·규칙 시드 · [packages/shared](packages/shared)

### 남음
- [x] 🔴 **인증/세션 전략 통합** — 웹(쿠키) vs 모바일(토큰) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §2.3
- [x] 🟡 **공유 검증 스키마(zod)** — 프론트 폼 ↔ 백엔드 DTO 단일 소스 · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §9·§13
- [x] 🟡 **api-client 생성 파이프라인** — OpenAPI JSON → packages/api-client · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §8·§13
- [x] 🟡 **공통 에러 계약** — 에러 타입을 양쪽이 공유 · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §2
- [x] 🟢 **실시간 잡 상태 전송 규약** — 폴링/SSE 선택(양쪽 영향) · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §4

---

## 5. 인프라 · 운영 (Infra / Ops)

### 완료
- [x] **DB 연결·스키마** — raw.so4.kr PostgreSQL 18.4, `ledger` 스키마 전용

### 남음
- [x] 🟡 **로컬 개발 환경** — docker-compose(PostgreSQL + Redis), Node/pnpm 설치 가이드 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §1
- [x] 🟡 **DB 마이그레이션 실행 전략** — dev/staging/prod, 시드 자동화 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §2
- [x] 🟡 **CI/CD** — 빌드·테스트·마이그레이션·배포 자동화 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §3
- [x] 🟢 **관측성** — 구조화 로그·메트릭·readiness·Sentry, env 검증 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §4·§1.3

---

## 6. 추천 설계 순서

1. 🔴 **인증/인가** (백엔드 + 공통) — 모든 화면·API의 전제
2. 🔴 **프론트엔드 아키텍처 + 화면/플로우** — 화면 인벤토리·핵심 UX
3. 🔴 **검토(pending) 워크플로** (백엔드 API + 프론트 화면 동시) — 자동입력 완성
4. 🟡 **예산 · 반복 · member 모델 보강**
5. 🟡 **공유 검증(zod) · api-client 생성 · 로컬 dev 환경**

> 각 항목 설계 완료 시: 위 체크박스 `[x]` 처리 + 산출물 링크 추가 + §0 요약 카운트 갱신.
