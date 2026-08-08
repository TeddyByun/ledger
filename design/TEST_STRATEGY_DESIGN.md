# 테스트 전략 설계서 (Test Strategy)

> 백로그 백엔드 「테스트 전략」. 단위/통합/e2e 계층, 테스트 DB, 파서 픽스처(실파일·EUC-KR)를 규정한다.
> 이 프로젝트의 **고위험 지점**(발급사별 명세서 파싱·금액 규칙·자기이체/카드대금 제외·할부 회차·멀티테넌시 격리·집계 rebuild)에 테스트를 집중한다.
> 연동: [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §3.2(CI 실행) · [DATABASE.md](DATABASE.md) §1·§7(파싱·대사 규칙) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §4(스코프) · [REVIEW_WORKFLOW_DESIGN.md](REVIEW_WORKFLOW_DESIGN.md) · [../감사보고서.md](../감사보고서.md)

---

## 0. 현재 구현 상태 (2026-07-25)

하네스는 설치·동작 확인 완료. 테스트 내용은 §2 우선순위대로 채워 나간다.

| 항목 | 상태 |
|------|------|
| jest 29 + ts-jest (ESM) | ✅ 설치 — `apps/api/jest.config.mjs` |
| `unit` / `integration` / `e2e` 3-프로젝트 분리 | ✅ 설정 |
| 테스트용 tsconfig | ✅ `apps/api/tsconfig.spec.json` (`pnpm typecheck:test` 로 검증) |
| TZ·NODE_ENV 고정 | ✅ `test/setup-env.ts` + 스크립트의 `TZ=Asia/Seoul` |
| 테스트 DB 준비/격리 훅 | ✅ 스캐폴드 — `test/integration/global-setup.ts`, `setup-db.ts` |
| 단위 테스트 | 🟡 26건 (파서 정규화 유틸 + 신한 파서) |
| 통합 테스트 | ❌ 미작성 — §2.3(테넌시 격리)부터 |
| e2e 테스트 | ❌ 미작성 |
| 프론트 테스트 | ❌ 미착수 (§6) |
| CI 게이트 | ❌ 미착수 (§5.2) |

**ESM 주의**: `apps/api` 는 `"type": "module"` 이라 jest 를 `NODE_OPTIONS=--experimental-vm-modules` 로 띄워야 한다(스크립트가 자동 부착). 소스가 `../x.js` 로 import 하므로 `moduleNameMapper` 가 `.js` 를 벗겨 `.ts` 를 찾는다. `module: NodeNext` + `emitDecoratorMetadata` 조합은 `isolatedModules` 와 충돌하므로(TS1272) ts-jest 의 TS151002 경고만 끄고 타입체크는 유지한다.

---

## 1. 테스트 피라미드 (계층 · 비중)

| 계층 | jest project | 도구 | 비중 | 대상 | 인프라 |
|------|---|------|:---:|------|---|
| **단위(unit)** | `unit` | jest | ~70% | 순수 로직: 파서 정규화, 금액 규칙, 분류 매처, 날짜/시간대, zod 스키마 | 없음 |
| **통합(integration)** | `integration` | jest + 테스트 DB | ~25% | 서비스↔Prisma↔PG: CRUD·스코프 필터·집계 rebuild·확정 트랜잭션·큐 프로세서 | PG |
| **e2e** | `e2e` | Supertest(HTTP) | ~5% | 핵심 플로우 end-to-end(가드·필터·봉투 포함) | PG (+Redis) |

- **원칙**: 도메인 규칙은 **단위에서 빠르게**, DB·트랜잭션 경계는 **통합에서 실제 PG로**, 사용자 여정은 **소수의 e2e로**. Mock은 외부 경계(스토리지·메일)만, Prisma는 가급적 실제 테스트 DB(모킹은 취약).
- **커버리지 목표**: 라인 전역 강제보다 **핵심 모듈 집중**(파서·집계·인증·확정 서비스 ≥85%), 나머지는 참고 지표. 현재 `coverageThreshold.global.lines = 0` — 리포트만 내고 게이트는 §2.1~2.3 이 채워진 뒤 올린다.

### 1.1 알려진 결함을 테스트로 고정하는 방법 — `it.failing`

감사에서 확인된 미수정 결함은 **지금 테스트로 박아둔다.** jest 29 의 `it.failing` 은 본문이 실패할 때 통과하므로, 스위트를 녹색으로 유지하면서 결함을 문서화한다. 결함을 고치면 그 테스트가 빨개지고, 그때 `.failing` 을 떼면 정상 회귀 테스트가 된다.

```ts
// 감사보고서 P1 #7 — 신한 dedupHash 에 회차 누락
it.failing('회차가 다르면 dedupHash 도 달라야 한다 (미수정)', () => {
  expect(parseOne('2').dedupHash).not.toBe(parseOne('1').dedupHash);
});

// 동시에 "현재 동작"도 고정해 의도치 않은 변경을 잡는다
it('현재는 회차가 달라도 해시가 동일하다 — 유실 재현', () => {
  expect(parseOne('2').dedupHash).toBe(parseOne('1').dedupHash);
});
```

이 패턴을 §2.6 표의 모든 항목에 적용하는 것이 **1차 목표**다. 버그 수정보다 테스트가 먼저 들어가야 수정이 진짜 고쳐졌는지 알 수 있다.

---

## 2. 무엇을 반드시 테스트하는가 (위험 기반)

### 2.1 파서 / 적재 (최우선)
발급사마다 포맷이 다르고 금액 규칙이 미묘해 **회귀 위험 최고**(DATABASE §1.5~1.8).

- 발급사별 정규화: 하나/현대/신한/삼성 카드 + 은행 → 공통 `card_transaction`/`bank_transaction` 스키마.
- **금액 규칙**(골든 케이스):
  - 카드 지출 = `principal + fee`(할부 이자 포함). 일시불 `fee=0`.
  - 할부 회차: `이용금액 480,000 / 회차 / principal 20,000` → 그 달 지출 **20,000+이자**(총액 아님).
  - 현대카드 적립 vs 할인 판별(`principal < usage` → 할인 음수 / `=usage` 양수 → 적립).
  - 신한 취소 3행(정상→취소→재승인)에서 `principal=0` 행 제외, 실청구만.
  - 삼성 `yyyymmdd` 무구분자 날짜 파싱, 선입금/할인 조정 음수 행.
  - `principal=0` 정보성 행 → `status='info'`(집계 제외).
- **`dedupHash` 계약** — §4.4. 회차·할부기간이 키에 포함되어야 한다.
- **섹션 경계** — 상세내역 섹션이 끝나는 지점에서 파싱을 멈춰야 한다(신한의 '5.취소매출 상세내역' 을 거래로 오인하지 않음).
- **대사(reconciliation)**: 자기 계좌 간 이체 쌍 매칭 → `exclude_reason='self_transfer'`; 카드대금 출금 매칭 → `card_settlement`(DATABASE §7.1·§7.2). **오탐 테스트가 정탐 테스트보다 중요하다** — §2.6 참조.
- **인코딩**: EUC-KR/CP949 원본 파일 디코딩(§4.3).
- **richText 셀**: 부분 서식이 적용된 엑셀 셀이 `[object Object]` 가 되지 않아야 한다(§4.4).

### 2.2 집계 (rebuild 정확성)
- 월 rebuild 후 `monthly_summary`/`category`/`source`/`payment`가 `transaction`(`amount NOT NULL AND status='settled'`)과 일치.
- **집계제외 분류 일관성** — `rebuild` / `monthlyTrend` / `paymentTrend` / `dashboard` / `forecast` / `suggestion` **6개 경로가 같은 달에 같은 값**을 내야 한다. 한 경로만 필터가 빠지면 이중 계상이 되는데 단일 경로 테스트로는 절대 안 잡힌다 → **경로 간 교차 일치(cross-consistency) 테스트**로 작성한다.
- 대분류 예산 vs 소분류 실적 **롤업 합산**(DOMAIN_MODEL §2.3).
- **멱등성**: 같은 월 rebuild 2회 = 1회와 동일(삭제 후 재삽입).
- **가구 격리**: 가구 A 의 rebuild 가 가구 B 의 집계 행을 건드리지 않아야 한다(§2.3 과 겹치는 최우선 항목).

### 2.3 멀티테넌시 / 인가 (보안)
- **가구 스코프 격리**: household A 사용자가 B의 거래/예산/결제수단 **조회·수정 불가**(householdScope 자동 주입 검증) — 누락 시 데이터 유출.
- **Prisma 미들웨어의 사각지대를 명시적으로 테스트한다.** `$use` 는 최상위 `params.model` 에만 걸리므로 다음 두 경로는 자동 스코핑이 **되지 않는다**:
  1. `SCOPED_MODELS` 에 없는 모델 (`Category`, `BankTxnType`, `MerchantCategoryMap`, `Monthly*`)
  2. **nested `include`/`select` 로 따라간 관계** — `include: { paymentMethod: true }` 는 타 가구 레코드를 그대로 실어 보낸다
  → **모델 목록을 순회하며 "스코프 대상인지"를 단정하는 메타 테스트**를 두어, 새 모델 추가 시 `SCOPED_MODELS` 등록 누락을 CI 에서 잡는다.
- **응답 필드 화이트리스트**: 사용자 표현형에 `passwordHash` 같은 비밀 필드가 절대 실리지 않는지. 서비스 반환값을 스냅샷하지 말고 **금지 키 목록으로 단정**한다(`expect(Object.keys(m)).not.toContain('passwordHash')`) — 필드가 추가돼도 계속 유효하다.
- **참조 ID 소유권**: `paymentMethodId`·`counterpartyId`·`memberId` 에 타 가구 id 를 넣은 요청이 400 으로 거부되는지(생성 성공 후 조회로 유출되는 IDOR 방지).
- RBAC: viewer의 쓰기 차단, member의 예산설정·타인 정보 수정 차단, owner 전용 동작(AUTH §4.2). **`@Roles` 미부착 라우트가 곧 전면 개방**이므로, 라우트 목록을 순회해 쓰기 메서드(POST/PATCH/DELETE)에 역할 제한이 걸렸는지 단정하는 메타 테스트를 둔다.
- 토큰: Access 만료→refresh 회전, **Refresh 재사용 감지 시 family 전체 무효화**(AUTH §2.2), **동시 refresh 시 세션이 죽지 않는지**.
- 구성원 비활성/삭제 후 **로그인·refresh 가 모두 차단**되는지.

### 2.4 확정 워크플로 / 큐
- `classifyBatch` **원자성**: 일부 실패 시 성공분만 커밋되지 않고 롤백/부분커밋 정책대로 동작(REVIEW §4.2).
- **트랜잭션 경계**: 거래 생성 ↔ 원천 연결, 일괄 삭제의 두 `deleteMany`, `clearSelf` ↔ 구성원 저장 — 각각 **중간 실패를 주입해** 고아 레코드가 남지 않는지 검증한다(Prisma 클라이언트를 스파이로 감싸 2번째 호출만 throw).
- 규칙 학습 upsert + classifier 캐시 무효화, 확정 후 영향 월 rebuild.
- 반복지출 생성 **멱등성**(`lastGeneratedYm`), pending 생성(DOMAIN_MODEL §3.4).
- BullMQ 프로세서: 실패 재시도→DLQ, 중복 파일 CONFLICT(API_CONVENTIONS §4.4). **재시도 멱등성** — 같은 잡을 2회 실행해도 거래가 2배가 되지 않아야 한다.

### 2.5 API 계약
- 에러 봉투 형태·`ErrorCode`, 커서 페이지네이션 왕복, `sort` 화이트리스트, 알 수 없는 필터 400(API_CONVENTIONS §2·§3).
- 공유 zod 스키마: 프론트 폼 = 백엔드 DTO 동일 검증(경계값: amount>0, 날짜 형식).
- **DB 제약 위반이 500 으로 새지 않는지**: FK RESTRICT(P2003)·유니크(P2002)가 4xx 로 매핑되는지. 예외 필터에 스택/Prisma 원문이 실리지 않는지.
- **업로드 검증**: 크기 초과·허용 외 확장자·매직바이트 불일치가 400 으로 거부되는지.

### 2.6 감사 결함 → 테스트 매핑 (1차 작업 목록)

[감사보고서](../감사보고서.md)의 확정 항목을 **테스트가 있었다면 잡혔을 것** 기준으로 정렬했다. 위에서부터 작성한다.

| 감사 # | 결함 | 계층 | 테스트 케이스 |
|:---:|------|:---:|------|
| P1 #7 | 신한 `dedupHash` 회차 누락 → 할부 2회차 유실 | unit | ✅ 작성됨 (`card-dedup-contract.spec.ts`) — 4개 파서 전체로 확장 필요 |
| P1 #11 | 신한 파서가 '취소매출' 섹션을 유령 거래로 적재 | unit | 섹션 헤더 뒤 행이 파싱되지 않음 |
| P1 #15 | richText 셀 → `[object Object]` | unit | `{richText:[{text}]}` 셀이 원문으로 복원됨 |
| P1 #14 | CSV EUC-KR 미디코딩 | unit | UTF-8 / UTF-8+BOM / CP949 3종 동일 결과 |
| P1 #12 | KST/UTC — 월 1일 오전에 지난달 계산 | unit | `setSystemTime(KST 08-01 07:00)` → `ym === '2026-08'` |
| P1 #8 | `rebuild()` 만 집계제외 필터 누락 | integration | 6개 집계 경로 교차 일치 |
| P1 #9 | matchKey 없는 정기지출 이중 계상 | unit | forecast total = 실지출 + 미발생분, 중복 없음 |
| P1 #10 | 자기이체 대사 오탐(`owner=null`) | unit | 무관한 두 거래(우연히 동일 금액)가 매칭되지 않음 |
| P1 #13 | 일괄 분류가 반대 유형 분류 허용 | unit+e2e | 출금 행에 수입 분류 → 400 |
| P0 #1 | `passwordHash` 응답 노출 | integration | 금지 키 단정 (§2.3) |
| P0 #2 | `monthly_*` 가구 스코프 없음 | integration | A 의 rebuild 후 B 의 집계 불변 + 조회 격리 |
| P0 #3 | member 가 owner 비밀번호 변경 | e2e | member 토큰으로 타인 PATCH → 403 |
| P0 #4 | 교차 테넌트 FK (IDOR) | integration | 타 가구 `paymentMethodId` → 400 |
| P0 #5 | viewer 가 모든 쓰기 가능 | e2e | 라우트 순회 메타 테스트 (§2.3) |
| P0 #6 | 삭제된 구성원이 로그인 가능 | integration | 삭제 후 login·refresh 모두 401 |
| P2 #16~19 | 트랜잭션 원자성 4건 | integration | 실패 주입 후 고아 레코드 0 (§2.4) |
| P3 #21~24 | 레이트리밋·CORS·Swagger·업로드 제한 | e2e | 429 / Origin 거부 / prod 404 / 413·400 |
| P4 #26 | `findUnified` 무제한 로드 | integration | 대량 시드 후 쿼리 수·`take` 존재 단정 |
| P5 #27 | 동시 401 시 refresh 병렬 → 세션 폐기 | 프론트 unit | 동시 5요청 → `/auth/refresh` 1회만 호출 |

---

## 3. 테스트 DB 전략 (통합)

- **실제 PostgreSQL 사용**(SQLite 대체 금지 — PG 전용 동작·`ledger` 스키마·Decimal 정합). 로컬은 docker-compose PG, CI는 서비스 컨테이너(INFRA_OPS §1·§3.1).
- **전용 DB 강제**: `TEST_DATABASE_URL` 환경변수가 **필수**이고, DB 이름에 `test` 가 없으면 거부한다(`global-setup.ts`). 개발/운영 DB 를 truncate 하는 사고를 원천 차단한다.
  ```bash
  export TEST_DATABASE_URL='postgresql://ledger:ledger@localhost:5432/ledger_test?schema=ledger'
  pnpm --filter @ledger/api test:integration
  ```
- **스키마 준비**: 스위트 시작 시 `prisma migrate deploy` + 코드성 시드(`prisma/seed.ts`).
- **격리 방식**:
  | 방식 | 채택 | 비고 |
  |------|:---:|------|
  | 테스트 간 **truncate + 시드 유지** | ✅ 기본 | `beforeEach` 에서 도메인 테이블 17개만 `TRUNCATE … RESTART IDENTITY CASCADE`. 코드성 마스터(`category`/`bank_txn_type`/`merchant_category_map`)는 유지 |
  | 트랜잭션 롤백 래핑 | 보조 | 단일 커넥션 케이스에 한해 |
  | DB per worker | 병렬 시 | 현재는 `maxWorkers: 1` 로 직렬 실행. 스위트가 늘면 워커별 스키마로 전환 |
- **결정성**: 시간 의존 로직은 `jest.useFakeTimers()` + `setSystemTime(FIXED_NOW)`(= KST 2026-07-15 14:30). 시간대 `TZ=Asia/Seoul` 고정. 랜덤(잡 id 등) 시드 고정.
  > **주의**: 이 프로젝트는 날짜를 "벽시계 값을 UTC 성분에 담는" 규약으로 저장한다(`parseDate` → `Date.UTC(y,m,d)`). 테스트도 이 규약을 그대로 단정해야 하며, `toISOString()` 비교가 가장 안전하다. 반대로 **서비스 코드가 `getUTCMonth()` 로 '현재 월'을 구하는 것은 버그**(§2.6 P1 #12)이므로 두 사안을 혼동하지 말 것.
- **환경**: `NODE_ENV=test` (`setup-env.ts`), `migrate reset` 가드(INFRA_OPS §2.1)와 정합.

---

## 4. 파서 픽스처 (실파일 · 인코딩)

파서 테스트의 신뢰도는 **실제 명세서 기반 픽스처**에서 나온다.

### 4.1 현재 상태와 문제 ⚠️

로컬에 실파일 픽스처 **26개**가 있다.

| 발급사 | 파일 수 |
|---|:---:|
| hana_bank | 9 |
| hana_card | 5 |
| hyundai_card | 4 |
| samsung_card | 4 |
| shinhan_card | 4 |

그런데 `.gitignore:35-37` 이 `**/*.xlsx`·`*.xls`·`*.csv` 를 전부 제외하고 있어 **git 에 추적되는 것은 README 하나뿐이다.** 개인 금융정보를 커밋하지 않으려는 올바른 결정이지만, 결과적으로:

- **CI 에서 파서 테스트를 돌릴 수 없다** — 픽스처가 없으므로 회귀 검증의 핵심이 로컬 전용이 된다.
- 개발자 간에 픽스처가 공유되지 않아 "내 로컬에서는 통과"가 발생한다.
- 실제로 §2.6 의 파서 결함 4건이 이 공백에서 나왔다.

### 4.2 2층 픽스처 전략 (결정)

**커밋 가능한 층과 로컬 전용 층을 분리한다.**

```
apps/api/test/fixtures/
├─ statements/                 # 층 A — 실파일(.xlsx). git 제외, 로컬/개인 보관
│  ├─ hana_card/2026-04.xlsx
│  └─ …
└─ golden/                     # 층 B — 커밋되는 정제 픽스처
   ├─ hana_card/2026-04.rows.json       # readTabular 출력(string[][]) — 스크러빙됨
   ├─ hana_card/2026-04.expected.json   # 파서 기대 출력(NormalizedCardRow[])
   └─ …
```

| | 층 A — 실파일 | 층 B — 골든 JSON |
|---|---|---|
| 형식 | `.xlsx` 원본 | `.rows.json`(readTabular 출력) + `.expected.json` |
| git | ❌ 제외 (`.gitignore`) | ✅ 커밋 |
| 검증 범위 | `readTabular` — exceljs↔SheetJS 폴백, 시트 병합, richText, 인코딩 | 파서 로직 — 정규화·금액·부호·dedupHash |
| 실행 | 로컬만. 파일이 없으면 `describe.skip` 으로 조용히 건너뜀 | 항상 (CI 포함) |

- **층 B 생성**: `pnpm --filter @ledger/api fixtures:build` 스크립트가 층 A 를 읽어 `readTabular` 결과를 JSON 으로 떨어뜨리고, 그 과정에서 **스크러빙**한다 — 카드번호·계좌번호·이름 마스킹, 가맹점명은 사전 치환(`전자랜드 김포점` → `가맹점A`), **금액·날짜·컬럼 구조·행 순서는 그대로 보존**(파서 로직 검증에 필요). 스크러빙 후 원본 대조는 사람이 리뷰한다.
- **골든 파일 방식**: `parse(rows.json) === expected.json` 비교. 규칙을 의도적으로 바꿀 때만 `expected` 를 갱신하고 **diff 를 PR 리뷰에서 확인**한다. `jest -u` 를 무심코 돌리지 않도록 `toMatchSnapshot` 대신 명시적 JSON 파일 비교를 쓴다.
- **엣지 픽스처**: 잔액 `-`(NULL), 적요 공란(현금), `principal=0` 정보행, 선입금 조정 음수, 할부 3/3, 취소 3행, 해외이용, '취소매출 상세내역' 섹션, richText 셀 — §2.1·§2.6 케이스를 **각각 최소 1건** 포함. 실파일에 없는 케이스는 **손으로 쓴 최소 `rows.json`** 으로 만든다(신한 회차 테스트가 이 방식).

### 4.3 인코딩

- 은행/카드 다운로드 원본은 **EUC-KR(CP949)** 가 흔하다. 현재 `readCsv` 는 `buffer.toString('utf-8')` 뿐이라 CP949 파일의 한글이 전부 깨진다(§2.6 P1 #14).
- 테스트: 동일 내용을 **UTF-8 / UTF-8+BOM / CP949** 3종 버퍼로 만들어 `readTabular` 결과가 동일한지 검증. 픽스처를 파일로 두지 않고 테스트 안에서 `iconv.encode(text, 'cp949')` 로 생성하면 커밋 가능하고 의도가 드러난다.
- 한글 가맹점명(`대성석유(주)…`)이 `U+FFFD` 로 치환되지 않는지 단정.

### 4.4 파서 계약 테스트

각 발급사 어댑터가 **공통 인터페이스**(`StatementParser` → `ParseResult`) 계약을 지키는지 **하나의 스위트로 전 발급사를 순회**한다. 새 발급사 추가 시 이 스위트만 통과하면 파이프라인 호환.

계약 항목:
1. **필수 필드·타입** — `NormalizedCardRow`/`NormalizedBankRow` 의 모든 필드가 채워지고 `NaN`·`Invalid Date` 가 없다.
2. **금액 부호 규약** — 지출은 양수, 취소·환불은 `isCanceled=true`. 발급사마다 다르게 처리하면 하류 합산이 틀어진다.
3. **`dedupHash` 판별력** — 같은 거래는 같은 해시, **다른 청구건은 다른 해시**. 최소한 다음 축이 하나라도 다르면 해시가 달라야 한다: 이용일 · 가맹점 · 이용금액 · 원금 · 카드번호 · **할부기간** · **회차**. (현재 신한만 뒤 두 축이 빠져 있다 — §2.6 P1 #7)
4. **섹션 경계** — 상세내역 섹션 밖의 행을 거래로 만들지 않는다.
5. **합계 정합** — `statement.totalAmount` 가 `rows` 합계 또는 명세서에 적힌 청구액과 일치한다.

---

## 5. 실행 · CI 통합

### 5.1 명령

| 명령 | 범위 | 인프라 |
|------|------|---|
| `pnpm test` | turbo — 전 패키지 단위 테스트 | 없음 |
| `pnpm --filter @ledger/api test` | api 단위 | 없음 |
| `pnpm --filter @ledger/api test:watch` | api 단위 (watch) | 없음 |
| `pnpm --filter @ledger/api test:cov` | api 단위 + 커버리지 | 없음 |
| `pnpm --filter @ledger/api test:integration` | api 통합 | PG (`TEST_DATABASE_URL`) |
| `pnpm --filter @ledger/api test:e2e` | api e2e | PG + Redis |
| `pnpm --filter @ledger/api test:all` | 3계층 전부 | PG + Redis |
| `pnpm --filter @ledger/api typecheck:test` | 테스트 코드 타입 검증 | 없음 |

- `test` 가 단위만 도는 이유: 인프라 없이 **초 단위로 끝나는 피드백**을 기본값으로 둔다. 통합/e2e 는 명시적으로 호출하거나 CI 에서 돈다.
- `typecheck` (src) 와 `typecheck:test` (src+test)는 별개다 — `apps/api/tsconfig.json` 이 `test` 를 제외하므로 테스트 코드는 후자로만 검증된다. **둘 다 CI 에 넣어야 한다.**

### 5.2 CI (PR 게이트) — 미구현

INFRA_OPS §3.1 과 정합하게 다음 순서로 구성한다:

1. PG + Redis 서비스 컨테이너 기동
2. `pnpm install --frozen-lockfile` → `pnpm build`
3. `pnpm lint` · `pnpm typecheck` · `pnpm --filter @ledger/api typecheck:test`
4. `pnpm test` (단위)
5. `TEST_DATABASE_URL=…ledger_test… pnpm --filter @ledger/api test:integration`
6. `pnpm --filter @ledger/api test:e2e`
7. 커버리지 리포트 업로드

실패 시 머지 차단. **속도**: 단위는 DB 없이 초 단위, 통합은 truncate 재사용으로 스위트 병렬화(현재 `maxWorkers: 1`, 필요 시 DB-per-worker). e2e 는 핵심 플로우만이라 짧게 유지.

---

## 6. 프론트엔드 테스트 (범위 메모)

아직 도구가 설치되지 않았다(`apps/web` 에 test 스크립트 없음). 착수 시:

- 단위: 포맷터(₩·ko-KR 날짜), `lib/api.ts` 의 **refresh single-flight**(§2.6 P5 #27 — 동시 5요청 시 `/auth/refresh` 1회만), zod 폼 검증(공유 스키마 재사용).
- 컴포넌트: Testing Library 로 검토(review) UI·빠른입력 폼 상호작용(추천 채움·일괄 확정). **요청 경쟁**(필터 빠르게 변경 시 옛 응답이 최신 결과를 덮지 않는지)과 **중복 제출**('더 보기' 연타 시 같은 행이 두 번 추가되지 않는지)이 실제 발생 중인 결함이라 우선순위가 높다.
- e2e(후순위): Playwright 로 로그인→업로드→검토→확정 1플로우. **초기 범위는 유닛/컴포넌트 우선**, 브라우저 e2e 는 2차.
- 접근성: 사이드바가 키보드로 도달 가능한지(`userEvent.tab()` → 메뉴 포커스)는 한 줄로 검증되고 현재 실패한다.

---

## 7. 확정 필요 사항

| # | 항목 | 상태 |
|:---:|------|------|
| 1 | **실제 명세서 픽스처 확보/공유** | ✅ 해결 — §4.2 2층 전략(실파일 로컬 + 스크러빙 JSON 커밋). `fixtures:build` 스크립트 구현이 남음 |
| 2 | **테스트 DB 격리** | ✅ 결정 — `TEST_DATABASE_URL` 강제 + 이름에 `test` 필수 + 도메인 테이블만 truncate |
| 3 | **커버리지 게이트 수치** | 🟡 보류 — 현재 0. §2.6 상위 항목이 채워진 뒤 핵심 모듈 85% 로 설정 |
| 4 | **병렬 테스트 격리** | 🟡 보류 — `maxWorkers: 1` 로 시작. 통합 스위트가 20개를 넘으면 DB-per-worker 재검토 |
| 5 | **e2e 도구** | 백엔드는 Supertest 확정. 프론트 Playwright 는 §6 대로 2차 |
| 6 | **가맹점명 스크러빙 사전** | ❓ 미정 — 치환 후에도 분류 규칙(`merchant-rules.ts`) 테스트가 의미를 가지려면 규칙에 걸리는 이름을 남겨야 한다. 규칙 테스트용 이름은 화이트리스트로 보존할지 결정 필요 |
