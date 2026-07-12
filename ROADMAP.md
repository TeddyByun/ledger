# 개발 로드맵 (Development Roadmap)

> 설계(→ `design/`)를 실제 코드로 구현하는 순서와, 착수 전 필요한 결정·정보를 정리한다.
> 원칙: **수직 슬라이스** — 각 Phase 끝에 "실제로 돌아가는 것"이 나온다.

---

## A. 현재 상태 (2026-07 기준)

**있는 것**
- 모노레포: `apps/api`(NestJS) + `packages/shared`(enum·분류코드·규칙 시드). pnpm + Turborepo.
- API 도메인 모듈 **스캐폴드**: `category` · `counterparty` · `payment-method` · `transaction` · `statistics` · `ingestion`(parsers/pipeline/classification/reconciliation/storage) · `health`.
- Prisma **도메인 모델**: User, PaymentMethod, Category, Counterparty, Transaction, BankTxnType, BankTransaction, CardStatement, CardTransaction, MerchantCategoryMap, Monthly*Stat, ImportJob.

**아직 없는 것 (설계엔 있으나 코드 미반영)**
- 🔴 **인증·가구**: Household / Membership / RefreshToken / PasswordResetToken 모델, AuthModule, JWT 가드
- 🔴 **멀티테넌시 스코핑**: 도메인 테이블에 `householdId`, 쿼리 자동 격리
- 🟡 예산(Budget) · 가족구성원(HouseholdMember) · 반복(RecurringRule) · 감사(AuditLog) · 구글연동(GoogleConnection)
- 🟡 API 계약: 에러 봉투(`ErrorCode`), 커서 페이지네이션, `sort` 규약
- 🟡 **웹 프론트(`apps/web`)** — 아직 없음 (시안만 `design/mockups/`)

**환경 상태**
- `node_modules` 미설치 (→ `pnpm install` 필요)
- 마이그레이션 0회 (DB 스키마 미적용)
- `docker-compose.yml` 없음, `.env.example` 구버전(인증·드라이브 변수 누락)

> ⚠️ **핵심**: 스캐폴드가 "소유권=가구" 결정 **이전**에 만들어졌다. Phase 1에서 `householdId` 스코핑을 **소급 반영**하는 게 가장 중요한 기반 작업이다.

---

## B. 개발 순서 (Phases)

각 Phase = 목표 · 주요 작업 · 완료 조건("돌아가는 것").

### Phase 0 — 개발 환경·기반  `~0.5일`
- `pnpm install`, 설계 반영 `.env.example`/`.env`, `docker-compose.yml`(PostgreSQL+Redis), env 검증(zod), `/health/live`·`/ready`.
- 첫 Prisma 마이그레이션 + 코드성 시드(category·bank_txn_type·merchant rule).
- **완료**: `pnpm dev`로 API가 뜨고 `/health/ready`가 DB·Redis OK.

### Phase 1 — 인증 · 가구 · 스코핑  `핵심 전제`
- 모델 추가: Household, Membership(+MemberRole), RefreshToken, PasswordResetToken. User 확장.
- 도메인 테이블에 `householdId` FK + 인덱스, **Prisma Client Extension으로 where 자동 주입**.
- AuthModule: signup(+기본 가구 생성)·login·refresh(회전/재사용 감지)·logout·me, argon2, JwtAuthGuard(전역)+@Public, RolesGuard.
- **완료**: 회원가입→로그인→`/auth/me`, 타 가구 데이터 접근 차단(통합테스트).

### Phase 2 — 마스터 + 수기 거래 (CRUD·조회)
- 기존 category/payment-method/counterparty/transaction/statistics 모듈을 **인증·스코프에 결선**.
- 에러 봉투 전역 필터, 거래 목록 커서 페이지네이션·`sort`·필터, 공유 zod 검증.
- **완료**: 로그인 후 결제수단·분류 등록 → 수기 거래 입력·목록·월 통계 조회. (파서 없이도 "가계부"가 됨)

### Phase 3 — 업로드 · 파서 · 파이프라인  `최대 난이도`
- StorageService(로컬 폴백) → `POST /imports` → BullMQ 잡 → 발급사별 파서(하나/현대/신한/삼성/은행), EUC-KR 디코딩.
- **실파일 골든 픽스처**로 파서 TDD(TEST_STRATEGY §4). 잡 상태 폴링.
- **완료**: 실제 명세서 업로드 → `card_statement`/`card_transaction`(또는 `bank_transaction`) 무손실 적재.

### Phase 4 — 자동분류 · 대사 · 집계 · 검토
- merchant_category_map 자동분류 → transaction 생성·연결, 미매칭 pending.
- 대사: 카드대금(card_settlement)·자기이체(self_transfer) 제외. 월 rebuild(monthly_*).
- 검토(pending) 확정 API + 규칙 학습(REVIEW_WORKFLOW).
- **완료**: 업로드→자동분류→검토 확정→대시보드 집계 반영 end-to-end.

### Phase 5 — 부가 도메인 + 운영
- 예산(Budget)·구성원(HouseholdMember)·반복(RecurringRule) 모델·API(DOMAIN_MODEL).
- 감사 로그(AuditInterceptor)·데이터 내보내기(CSV/XLSX).
- **완료**: 예산 소진율/초과, 구성원 귀속, 감사·export 동작.

### Phase 6 — 구글 드라이브 연동
- GoogleConnection(암호화), OAuth(가구 owner)·drive.file+Picker, StorageService=Drive 전환.
- 기존 "가계 정리" 시트 가져오기(Sheets API → 검토 경유 적재).
- **완료**: 드라이브 연결 → 업로드 파일 Drive 저장 + 기존 시트 이관.

### Phase 7 — 웹 프론트 (`apps/web`, Next.js)
- 시안(`design/mockups/`)을 실제 앱으로: 로그인 → 대시보드 → 월/년 결산 → 카드/은행 내역.
- api-client 생성(OpenAPI), TanStack Query, 공유 zod, Recharts, 다크모드.
- **완료**: 로그인해 실제 데이터로 6개 화면 사용.

> 병행 가능: Phase 2 완료 후 Phase 7(웹)을 백엔드 3~6과 나란히 진행 가능.

---

## C. 착수 전 필요한 결정 · 정보

### 🔴 C1. 지금 필요 (Phase 0~1 진행에 막힘)
| 항목 | 내용 | 기본/권장 |
|------|------|-----------|
| **개발용 DB** | 로컬 docker PostgreSQL vs 현재 `.env`의 실 DB(raw.so4.kr) | **로컬 docker 권장**(실 DB 오염 방지, INFRA_OPS §1). 실 DB로 할지 확인 필요 |
| **의존성 설치** | `pnpm install` + 설계 누락 패키지 추가(아래 E) 실행 승인 | 진행 승인만 주시면 됨 |
| **JWT 시크릿** | `JWT_ACCESS_SECRET`·`JWT_REFRESH_SECRET` | 제가 랜덤 생성해 `.env`에 넣겠음 |

### 🟡 C2. 단계별 필요 (해당 Phase 전까지)
| Phase | 항목 | 비고 |
|------|------|------|
| 3 | **실제 명세서 파일(마스킹본)** — 하나/현대/신한/삼성 카드 + 은행 각 1장 | 파서 정확도의 핵심. 없으면 합성 픽스처로 시작(재작업 위험) |
| 6 | **Google Cloud OAuth 클라이언트** — `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` | Google Cloud Console에서 발급 필요(사용자) |
| 6 | `STORAGE_ENC_KEY` (refresh token 암호화) | 제가 생성 가능 |
| 1 | 이메일 발송 수단(비밀번호 재설정·초대) | **후순위 가능** — 초기엔 재설정 스텁 |

### ⚪ C3. 후순위 (Phase 5~7 이후)
- 배포 플랫폼(Fly.io/Render/AWS), 관측성 스택(Sentry/메트릭), 도메인·HTTPS, 구글 앱 OAuth 검수(외부 배포 시).

---

## D. 추가할 의존성 (설계 대비 누락)

```
# 인증 (Phase 1)
@nestjs/jwt @nestjs/passport passport-jwt argon2
# 검증 공유 (Phase 2) — packages/shared
zod
# 파서 인코딩 (Phase 3)
iconv-lite
# 로깅/관측 (Phase 0~)
nestjs-pino pino-http
# 내보내기 (Phase 5)
exceljs fast-csv
# 구글 연동 (Phase 6)
googleapis
```

---

## E. `.env` 변수 (설계 반영 최종안)

| 변수 | 용도 | Phase |
|------|------|:---:|
| `DATABASE_URL` | Prisma (`?schema=ledger`) | 0 |
| `REDIS_URL` | BullMQ/캐시 | 0 |
| `PORT` | API 포트 | 0 |
| `NODE_ENV` `LOG_LEVEL` | 환경·로깅 | 0 |
| `JWT_ACCESS_SECRET` `JWT_REFRESH_SECRET` | 토큰 서명 | 1 |
| `JWT_ACCESS_TTL`(15m) `JWT_REFRESH_TTL`(30d) | 토큰 수명 | 1 |
| `WEB_ORIGIN` | CORS | 1 |
| `STORAGE_DRIVER`(local\|google) `UPLOAD_DIR` | 저장소 | 3/6 |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_REDIRECT_URI` | 드라이브 OAuth | 6 |
| `STORAGE_ENC_KEY` | refresh token 암호화 | 6 |

---

## F. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| **파서 회귀**(발급사·EUC-KR, 최대) | 실파일 골든 픽스처 조기 확보 + 파서 TDD |
| **household 스코핑 소급** 누락 → 데이터 유출 | Prisma Client Extension 자동 주입 + 스코프 격리 통합테스트 |
| **실 DB 직접 개발** 오염 | 로컬 docker DB 사용, 실 DB는 staging/prod |
| 스캐폴드-설계 갭 | Phase 1~2에서 에러봉투·페이지네이션·스코프 일괄 결선 |

---

## G. 다음 액션

1. **C1 결정 확인** — 개발용 DB(로컬 docker vs 실 DB), 의존성 설치 승인.
2. Phase 0 착수: `.env` 정비 · `docker-compose.yml` · `pnpm install` · 첫 마이그레이션·시드.
3. Phase 1 착수: 인증·가구·스코핑.
