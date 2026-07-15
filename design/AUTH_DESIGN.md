# 인증 · 인가 설계서 (Auth & Authorization)

> 대상: NestJS 백엔드 + 웹(Next.js) + 추후 모바일(RN). **API-First** 전제이므로 토큰 기반으로 설계해 세 클라이언트가 동일 인증 흐름을 공유한다.

---

## 1. 핵심 결정 (Key Decisions)

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| D1 | 인증 방식 | **자체 JWT (Access + Refresh)** | 통제·비용, 모바일 친화(토큰). 빠른 출시가 최우선이면 Clerk/Auth0로 대체 가능 |
| D2 | **소유권(테넌시) 단위** | **가구(Household) 기반** | 데이터에 가족 지출(가족 카드·member)이 핵심 → 가구 공유가 자연스러움. (단독 사용도 "1인 가구"로 포함) |
| D3 | 역할 모델 | **owner / member / viewer** (가구 내 RBAC) | 소유자=전체 권한, member=입력·수정, viewer=조회 |
| D4 | Access 토큰 저장 | 웹=메모리, 모바일=SecureStore | XSS 노출 최소화 |
| D5 | Refresh 토큰 저장 | 웹=httpOnly Secure 쿠키, 모바일=Keychain/Keystore | 회전+폐기 관리 |
| D6 | 비밀번호 해시 | **argon2id** (대안 bcrypt) | 최신 권장 KDF |

> ⚠️ **D2가 전체 스키마를 좌우**한다. 모든 도메인 데이터가 `householdId`로 스코프된다. 단일 사용자만 쓸 계획이면 household를 생략하고 `userId` 스코프로 단순화 가능 — 확정 필요.

---

## 2. 인증 방식 (Authentication)

### 2.1 토큰 구조
- **Access Token (JWT)** — 짧은 수명(15분). `sub`(userId), `hid`(householdId), `role`, `exp`. 서버 무상태 검증.
- **Refresh Token** — 긴 수명(30일), **불투명(opaque) 랜덤 문자열**을 DB에 해시 저장. **회전(rotation)** + **재사용 감지(reuse detection)**.

### 2.2 토큰 수명·회전
```
로그인 → Access(15m) + Refresh(30d) 발급, Refresh 는 DB에 해시로 저장
Access 만료 → POST /auth/refresh (Refresh 제출)
   → 기존 Refresh 폐기(revoke) + 새 Refresh 발급 (회전)
   → 이미 폐기된 Refresh 재사용 시 → 해당 계정 토큰 전체 무효화 (탈취 대응)
로그아웃 → 제출된 Refresh 폐기
```

### 2.3 클라이언트별 저장 (D4/D5)
| | Access | Refresh |
|---|--------|---------|
| 웹 | 메모리(JS 변수/상태) | **httpOnly + Secure + SameSite=Strict 쿠키** |
| 모바일 | 메모리 | SecureStore(Keychain/Keystore) |

> 웹 Refresh를 쿠키로 두면 `/auth/refresh`는 CSRF 보호 필요(§8).

---

## 3. 데이터 모델 (신규/변경)

### 3.1 신규 테이블 (Prisma 스케치)
```prisma
model Household {
  id        Int          @id @default(autoincrement())
  name      String
  createdAt DateTime     @default(now()) @map("created_at")
  members   Membership[]
  // 도메인 데이터가 이 household 를 참조 (§3.2)
  @@map("household")
}

enum MemberRole { owner  member  viewer }

model Membership {
  id          Int        @id @default(autoincrement())
  userId      Int        @map("user_id")
  householdId Int        @map("household_id")
  role        MemberRole @default(member)
  createdAt   DateTime   @default(now()) @map("created_at")

  user      User      @relation(fields: [userId], references: [id])
  household Household @relation(fields: [householdId], references: [id])

  @@unique([userId, householdId])
  @@map("membership")
}

model RefreshToken {
  id          Int       @id @default(autoincrement())
  userId      Int       @map("user_id")
  tokenHash   String    @unique @map("token_hash")   // 원문 저장 금지
  familyId    String    @map("family_id")            // 회전 체인 식별(재사용 감지)
  expiresAt   DateTime  @map("expires_at")
  revokedAt   DateTime? @map("revoked_at")
  userAgent   String?   @map("user_agent")
  createdAt   DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])
  @@index([userId])
  @@map("refresh_token")
}

model PasswordResetToken {
  id        Int       @id @default(autoincrement())
  userId    Int       @map("user_id")
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at")             // 짧은 수명(30분)
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])
  @@map("password_reset_token")
}
```

### 3.2 기존 User 확장 + 도메인 소유권
```prisma
model User {
  id            Int          @id @default(autoincrement())
  email         String       @unique
  passwordHash  String       @map("password_hash")
  displayName   String?      @map("display_name")
  isActive      Boolean      @default(true) @map("is_active")
  lastLoginAt   DateTime?    @map("last_login_at")
  createdAt     DateTime     @default(now()) @map("created_at")

  memberships   Membership[]
  refreshTokens RefreshToken[]
  // ...
}
```

**도메인 테이블에 `householdId` 추가 (멀티테넌시 스코프)**
- 소유권 부여 대상: `transaction`, `payment_method`, `counterparty`, `card_statement`, `card_transaction`, `bank_transaction`, `import_job`, (예정)`budget`, 월별 집계 테이블.
- 공용 코드성 테이블은 **전역 공유**로 유지: `category`, `bank_txn_type`, `merchant_category_map`. (단, 가구별 커스텀 분류/규칙을 원하면 이후 `householdId NULL=전역` 방식으로 확장)

> 마이그레이션 주의: 기존 데이터가 있으면 기본 household를 만들고 backfill 후 `NOT NULL` 승격.

---

## 4. 인가 모델 (Authorization)

### 4.1 데이터 스코핑 (테넌시 격리)
- **모든 도메인 쿼리는 요청자의 `householdId`로 필터**된다. 사용자는 자신이 속한 가구 데이터만 접근.
- 구현 옵션(권장): **Prisma Client Extension**으로 `where.householdId` 자동 주입 → 서비스 코드에서 누락 방지. (대안: 각 서비스에서 명시적 필터)

### 4.2 역할별 권한 (가구 내 RBAC)
| 동작 | owner | member | viewer |
|------|:-----:|:------:|:------:|
| 거래/결제수단 조회·통계 | ✅ | ✅ | ✅ |
| 거래 등록·수정·삭제, 업로드·분류 | ✅ | ✅ | ❌ |
| 예산 설정, 가구원 초대/역할변경, 가구 삭제 | ✅ | ❌ | ❌ |

### 4.3 요청 컨텍스트
- 인증 후 요청에 `{ userId, householdId, role }` 주입 → 컨트롤러/서비스에서 `@CurrentUser()`로 접근.
- 다중 가구 소속 사용자는 **활성 가구 선택**(`X-Household-Id` 헤더 또는 Access 토큰의 `hid`)으로 컨텍스트 결정.

---

## 5. API 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|:----:|
| POST | `/auth/signup` | 회원가입(+기본 가구 생성, owner 부여) | ✕ |
| POST | `/auth/login` | 로그인 → Access + Refresh | ✕ |
| POST | `/auth/refresh` | Refresh 회전 → 새 Access + Refresh | ✕(쿠키) |
| POST | `/auth/logout` | 현재 Refresh 폐기 | ✓ |
| GET | `/auth/me` | 내 프로필 + 소속 가구/역할 | ✓ |
| POST | `/auth/password/reset-request` | 재설정 메일 발송(토큰) | ✕ |
| POST | `/auth/password/reset-confirm` | 토큰으로 비밀번호 변경 | ✕ |
| POST | `/auth/password/change` | 로그인 상태 비밀번호 변경 | ✓ |
| GET | `/households` · `/households/{id}/members` | 가구·구성원 조회 | ✓ |
| POST | `/households/{id}/invitations` | 가구원 초대 | owner |
| PATCH | `/households/{id}/members/{userId}` | 역할 변경 | owner |

**응답 예 (login)**
```json
{
  "accessToken": "eyJ...",
  "user": { "id": 1, "email": "u@x.com", "displayName": "본인" },
  "household": { "id": 1, "name": "우리집", "role": "owner" }
}
```
(Refresh 는 httpOnly 쿠키로 별도 Set-Cookie)

---

## 6. NestJS 구현 설계

```
AuthModule
 ├─ controllers: AuthController, HouseholdController
 ├─ services: AuthService, TokenService, PasswordService, HouseholdService
 ├─ strategies: JwtStrategy (passport-jwt, Access 검증)
 ├─ guards: JwtAuthGuard(전역, @Public 예외), RolesGuard
 ├─ decorators: @Public(), @CurrentUser(), @Roles('owner')
 └─ prisma extension: householdScope (자동 where 주입)
```
- **JwtAuthGuard 전역 적용** + `@Public()`로 화이트리스트(login/signup/refresh).
- **RolesGuard** — `@Roles()` 메타데이터와 요청 role 비교.
- **TokenService** — Access 서명/검증, Refresh 생성·해시·회전·재사용 감지.
- 라이브러리: `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `argon2`.

---

## 7. 토큰·정책 기본값 (설정)

| 항목 | 기본값 | env |
|------|--------|-----|
| Access 수명 | 15분 | `JWT_ACCESS_TTL` |
| Refresh 수명 | 30일 | `JWT_REFRESH_TTL` |
| Access 서명 시크릿 | (필수) | `JWT_ACCESS_SECRET` |
| Refresh 시크릿/해시 | (필수) | `JWT_REFRESH_SECRET` |
| 비밀번호 재설정 토큰 수명 | 30분 | `RESET_TTL` |
| 로그인 실패 잠금 | 5회/15분 | `LOGIN_LOCK` |

---

## 8. 보안 고려사항

- **비밀번호**: argon2id 해시, 최소 길이·유출 비밀번호 차단(선택), 저장 시 원문·해시만.
- **Refresh 회전 + 재사용 감지**: 폐기된 토큰 재사용 시 family 전체 무효화(탈취 방어).
- **Rate limiting**: 로그인·재설정 요청에 IP/계정 단위 제한(`@nestjs/throttler`). 실패 누적 시 잠금.
- **CSRF**: 웹 Refresh 쿠키 → `SameSite=Strict` + `/auth/refresh`에 CSRF 토큰(또는 커스텀 헤더 요구).
- **CORS**: 허용 오리진 화이트리스트, 쿠키 사용 시 `credentials: true`.
- **전송/저장 암호화**: 전 구간 HTTPS, 민감정보(계좌·카드번호) at-rest 암호화·화면 마스킹.
- **토큰 노출 최소화**: Access 단명, 로그에 토큰 미기록.
- **감사**: 로그인/로그아웃/비밀번호 변경/역할 변경 이력 기록.

---

## 9. 스키마 변경 요약 (구현 시)

- 신규: `Household`, `Membership`(+`MemberRole`), `RefreshToken`, `PasswordResetToken`
- 확장: `User`(isActive, lastLoginAt)
- 도메인 테이블에 `householdId` FK 추가 + 인덱스 (§3.2)
- 마이그레이션: 기본 가구 생성 → backfill → NOT NULL 승격

---

## 10. 향후 확장 (범위 밖, 후순위)

- 소셜 로그인(Google/Apple) · 2FA(TOTP) · 앱 잠금(PIN/생체) · 매직링크
- 초대 링크/이메일 발송 파이프라인 · 세션 목록/원격 로그아웃 UI

---

## 확정된 결정 (2026-07 확정)
1. **소유권 단위 (D2)** — ✅ **가구(household) 기반 확정**. 모든 도메인 테이블 `householdId` 스코프. (단독 사용자는 "1인 가구".)
2. **인증 방식 (D1)** — ✅ **자체 JWT(Access+Refresh) 확정**. 외부 IdP(Clerk/Auth0) 미채택.
3. **플랫폼 순서** — ✅ **웹 First → 이후 모바일(RN) 앱**. 타입·검증·api-client는 `packages/`로 공유.
4. **로그인 방식** — 이메일+비밀번호(argon2id) 자체 인증. **구글 로그인(소셜)과 구글 드라이브 연동은 별개** — §11 참고.
5. **계정 모델 통합 (2026-07 확정)** — `User`/`Membership` 을 **`household_member` 하나로 통합**. 가족 구성원 = 사람이고, 로그인 필드(email·password_hash·role)는 **nullable**(있으면 앱 사용자, 없으면 추적 전용 가족). refresh_token·password_reset_token·transaction.member_id 모두 `household_member` 참조. 다가구 로그인은 범위 밖(1인 1가구 가정). → 이 문서의 User/Membership 관련 스키마(§3)는 통합 모델로 대체됨.

## 확정 필요 사항 (잔여)
1. 이메일 발송 수단(재설정/초대) — 별도 메일 서비스 필요 여부 (초기 후순위 가능)
2. **구글 계정 연동 범위** — 로그인용 소셜 로그인 포함 여부 vs 드라이브 접근 전용 (§11)

---

## 11. 구글 드라이브 연동 (파일 저장) — 별도 OAuth 레이어

> 업로드 명세서 파일 저장소로 **구글 드라이브**를 사용한다(INFRA_OPS §1.3 확정). 이는 **앱 로그인(자체 JWT)과 완전히 별개**의 구글 OAuth 2.0 연결이다.

- **두 개의 인증을 혼동 금지**:
  - **앱 로그인** = 이메일/비밀번호 → 자체 JWT (누가 앱을 쓰는가)
  - **드라이브 연결** = 구글 OAuth 2.0 → Google refresh token (앱이 어느 드라이브에 파일을 두는가)
- **토큰 저장**: 구글 refresh token은 `google_connection`(가칭) 테이블에 **암호화 저장**, 가구 스코프.
- **권한 범위(scope)**: 최소권한 `drive.file`(앱이 만든 파일만 접근) 권장 — 사용자의 다른 드라이브 파일엔 접근 불가.
- **흐름**: 설정 화면에서 "구글 드라이브 연결" → OAuth 동의 → refresh token 저장 → 이후 업로드 파일을 가구 전용 폴더에 저장, `import_job`엔 Drive fileId만 기록.
- 세부(연결 단위·기존 시트 읽기 여부·폴더 구조)는 별도 설계로 확정.
