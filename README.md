# 가계부 (Ledger)

수입·지출 관리 + 은행/카드 명세서 자동 입력 가계부 서비스.
**풀스택 TypeScript 모노레포** — 웹 먼저, 이후 모바일 앱으로 확장한다.

## 문서

| 문서 | 내용 |
|------|------|
| [REQUIREMENTS.md](REQUIREMENTS.md) | 요구사항·기능 정의 |
| [DATABASE.md](DATABASE.md) | DB 설계 (테이블·DDL·집계·정책) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 시스템 아키텍처 (API-First, 적재 파이프라인) |

## 모노레포 구조

```
ledger/
├─ apps/
│  ├─ api/        NestJS 백엔드 (REST API, Prisma)
│  └─ web/        Next.js 웹 (예정)
│  └─ mobile/     React Native (2단계, 예정)
├─ packages/
│  └─ shared/     공유 타입·enum·코드 시드 (@ledger/shared)
├─ package.json   루트 (pnpm workspaces + turbo)
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

## 기술 스택

- **백엔드**: NestJS + Prisma + PostgreSQL
- **웹**: Next.js + React + TypeScript (예정)
- **모바일**: React Native / Expo (2단계, 예정)
- **공유**: `@ledger/shared` — 세 클라이언트/서버가 타입·도메인 코드 공유
- **빌드/도구**: pnpm workspaces, Turborepo

## 시작하기

> 사전 요구: Node ≥ 20, pnpm ≥ 9, PostgreSQL.

```bash
# 1) 의존성 설치
pnpm install

# 2) DB 연결 설정 — .env 의 DATABASE_URL 작성
#    postgresql://USER:PASSWORD@HOST:5432/DBNAME

# 3) Prisma 클라이언트 생성 + 마이그레이션
pnpm db:generate
pnpm db:migrate          # 최초 마이그레이션 생성·적용

# 4) 코드성 마스터 시드 (분류·은행구분·가맹점 규칙)
pnpm db:seed

# 5) API 개발 서버
pnpm --filter @ledger/api dev   # http://localhost:4000/api/v1
```

헬스 체크: `GET /api/v1/health` → DB 연결 확인.

## API 문서

- Swagger UI: `GET /api/v1/docs` · OpenAPI JSON: `GET /api/v1/docs-json`
- 개요: [API_SPEC.md](API_SPEC.md)

## 명세서 업로드 (적재 파이프라인)

```bash
# Redis 필요 (docker run -p 6379:6379 redis)
curl -F issuer=hana_card -F paymentMethodId=3 -F file=@명세서.xlsx \
  http://localhost:4000/api/v1/imports          # → { id, status: queued }
curl http://localhost:4000/api/v1/imports/{id}          # 진행 상태 폴링
curl http://localhost:4000/api/v1/imports/{id}/pending  # 미분류(검토 대기) 건
```

흐름: 업로드 → 파싱(발급사별) → staging 적재 → 자동분류 → 대사(카드대금·자기이체 제외) → 월 재집계.
상세: [ARCHITECTURE.md](ARCHITECTURE.md) §5.

## 다음 작업

- [x] 모노레포 스캐폴딩 + Prisma 스키마
- [x] API 명세(OpenAPI) + 도메인 모듈 (Category / PaymentMethod / Counterparty / Transaction / Statistics / Imports)
- [x] 적재 파이프라인 — 큐(BullMQ) + 발급사별 Excel/CSV 파서 + 자동분류 + 대사 + 집계
- [ ] 인증(Auth) 모듈 — JWT 로그인·가드
- [ ] 검토 UI 연동 엔드포인트 확장 (pending 건 수동 분류 확정 API)
- [ ] 웹 프론트(Next.js) 스캐폴딩 + api-client 생성
- [ ] 파서 별칭 튜닝 (실제 발급사 파일 대조) · 단위 테스트
