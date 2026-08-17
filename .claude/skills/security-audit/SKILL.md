---
name: security-audit
description: "가계부(Ledger) 서비스의 보안 취약점을 체계적으로 찾아내고 보완하는 절차. 위협 모델(공개 인터넷 → JWT → 가구 테넌시) 기준으로 인증·세션, 인가·멀티테넌시(IDOR), 입력·주입·파일 업로드, 정보 노출·운영 4개 축을 점검하고, 발견 항목마다 재현(curl)·영향·수정·회귀 테스트를 남긴다. 과거 실제 발견 37건에서 뽑은 회귀 체크리스트와 grep 탐지 명령, 수정 프로토콜, 배포 전 게이트를 포함. 배포 전 점검, 보안 리뷰, '취약점 찾아줘', 인증·권한·테넌시 코드 변경, 신규 API·업로드 기능 추가, 의존성 갱신 시 사용."
---

# 보안 취약점 점검 · 보완 (Ledger)

> 대상: `apps/api`(NestJS+Prisma) · `apps/web`(Next.js) · PostgreSQL `ledger` 스키마
> 운영: 공개 도메인(ledger.so4.kr) · PM2 · 저장소 **공개(PUBLIC)**
> 관련: [design/AUTH_DESIGN.md](../../../design/AUTH_DESIGN.md) · [감사보고서.md](../../../감사보고서.md)(로컬 전용)

---

## 0. 먼저 위협 모델을 세운다 (이걸 건너뛰면 체크리스트가 의미 없다)

| 항목 | 이 서비스의 실제 값 |
|------|--------------------|
| **보호 자산** | 가구의 금융 원장 — 계좌번호·카드번호·거래내역·잔액, 로그인 자격증명, 업로드된 명세서 원본 |
| **신뢰 경계** | ① 인터넷 → API(JWT 검증) ② 인증 사용자 → **가구 스코프**(Prisma 미들웨어) ③ 가구원 → **역할**(owner/member/viewer) ④ 일반 가구 → **슈퍼관리자**(`/admin/*`) |
| **공격자 유형** | (A) 미인증 외부인 (B) **다른 가구의 정상 사용자** ← 가장 현실적 (C) 같은 가구의 `viewer` (D) 유출된 Access 토큰 보유자 |
| **최악의 시나리오** | 다른 가구의 거래·잔액 열람(테넌시 붕괴) · owner 계정 탈취 · 명세서 원본 파일 유출 |

**원칙**: 이 서비스에서 가장 위험한 결함은 XSS/SQLi 가 아니라 **테넌시·인가 붕괴(IDOR)** 다.
점검 시간의 절반을 §2에 쓴다.

---

## 1. 점검 절차 (4단계, 순서대로)

```
① 자동 스캔      의존성·시크릿·타입 — 5분, 매번
② 코드 축별 점검  §2~§5 체크리스트 + grep 탐지 — 축마다 독립적으로
③ 실증(PoC)      실제 HTTP 호출로 재현 — "이론상 가능"은 발견으로 치지 않는다
④ 수정·회귀      수정 + 재현 스크립트를 테스트로 고정 + 문서 반영
```

### ① 자동 스캔 (매 점검 시작)

```bash
cd /home/coder/ledger
pnpm audit --audit-level=high              # 의존성 알려진 취약점
git grep -nE "(password|secret|apikey|api_key|token)\s*[:=]\s*['\"][^'\"]{6,}" -- \
  ':!*.md' ':!pnpm-lock.yaml'              # 하드코딩 시크릿
git log --oneline -20 --name-only | grep -iE "\.env|settings.local|credential"   # 시크릿 커밋 이력
pnpm -r typecheck                          # 타입 붕괴 = 런타임 검증 구멍
```

> 저장소가 **공개**다. 새로 추가하는 파일에 개인정보·인프라 경로·자격증명이 없는지 커밋 전 반드시 확인.
> `.gitignore` 에 `.env`·`.claude/settings.local.json`·`감사보고서.md`·`메모-채성.md`·`uploads/` 가 있는지 점검.

### ②~④ 는 아래 축별로 진행. 각 발견은 §6 양식으로 기록한다.

---

## 2. 축 A — 인가 · 멀티테넌시 (최우선)

### A-1. 테넌시 스코프 우회

이 프로젝트는 `PrismaService.$use` 미들웨어가 `SCOPED_MODELS` 에 `householdId` 를 자동 주입한다.
**미들웨어가 안 닿는 경로가 곧 구멍이다.**

```bash
# 스코프 대상 모델 목록 확인 → 새 모델이 빠지지 않았는지
grep -n "SCOPED_MODELS" -A 25 apps/api/src/prisma/prisma.service.ts
# 미들웨어를 우회하는 raw 쿼리
git grep -nE "\\\$queryRaw|\\\$executeRaw|\\\$transaction\(\[" -- apps/api/src
# 스코프 밖 라우트(의도적으로 전역인 곳)
git grep -rn "SuperAdminGuard\|@Public()" -- apps/api/src
```

점검 질문:
- [ ] 새로 추가한 모델이 `SCOPED_MODELS` 에 등록됐나? (`monthly_*` 4종이 빠져 가구 간 통계가 덮어써진 전례 있음)
- [ ] `findFirst/findMany` 대신 **`findUnique({where:{id}})`** 를 쓴 곳이 있나? → `findUnique` 는 미들웨어의 where 주입이 통하지 않는 경우가 있어 **다른 가구 레코드가 조회된다**. id 조회 후 `householdId` 재확인 필수.
- [ ] `include`/`_count` 로 끌어오는 연관 데이터에도 스코프가 걸리나?
- [ ] 전역 코드성 모델(`category`·`bank_txn_type`·`merchant_category_map`)의 **쓰기**가 아무 사용자에게나 열려 있지 않나? (전례: 인증만 되면 전역 분류 수정·삭제 가능)

### A-2. 교차 테넌트 참조 (IDOR)

바디로 받은 **모든 참조 ID는 내 가구 소유인지 검증**해야 한다.

```bash
git grep -nE "(paymentMethodId|categoryCode|counterpartyId|memberId|accountId|statementId)" \
  -- apps/api/src/**/dto/*.ts
```
- [ ] 위 DTO 필드를 받는 서비스에서 소유권 검사(`findFirst({where:{id, householdId}})`)를 하나?
- [ ] 검사 없이 `create/update` 에 그대로 넣는 곳이 있나? → 다른 가구의 결제수단에 내 거래를 붙일 수 있다.

### A-3. 역할(RBAC)

```bash
git grep -n "@Roles(" -- apps/api/src | sort
git grep -n "RolesGuard\|roles.guard" -- apps/api/src
```
- [ ] **쓰기 라우트(POST/PATCH/DELETE) 전부**에 역할 가드가 붙었나? (전례: `viewer` 가 모든 재무 데이터 수정·삭제 가능)
- [ ] `owner` 전용이어야 하는 것: 구성원 생성/삭제, **email·password·role 변경**, 가구명 변경 (전례: `member` 가 owner 비밀번호 교체 → 계정 탈취)
- [ ] `/admin/*` 는 `SuperAdminGuard` 가 **컨트롤러 레벨**에 붙었나?

### A-4. 슈퍼관리자 경계
- [ ] `is_super_admin` 을 **API 로 바꿀 수 있는 경로가 없나?** (자기 승격 차단 — DB 직접 변경만 허용)
- [ ] JWT 클레임(`sadm`)이 토큰 재발급 때마다 **DB 기준으로 다시 확인**되나?

---

## 3. 축 B — 인증 · 세션

```bash
grep -n "expiresIn\|maxAge\|httpOnly\|sameSite\|secure" apps/api/src/auth/*.ts
grep -n "argon2\|bcrypt" apps/api/src/auth/auth.service.ts
```
- [ ] 비밀번호 해시가 **응답 DTO에 절대 포함되지 않나?** (전례: 구성원 API가 argon2 해시를 그대로 반환 → CRITICAL)
      → `select` 를 명시하거나 응답 매핑 함수를 거치게 한다. `include:{member:true}` 같은 통째 반환 금지.
- [ ] Refresh 쿠키: `httpOnly` `secure`(운영) `sameSite=lax|strict` `path` 제한
- [ ] Refresh **회전 + 재사용 탐지**가 동작하나? 동시 401 다발 시 정상 세션까지 폐기되지 않나(프론트 single-flight)
- [ ] 비활성/삭제된 구성원이 **로그인·토큰 갱신에서 즉시 차단**되나? (전례: 소프트 삭제 후에도 로그인 가능)
- [ ] 로그인 실패 응답이 계정 존재 여부를 흘리지 않나(동일 메시지·유사 응답시간)
- [ ] 브루트포스 방어(레이트리밋)가 로그인·비번재설정에 있나 — **현재 미구현, 도입 검토 대상**

---

## 4. 축 C — 입력 · 파일 · 주입

- [ ] 모든 DTO에 `class-validator` 데코레이터가 있고 `ValidationPipe({whitelist:true, forbidNonWhitelisted:true})` 로 **미정의 필드가 차단**되나?
- [ ] 정렬·필터 파라미터(`sort=col:dir`)가 **화이트리스트**로 검증되나? (임의 컬럼 정렬 차단)
- [ ] 업로드: 확장자·MIME·**크기 상한**·행 수 상한이 있나? `UPLOAD_DIR` 밖으로 나가는 경로 조작(`../`)이 가능한가?
- [ ] 업로드 원본에 접근하는 다운로드 라우트가 있다면 **가구 소유 검증**을 하나?
- [ ] 정규식 규칙(`merchant_category_map.matchType='regex'`)이 사용자 입력 → **ReDoS** 방어(길이 제한·타임아웃)가 있나?
- [ ] 엑셀 내보내기에 **CSV 수식 주입**(`=`,`+`,`-`,`@` 로 시작하는 셀) 방어가 있나?
- [ ] 프론트에서 `dangerouslySetInnerHTML` 사용 여부 — `git grep -n "dangerouslySetInnerHTML" apps/web/src`

---

## 5. 축 D — 정보 노출 · 운영

- [ ] 에러 응답이 스택트레이스·SQL·파일경로를 노출하지 않나(`all-exceptions.filter` 통과 확인)
- [ ] **Swagger `/api/v1/docs` 가 운영에서 공개**되어 있나? → 인증 요구 또는 비활성 검토
- [ ] 계좌번호·카드번호가 목록 응답에 **마스킹 없이** 나가지 않나
- [ ] 로그에 토큰·비밀번호·전체 계좌번호가 찍히지 않나
- [ ] CORS 화이트리스트가 `*` 가 아닌가 / 보안 헤더(HSTS·X-Content-Type-Options·CSP)가 붙나
- [ ] `.env` 의 `JWT_SECRET` 이 기본값이 아니고 충분히 긴가
- [ ] DB 백업본·`uploads/` 가 웹으로 노출되는 경로에 있지 않나

---

## 6. 발견 기록 양식 (모든 항목 동일)

```markdown
### [P0|P1|P2] 제목 (한 줄로 결함을 단정)
- **위치**: `apps/api/src/…/x.service.ts:123`
- **공격자**: 다른 가구의 정상 사용자
- **재현**:
  ```bash
  T=$(curl -s -X POST localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
      -d '{"email":"<가구B계정>","password":"<...>"}' | jq -r .accessToken)
  curl -s "localhost:4000/api/v1/transactions/<가구A의_거래ID>" -H "authorization: Bearer $T"
  # → 200 + 가구 A 데이터 (기대: 404)
  ```
- **영향**: 가구 간 금융정보 유출
- **수정**: (커밋/디프 요약)
- **회귀 테스트**: `apps/api/test/integration/tenancy.spec.ts::다른 가구 거래 조회 404`
```

**심각도 기준**
| 등급 | 정의 | 조치 |
|------|------|------|
| **P0** | 테넌시 붕괴 · 자격증명 유출 · 권한 상승 · 데이터 파괴 | 즉시 수정, 배포 중단 |
| **P1** | 인증 우회 가능성 · 민감정보 과다 노출 · 브루트포스 | 당일~수일 내 |
| **P2** | 하드닝(헤더·레이트리밋·로깅) | 백로그 |

---

## 7. 수정 프로토콜

1. **한 번에 한 결함** — 수정 커밋에 리팩터링을 섞지 않는다(리뷰·롤백 가능성 유지).
2. **재현 → 수정 → 재현 실패 확인**을 같은 세션에서 끝낸다.
3. **회귀 테스트를 남긴다.** 통합 테스트(`apps/api/test/integration/`)에 가구 2개를 만들고 교차 접근이 404/403 인지 검증. 테스트 없는 보안 수정은 다음 리팩터링에서 되돌아온다.
4. **같은 계열을 전수 점검한다.** 한 곳에서 소유권 검증이 빠졌다면 같은 패턴을 모두 grep 해서 함께 고친다.
5. 인증·인가 규칙이 바뀌면 **[AUTH_DESIGN.md](../../../design/AUTH_DESIGN.md) 를 같은 커밋에서 갱신**한다.

---

## 8. 회귀 체크리스트 (과거 실제 발견 — 다시 깨지지 않았는지 매번 확인)

| # | 과거 결함 | 확인 방법 |
|---|-----------|----------|
| 1 | 구성원 API가 argon2 해시 반환 | `curl /household/members` 응답에 `password` 문자열 없음 |
| 2 | `monthly_*` 4종에 `household_id` 없음 → 가구 간 통계 덮어씀 | 스키마에 복합 PK 유지 + `SCOPED_MODELS` 포함 |
| 3 | `member` 가 owner 비밀번호·역할 변경 | `PATCH /household/members/:id {"role":"owner"}` → 403 |
| 4 | 교차 테넌트 FK(IDOR) | 다른 가구 `paymentMethodId` 로 거래 생성 → 400/404 |
| 5 | `viewer` 가 쓰기 가능 | viewer 토큰으로 `POST /transactions` → 403 |
| 6 | 삭제된 구성원이 로그인 가능 | 비활성 계정 로그인 → 401 |
| 7 | 전역 `category` 를 아무나 수정 | 일반 사용자 `DELETE /categories/05` → 403 |

---

## 9. 배포 전 게이트 (하나라도 실패하면 배포 금지)

```bash
pnpm -r typecheck && pnpm --filter @ledger/api test
pnpm audit --audit-level=high
# §8 회귀 체크리스트 7건 수동/자동 확인
git status --short          # 시크릿·개인정보 파일이 스테이징에 없는지
```

---

## 10. 내장 도구와의 역할 분담

| 도구 | 언제 | 무엇을 |
|------|------|--------|
| **이 스킬** | 배포 전·기능 완성 시·인증/권한 변경 시 | 이 서비스 고유의 위협(테넌시·RBAC·금융정보) 전수 점검 |
| `/security-review` | 작업 브랜치 diff 단위 | 변경분에 한정한 일반 취약점 자동 검토 |
| `/code-review` | 매 변경 | 정확성·중복·비효율 (보안 전용 아님) |
| `pnpm audit` | 의존성 갱신 시 | 알려진 CVE |

> 셋은 대체 관계가 아니다. `/security-review` 는 **변경분만** 본다 — 이미 존재하는 구조적 결함(테넌시 누락 등)은
> 이 스킬의 전수 점검으로만 잡힌다.
