# 인프라 · 운영 설계서 (로컬환경 · 마이그레이션 · CI/CD · 관측성)

> 백로그 §5 인프라/운영 4항목 통합. 구현 착수의 기반: 개발자가 로컬을 띄우고, 스키마를 안전히 옮기고, 자동 빌드·배포하며, 운영을 관측한다.
> 스택 전제: Node ≥20 · pnpm 9 · Turborepo · NestJS(api+worker) · Next.js(web) · Prisma · PostgreSQL 18.4(`ledger` 스키마, raw.so4.kr) · Redis+BullMQ.
> 연동: [ARCHITECTURE.md](ARCHITECTURE.md) §11(배포·운영) · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md) §5(traceId) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §7(env)

---

## 1. 로컬 개발 환경

### 1.1 구성 (docker-compose)

로컬은 **인프라 의존물(PostgreSQL·Redis)만 컨테이너**로 띄우고, api/worker/web은 호스트에서 `pnpm dev`(핫리로드)로 실행한다. — 전체 컨테이너화보다 반복 속도가 빠름.

```yaml
# docker-compose.yml (개발용)
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: ledger
      POSTGRES_PASSWORD: ledger
      POSTGRES_DB: ledger
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ledger"]
      interval: 5s
      timeout: 3s
      retries: 10
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes: { pgdata: {} }
```

- **스키마 격리**: 운영과 동일하게 `ledger` 스키마 사용(Prisma `datasource` URL에 `?schema=ledger`). 로컬 DB명도 `ledger`로 통일.
- 프로덕션 Docker(api/worker/web 이미지)는 §3 CI/CD에서 별도 멀티스테이지 빌드로 다룬다.

### 1.2 온보딩 절차

```bash
# 0) 전제: Node 20+(nvm), pnpm 9(corepack enable)
corepack enable && corepack prepare pnpm@9 --activate
pnpm install                    # 워크스페이스 전체 설치

# 1) 인프라 기동
docker compose up -d            # postgres + redis (healthy 대기)
cp .env.example .env            # 로컬 기본값

# 2) DB 준비
pnpm db:migrate                 # prisma migrate dev (스키마 적용)
pnpm db:seed                    # 코드성 시드(category/bank_txn_type/merchant rule)

# 3) 개발 서버
pnpm dev                        # turbo: api(3001) + web(3000) 동시 핫리로드
```

### 1.3 환경변수 (`.env.example`) + 검증

`@nestjs/config` + **zod 스키마로 부팅 시 검증**(누락·오타 즉시 실패, fail-fast).

| 변수 | 예시(local) | 용도 |
|------|-------------|------|
| `DATABASE_URL` | `postgresql://ledger:ledger@localhost:5432/ledger?schema=ledger` | Prisma |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ/캐시 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | (dev 임의값) | AUTH §7 |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `30d` | 토큰 수명 |
| `STORAGE_*` | (로컬 파일/MinIO) | 업로드 파일 저장 |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS 화이트리스트 |
| `NODE_ENV` | `development` | 환경 분기 |
| `LOG_LEVEL` | `debug` | 로깅(§4) |
| `SENTRY_DSN` | (비움) | 에러 추적(§4, 선택) |

```ts
// config/env.schema.ts — 부팅 시 1회 검증
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  // ...
});
// ConfigModule.forRoot({ validate: (raw) => envSchema.parse(raw) })
```

> 시크릿은 `.env`(gitignore). 운영은 플랫폼 시크릿 매니저(§3.4). `.env.example`만 커밋.

---

## 2. DB 마이그레이션 실행 전략

### 2.1 원칙

- **단일 소스 = Prisma migration 파일**(`apps/api/prisma/migrations/`). 수기 DDL 금지, 모두 마이그레이션으로.
- **환경별 명령 분리**:
  | 환경 | 명령 | 성격 |
  |------|------|------|
  | dev(로컬) | `prisma migrate dev` | 마이그레이션 생성+적용+client 재생성 |
  | staging/prod | `prisma migrate deploy` | **생성 없이 적용만**(멱등, 대화형 아님) |
  | CI 검증 | `prisma migrate diff` + `migrate deploy`(임시 DB) | 드리프트·적용 가능성 확인 |
- **공유 스키마 주의**: 대상 PG의 `ledger` 스키마에만 적용. `prisma migrate reset`은 **로컬 전용**(운영 절대 금지 — 가드로 `NODE_ENV=production`이면 차단).

### 2.2 배포 파이프라인상 순서 (확장/수축 패턴)

파괴적 변경(컬럼 삭제·타입 변경)은 **다단계**로 무중단 처리:

```
① 확장(expand): 새 컬럼/테이블 추가(nullable, 기본값) — 구버전 앱과 호환
② backfill: 데이터 채우기(배치) — AUTH §3.2, DOMAIN_MODEL §4의 backfill 참조
③ 앱 배포: 새 컬럼 사용하는 코드 배포
④ 수축(contract): 구 컬럼 제거·NOT NULL 승격 — 다음 릴리스에서
```

- **적용 시점**: 앱 컨테이너 기동 전 **별도 릴리스 스텝**에서 `migrate deploy`(앱 여러 인스턴스가 동시 마이그레이션하는 경쟁 방지). 실패 시 배포 중단.
- **롤백**: Prisma는 자동 down이 없으므로 **전진 수정(forward-fix) 마이그레이션** 원칙 + 배포 전 백업(스냅샷).

### 2.3 시드 전략

- **코드성 시드(멱등 upsert)**: `category`·`bank_txn_type`·`merchant_category_map` 시드는 `prisma/seed.ts`에서 upsert → 모든 환경 안전 재실행(DATABASE §3 시드 데이터).
- **환경 분기**: dev는 데모 거래까지, staging/prod는 코드성 시드만. `SEED_SCOPE=code|demo` 플래그.
- **기존 데이터 마이그레이션**: household 도입(AUTH §9)·member backfill(DOMAIN_MODEL §4)은 **일회성 data migration 스크립트**로 분리(스키마 마이그레이션과 구분, 실행 이력 기록).

---

## 3. CI/CD

### 3.1 CI (PR 게이트) — GitHub Actions

```
on: pull_request
jobs:
  build-test:
    services: { postgres, redis }          # 컨테이너 서비스
    steps:
      - checkout / setup-node 20 / pnpm 9 (corepack)
      - pnpm install --frozen-lockfile
      - turbo run lint typecheck build test  # ← 변경 영향 패키지만(turbo 캐시)
      - prisma migrate deploy (임시 DB)      # 마이그레이션 적용 가능성 검증
      - prisma migrate diff --exit-code       # 스키마 ↔ 마이그레이션 드리프트 차단
```

- **Turborepo 원격 캐시**로 CI 반복 빌드 단축(영향받은 패키지만 재실행).
- **필수 통과 조건**(branch protection): lint·typecheck·build·test·migrate-diff 전부 green.

### 3.2 테스트 레이어 (CI에서 실행)

- 단위(jest)·통합(테스트 DB, `migrate deploy`+truncate)·파서 픽스처. **상세는 테스트 전략 문서(별도)** — 여기서는 CI 실행 훅만 규정.

### 3.3 CD (배포)

```
on: push(main) → build 이미지(api/worker/web 멀티스테이지 Docker)
  → push registry(태그=git sha)
  → staging 자동 배포: [migrate deploy] → api/worker/web 롤링 교체 → smoke test(/health)
  → prod: 수동 승인(environment protection) 후 동일 스텝
```

- **환경 분리**: `dev`(로컬) / `staging`(자동) / `prod`(승인). 각 환경 시크릿·DB 분리.
- **배포 순서 불변식**: **DB migrate → 앱 교체**. 마이그레이션 실패 시 앱 배포 안 함.
- **무중단**: 롤링 배포 + `/health/ready`(§4.3) 통과분만 트래픽 수용.
- **플랫폼**: 초기 Fly.io/Render(관리형, 단순) → 부하 시 AWS/k8s(ARCHITECTURE §11·확정사항 2).

### 3.4 시크릿 관리

- CI: GitHub Actions Secrets/OIDC. 런타임: 플랫폼 시크릿(Fly secrets/Render env). 코드·이미지에 시크릿 미포함.
- `JWT_*`·`DATABASE_URL`은 환경별 별도 값, 정기 로테이션 대상.

---

## 4. 관측성 (Observability)

### 4.1 구조화 로그

- **JSON 구조화 로그**(pino, Nest `LoggerModule`). 필드: `level`,`time`,`traceId`,`userId?`,`householdId?`,`req.method/path`,`latencyMs`,`msg`.
- **traceId 상관**: [API_CONVENTIONS §5](API_CONVENTIONS_DESIGN.md)의 `X-Trace-Id`를 요청 스코프에서 발급·전파 → 응답·로그·에러가 한 traceId로 묶임.
- **민감정보 마스킹**: 계좌/카드번호(`56991*****7307`)·토큰·비밀번호는 로그 리댁션(ARCHITECTURE §10). Access/Refresh 토큰 절대 미기록(AUTH §8).
- `LOG_LEVEL` 환경별: dev=`debug`, prod=`info`.

### 4.2 에러 추적

- **Sentry**(`SENTRY_DSN`) — api/worker/web. 미설정(로컬)이면 no-op. `traceId` 태그로 로그와 교차 조회.
- **에러 봉투 연동**: `INTERNAL`(500)만 Sentry 보고, 4xx(검증·권한)는 노이즈라 제외(API_CONVENTIONS §2.2).

### 4.3 헬스체크 · readiness

| 엔드포인트 | 용도 | 검사 |
|-----------|------|------|
| `GET /health/live` | liveness(프로세스 생존) | 즉시 200 |
| `GET /health/ready` | readiness(트래픽 수용 가능) | DB `SELECT 1` + Redis `PING` |

- 배포 롤링 교체·오케스트레이터가 `ready`로 트래픽 게이팅(§3.3).

### 4.4 메트릭

- **핵심 메트릭**(초기 최소): 잡 처리시간·성공/실패율(BullMQ), API 지연/에러율, DB 커넥션 풀 사용률.
- 노출: `GET /metrics`(Prometheus 포맷) 또는 플랫폼 기본 메트릭. 대시보드·알림은 후순위.
- **잡 실패 알림**: DLQ 적재(API_CONVENTIONS §4.4) 시 경보 → 운영 재처리.

---

## 5. 스키마/코드 영향

- 신규: `docker-compose.yml`, `.env.example`, `config/env.schema.ts`, `health` 모듈(live/ready), `prisma/seed.ts`(SEED_SCOPE 분기), `.github/workflows/{ci,cd}.yml`.
- Prisma: `migrations/` 이력 관리, 일회성 data-migration 스크립트 디렉터리(`prisma/data-migrations/`).
- 로깅: pino 도입 + traceId 미들웨어(API_CONVENTIONS §5와 공용).

---

## 6. 확정 필요 사항

1. **배포 플랫폼**: Fly.io vs Render vs AWS(초기 관리형 권장, ARCHITECTURE 확정사항 2).
2. **파일 저장소** — ✅ **구글 드라이브 확정**. 업로드 명세서 파일은 가구 전용 Drive 폴더에 저장하고 `import_job`엔 Drive fileId만 기록. 구글 OAuth(refresh token 암호화 저장)는 앱 JWT 로그인과 별개 레이어(AUTH_DESIGN §11). dev/테스트는 로컬 파일시스템 폴백으로 `StorageService` 인터페이스 뒤에 추상화(Drive ↔ local 스왑).
3. **메트릭 스택**: 자체 Prometheus/Grafana vs 플랫폼 기본(초기 후순위).
4. **원격 캐시**: Turborepo 원격 캐시(Vercel) 사용 여부(팀 규모에 따라).
