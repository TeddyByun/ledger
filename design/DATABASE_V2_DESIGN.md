# DB 재설계서 v2 (Master/Code/Transaction 규칙 적용)

> [SKILL_DB_Design.md](../.claude/skills/SKILL_DB_Design.md) 규칙에 맞춰 현행 스키마 20개 테이블을 전면 재설계한다.
> 동시에 두 가지 기능 변경을 반영한다: **① 최초 등록 사용자를 전체 운영자(OPERATOR)로 등록** · **② 사용자(계정) 정보와 가족(구성원) 정보를 분리하고 관계 테이블로 연결**.
> 연동: [DATABASE.md](DATABASE.md)(현행 v1) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §3~4 · [DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §1 · [../감사보고서.md](../감사보고서.md)

---

## 0. 확정된 설계 결정

| # | 결정 | 선택 | 영향 |
|---|------|------|------|
| **V1** | `_mt` 는 다른 `_mt` 를 가리키는 컬럼을 두지 않는다(§5.2) — `household_id` 에도 **엄격 적용** | ✅ 엄격 | 마스터 4종에서 `household_id` 제거 → `household_*_rt` 로 분리. 테넌트 필터가 조인이 된다(§4.2) |
| **V2** | 분류(Category) 소유권 | **전역 마스터 + 운영자 전용 쓰기** | 감사 #20(아무나 전역 분류 CRUD) 해소. 가구별 분류 추가는 불가 |
| **V3** | 식별자 | 전 테이블 `uuid` (`gen_random_uuid()`) | 기존 `Int` 자동증가 전량 재매핑 필요 |
| **V4** | 참조 무결성 | **물리 FK 없음** — 논리 uuid 연결만 | 앱이 보장. Prisma `relationMode = "prisma"` |
| **V5** | enum → 코드 테이블 | Prisma enum 11종 → `_ct` 5개 테이블 + `code_group` | `YesNo` 는 enum 이 아니라 boolean 으로 승격 |
| **V6** | 시스템 역할 | `SYSTEM_ROLE` = `OPERATOR` / `USER` (가구 역할과 **별개 축**) | 최초 가입자만 OPERATOR |
| **V7** | 자기참조 계층 | **인라인 `parent_id` 유지** (SKILL §5.4 예외 B) | `category_mt.parent_id`. `_rt` 로 빼지 않는다 |

### 0.1 V1 의 대가 — 명시해 둠

`household_id` 를 `_rt` 로 분리하면 **현행 보안 장치 하나를 잃는다.** `PrismaService` 의 `$use` 미들웨어는 최상위 모델의 `where` 에 `household_id` 를 자동 주입해 스코프 누락을 구조적으로 막고 있는데, 마스터 4종은 컬럼 자체가 없어져 **자동 주입 대상에서 빠진다.** 감사에서 확인된 최대 리스크가 정확히 "스코프 누락"이었다(#2·#4).

**완화책(필수)**: §4.2 의 `TENANT_VIA_RT` 레지스트리 + §4.3 의 메타 테스트를 함께 구현한다. 마스터를 조회하는 모든 경로가 `_rt` 를 경유하는지 CI 에서 강제한다. 이 완화책 없이 V1 을 적용하면 안 된다.

> 참고: 업무 테이블(`_tt`)은 §8.1 이 인라인 마스터 참조를 허용하므로 `household_id` 를 그대로 갖는다. 즉 **데이터 대부분(거래·명세서·집계 12개 테이블)은 기존 자동 스코핑이 그대로 유효**하고, 조인 스코핑이 필요한 것은 마스터 4개뿐이다.

---

## 1. 테이블 분류표 (v1 → v2)

20개 → **35개**. 증가분은 전부 `_rt`(10개) 와 `_ct`(5개) 이며, enum 11종과 **서로 다른** 마스터 간 관계가 테이블로 승격된 결과다. 자기참조 계층(분류 트리)은 결정 V7 에 따라 인라인 컬럼으로 남는다.

### 1.1 Master (`_mt`) — 8개

| v2 | v1 | 비고 |
|---|---|---|
| `household_mt` | `household` | 가구 |
| `user_mt` | `household_member` (분리) | **계정** — email/password/시스템역할 |
| `family_member_mt` | `household_member` (분리) | **사람** — 지출 명의. 로그인 없어도 존재 |
| `payment_method_mt` | `payment_method` | `household_id`·`owner` 제거 → `_rt` |
| `counterparty_mt` | `counterparty` | `household_id` 제거 → `_rt` |
| `category_mt` | `category` | 전역·운영자 관리. `parent_code` → **`parent_id` 인라인 유지**(V7) |
| `merchant_rule_mt` | `merchant_category_map` | 전역·운영자 관리. `category_code` → `_rt` |
| `recurring_expense_mt` | `recurring_expense` | 정책성 기준정보. 3개 참조 → `_rt` |

### 1.2 Code (`_ct`) — 5개 (도메인별 1개 + `code_group`)

| v2 | `code_group` | v1 출처 |
|---|---|---|
| `user_ct` | `SYSTEM_ROLE` · `HOUSEHOLD_ROLE` · `MEMBER_RELATION` | (신규) · `MemberRole` · `relation` 자유문자열 |
| `payment_ct` | `METHOD_TYPE` · `ISSUER` | `MethodType` · `issuer` 자유문자열 |
| `transaction_ct` | `TRANSACTION_TYPE` · `TRANSACTION_STATUS` · `EXCLUDE_REASON` · `COUNTERPARTY_TYPE` | `TransactionType` · `TransactionStatus` · `ExcludeReason` · `counterparty.type` |
| `statement_ct` | `BANK_TXN_TYPE` · `BANK_TXN_DIRECTION` · `IMPORT_STATUS` | `bank_txn_type` 테이블 · `BankTxnDirection` · `ImportJobStatus` |
| `rule_ct` | `MATCH_TYPE` · `RECURRING_CADENCE` · `RECURRING_SOURCE` | `MatchType` · `RecurringCadence` · `RecurringSource` |

- `YesNo` enum 은 코드가 아니라 **boolean** 으로 승격한다 — `use_yn`→`is_active`, `is_classified`, `is_canceled`.
- **코드화하지 않는 것**: `card_transaction.sale_type` / `benefit_type` / `region`, `bank_transaction.txn_type_raw` 는 **발급사 원문 보존**이 목적이라 열거형이 아니다 → `varchar` 유지.

### 1.3 Master↔Master 관계 (`_rt`) — 10개

`_rt` 는 **서로 다른 두 마스터**를 잇는 용도다. 자기참조는 대상이 아니다(V7).

| v2 | 연결 | 관계 속성 |
|---|---|---|
| `household_user_rt` | 가구 ↔ 계정 | `household_role_id`(code), `is_primary` |
| `household_family_member_rt` | 가구 ↔ 구성원 | `is_representative`(본인), `sort_order` |
| `user_family_member_rt` | 계정 ↔ 구성원 (1:1) | — |
| `household_payment_method_rt` | 가구 ↔ 결제수단 | — |
| `payment_method_family_member_rt` | 결제수단 ↔ 명의자 | — (v1 `owner` 문자열 승격) |
| `household_counterparty_rt` | 가구 ↔ 거래상대 | — |
| `merchant_rule_category_rt` | 가맹점규칙 ↔ 분류 | — |
| `household_recurring_expense_rt` | 가구 ↔ 정기지출 | — |
| `recurring_expense_category_rt` | 정기지출 ↔ 분류 | — |
| `recurring_expense_payment_method_rt` | 정기지출 ↔ 결제수단 | — |

> **분류 트리는 `_rt` 가 아니다.** `category_mt.parent_id` 인라인 컬럼으로 두어 재귀 CTE 로 자연스럽게 조회한다. 관계 테이블로 빼면 트리 조회마다 조인이 하나 더 붙을 뿐 얻는 것이 없다. 한 노드가 상위를 **여럿** 갖는 DAG 가 필요해지면 그때만 자기참조 `_rt` 를 만든다(SKILL §7.1).

### 1.4 Transaction (`_tt`) — 12개

| v2 | v1 | 소프트삭제 |
|---|---|---|
| `transaction_tt` | `transaction` | ✅ |
| `bank_transaction_tt` | `bank_transaction` | ✅ |
| `card_statement_tt` | `card_statement` | ✅ |
| `card_transaction_tt` | `card_transaction` | ✅ |
| `installment_plan_tt` | `installment_plan` | ✅ |
| `import_job_tt` | `import_job` | ✅ |
| `refresh_token_tt` | `refresh_token` | ❌ append-only (§4 예외) — 폐기는 `revoked_at` |
| `password_reset_token_tt` | `password_reset_token` | ❌ append-only — 사용은 `used_at` |
| `monthly_summary_tt` | `monthly_summary` | ❌ 재집계(delete+insert) 대상 — §1.5 |
| `monthly_category_stat_tt` | `monthly_category_stat` | ❌ |
| `monthly_source_stat_tt` | `monthly_source_stat` | ❌ |
| `monthly_payment_stat_tt` | `monthly_payment_stat` | ❌ |

### 1.5 집계 테이블의 소프트삭제 예외

`monthly_*` 4종은 원천(`transaction_tt`)에서 **매번 통째로 재생성**되는 파생 데이터다. `is_deleted` 를 두면 재집계 시 삭제 플래그가 켜진 낡은 행과 새 행이 공존해 합계가 두 배가 된다. 감사 #8 이 정확히 이 계열의 불일치였으므로 **의도적으로 두지 않는다.** append-only 예외(§4)와 같은 취지의 "불변/재생성" 예외로 문서화한다.

---

## 2. 사용자 ↔ 가족 구조 (요구사항 ②)

### 2.1 왜 분리하는가

v1 은 `household_member` 하나가 **사람**과 **로그인 계정**을 겸했다([DOMAIN_MODEL_DESIGN.md](DOMAIN_MODEL_DESIGN.md) §0 의 2026-07 결정). 그 결과:

- 계정 없는 가족(자녀)도 `email`·`password_hash`·`role` 컬럼을 들고 있다 → 감사 #1(해시 노출)의 표면이 넓었다.
- 한 계정이 여러 가구에 속할 수 없다(`household_id` 단일 컬럼).
- **시스템 운영자**를 표현할 자리가 없다 — `MemberRole` 은 가구 내 역할이라 "전체 운영"과 축이 다르다.

### 2.2 신규 구조

```
                    ┌──────────────┐
                    │ household_mt │  가구
                    └───────┬──────┘
        ┌───────────────────┼────────────────────┐
        │                   │                    │
household_user_rt   household_family_       household_payment_
  + household_role_id     member_rt            method_rt
  + is_primary            + is_representative        │
        │                   │                        │
   ┌────▼────┐        ┌─────▼──────────┐    ┌────────▼─────────┐
   │ user_mt │        │family_member_mt│    │payment_method_mt │
   │  계정   │        │     사람       │    │   카드/계좌      │
   │ email   │        │ name, relation │    └────────┬─────────┘
   │ password│        │ color          │             │
   │ system_ │        └─────┬──────────┘   payment_method_
   │ role_id │              │               family_member_rt
   └────┬────┘              │                        │
        │                   │                        │
        └── user_family_member_rt (1:1) ─────────────┘
                     계정 ↔ 사람
```

- **`user_mt`** — 로그인 자격만. `system_role_id`(OPERATOR/USER).
- **`family_member_mt`** — 사람. 계정이 없어도 존재(자녀·추적 전용). 지출 명의(`transaction_tt.family_member_id`)는 이쪽을 가리킨다.
- **`user_family_member_rt`** — 계정을 가진 사람 연결. **양쪽 UNIQUE 로 1:1 강제.**
- **`household_user_rt`** — 계정의 가구 접근권 + 가구 내 역할. 한 계정이 여러 가구에 속할 수 있다(`is_primary` 로 기본 가구 결정).
- **`is_representative`(본인)** 는 사람의 속성이 아니라 **가구 안에서의 관계 속성**이므로 `_rt` 에 둔다(§7.2). v1 의 `is_self` 를 이동.
- v1 `payment_method.owner`(자유문자열 '본인'/'가족') → `payment_method_family_member_rt` 로 승격. 파서가 카드 라벨('본인253')에서 뽑은 명의를 사람에 정식 연결한다.

### 2.3 액세스 토큰 클레임 변경

```
v1: { sub: memberId,  hid: householdId, role: 'owner'|'member'|'viewer' }
v2: { sub: userId,    hid: householdId, role: '<HOUSEHOLD_ROLE code>',
      srole: '<SYSTEM_ROLE code>',      fmid: familyMemberId }
```

- `srole` 추가 — 운영자 전용 라우트 가드가 이 값만 본다. 가구 역할(`role`)과 **독립적으로** 평가한다.
- `fmid`(연결된 사람) 를 실어 거래 생성 시 기본 명의를 서버에서 채운다.
- 가구 전환 API(`POST /auth/switch-household`)가 `hid`/`role` 을 갈아끼운다. `household_user_rt` 에 없는 가구는 403.

---

## 3. 최초 등록 사용자 = 전체 운영자 (요구사항 ①)

### 3.1 코드 정의

```sql
-- user_ct (code_group='SYSTEM_ROLE')
OPERATOR   전체 운영자   -- 최초 가입자 1명. 코드/분류/규칙 관리 + 운영 지표
USER       일반 사용자   -- 이후 모든 가입자
```

### 3.2 부여 규칙과 경쟁 조건

"최초 1명"은 `SELECT count(*)` 로 판정하는데, **동시 가입 2건이 모두 0을 보면 운영자가 2명 생긴다.** 감사에서 경쟁 조건이 반복 지적된 영역이므로 DB 레벨에서 막는다.

```sql
BEGIN;
  -- 가입 경로 전체를 직렬화 (테이블 락 없이, 트랜잭션 종료 시 자동 해제)
  SELECT pg_advisory_xact_lock(hashtext('ledger:user_bootstrap'));

  SELECT count(*) = 0 AS is_first FROM user_mt;   -- → OPERATOR / USER 결정

  INSERT INTO user_mt (...) VALUES (...);
  INSERT INTO household_mt (...) VALUES (...);
  INSERT INTO family_member_mt (...) VALUES (...);
  INSERT INTO household_user_rt (...);            -- household_role = OWNER, is_primary = true
  INSERT INTO household_family_member_rt (...);   -- is_representative = true
  INSERT INTO user_family_member_rt (...);
COMMIT;
```

**2차 방어(권장)**: 물리 FK 를 쓰지 않는 설계이지만 유니크 인덱스는 제약이 아니라 인덱스이므로 규칙과 충돌하지 않는다.

```sql
-- 운영자를 최대 1명으로 물리 보장. is_operator 는 system_role_id 에서 파생되는
-- 생성 컬럼이라 애플리케이션이 따로 관리할 필요가 없다.
ALTER TABLE user_mt ADD COLUMN is_operator boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX uq_user_single_operator ON user_mt (is_operator) WHERE is_operator;
```

> 운영자를 여러 명 두는 정책으로 바뀌면 이 인덱스만 떼면 된다. 지금은 "최초 1명"이 요구사항이므로 유지.

### 3.3 운영자 권한 범위

| 대상 | OPERATOR | 가구 owner |
|---|:---:|:---:|
| `_ct` 코드 CRUD | ✅ | ❌ |
| `category_mt` CRUD (분류 트리 포함) | ✅ | ❌ (조회만) |
| `merchant_rule_mt` CRUD | ✅ | ❌ (조회만) |
| 사용자·가구 **목록** 조회 (지원 목적) | ✅ | ❌ |
| 사용자 비활성화 | ✅ | ❌ |
| **타 가구의 거래·명세서 데이터** | ❌ | ❌ |
| 자기 가구 데이터 | 자기 가구 역할에 따름 | ✅ |

- **운영자도 남의 가구 금융 데이터는 못 본다.** 개인 재무 데이터라 "운영"과 "열람"을 분리한다. 지원이 필요하면 별도 임퍼소네이션 기능 + 감사 로그를 두는 것이 맞고, 이번 범위 밖이다.
- 운영자는 가구 관점에서는 그냥 자기 가구의 `owner` 다. 두 축이 독립이라는 점이 핵심.
- 이 표가 곧 감사 #20 의 해소책이다 — `category`/`merchant_rule` 쓰기가 `srole='OPERATOR'` 로 잠긴다.

### 3.4 신규 가드

```ts
// @SystemRoles('OPERATOR') — 가구 역할과 무관하게 시스템 역할만 평가
@Injectable()
export class SystemRolesGuard implements CanActivate { /* srole 클레임 검사 */ }
```

`RolesGuard`(가구 역할)와 **병렬로** 등록한다. 기존 `RolesGuard` 의 "기본 거부" 정책(커밋 `07d221e`)은 그대로 유지한다.

---

## 4. 테넌트 스코핑 (V1 엄격 적용의 실무 처리)

### 4.1 두 갈래

| 대상 | 스코프 방법 |
|---|---|
| `_tt` 12개 | 인라인 `household_id` → **Prisma 미들웨어 자동 주입** (현행 유지) |
| `_mt` 4개 (`family_member`, `payment_method`, `counterparty`, `recurring_expense`) | `household_*_rt` **조인** |
| `_mt` 4개 (`household`, `user`, `category`, `merchant_rule`) | 테넌트 스코프 없음 (전역 또는 계정 자기 자신) |
| `_ct` 5개 | 전역 |

### 4.2 `TENANT_VIA_RT` 레지스트리

마스터마다 "어떤 `_rt` 로 스코프하는가"를 **한 곳에 선언**하고, 서비스가 이 선언을 통해서만 마스터를 조회하게 한다. 각 서비스가 조인을 손으로 쓰면 반드시 하나는 빠진다.

```ts
// prisma/tenant-scope.ts
export const TENANT_VIA_RT = {
  FamilyMember:     { rt: 'householdFamilyMemberRt',     fk: 'familyMemberId' },
  PaymentMethod:    { rt: 'householdPaymentMethodRt',    fk: 'paymentMethodId' },
  Counterparty:     { rt: 'householdCounterpartyRt',     fk: 'counterpartyId' },
  RecurringExpense: { rt: 'householdRecurringExpenseRt', fk: 'recurringExpenseId' },
} as const;

/** 마스터 조회용 표준 where — 이 함수를 거치지 않은 마스터 조회는 금지. */
export function tenantWhere(model: keyof typeof TENANT_VIA_RT) {
  const { rt, fk } = TENANT_VIA_RT[model];
  return { id: { in: /* SELECT fk FROM rt WHERE household_id = tenant */ } };
}
```

- 구현은 **서브쿼리 1회**(`id IN (SELECT ...)`)로 고정한다. 관계 조인으로 풀면 중복 행·페이지네이션 오류가 생긴다.
- `_rt` 의 `(household_id, <fk>)` 에 **복합 인덱스**를 반드시 둔다. 없으면 마스터 조회마다 풀스캔이다.

### 4.3 회귀 방지 — 메타 테스트 (필수)

[TEST_STRATEGY_DESIGN.md](TEST_STRATEGY_DESIGN.md) §2.3 의 메타 테스트를 v2 기준으로 확장한다. **V1 의 대가를 상환하는 장치이므로 스키마와 함께 들어가야 한다.**

1. **분류 누락 검출** — Prisma DMMF 의 전 모델을 순회해 이름이 `_mt`/`_ct`/`_tt`/`_rt` 접미어 중 하나로 끝나는지 단정. 새 테이블이 분류 없이 추가되면 CI 실패.
2. **마스터 종속 컬럼 금지** — `_mt` 모델의 스칼라 필드에 다른 `_mt` 를 가리키는 `*_id` 가 없는지 단정(`_ct` 참조는 허용). §5.2 를 CI 가 감시한다.
3. **테넌트 스코프 등록 누락** — 테넌트 소유 마스터가 `TENANT_VIA_RT` 에 등록됐는지, `_tt` 모델에 `household_id` 가 있는지 단정.
4. **물리 FK 부재** — `information_schema.table_constraints` 에서 `FOREIGN KEY` 가 0건인지 단정(V4).
5. **표준 컬럼** — 전 테이블에 `id`/`created_at`/`updated_at`, `_tt` 에 `is_deleted`/`deleted_at`(§1.5 예외 목록 제외)이 있는지 단정.

---

## 5. DDL

> 주석 `-- → xxx.id` 는 **논리적 참조**이며 물리 제약이 아니다(§3 규칙).
> 모든 테이블 공통: `id uuid PK DEFAULT gen_random_uuid()`, `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`.

### 5.1 Code (`_ct`)

```sql
-- 5개 모두 동일 구조. user_ct 만 예시로 전개한다.
CREATE TABLE user_ct (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_group varchar(40) NOT NULL,   -- 'SYSTEM_ROLE' | 'HOUSEHOLD_ROLE' | 'MEMBER_RELATION'
  code       varchar(40) NOT NULL,   -- 'OPERATOR' | 'OWNER' | 'SPOUSE' ...
  name       varchar(100) NOT NULL,  -- '전체 운영자'
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_group, code)
);
-- payment_ct, transaction_ct, statement_ct, rule_ct 동일 (code_group 만 다름 — §1.2)

-- statement_ct 의 BANK_TXN_TYPE 만 부가 속성이 필요하다(입출금 방향).
-- 코드에 방향 속성을 붙이지 않고, 방향 자체를 별도 code_group 으로 두고
-- bank_transaction_tt 가 두 코드를 각각 인라인 참조한다.
```

### 5.2 Master (`_mt`)

```sql
CREATE TABLE household_mt (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(100) NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_mt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           varchar(200) NOT NULL,
  password_hash   varchar(255) NOT NULL,
  name            varchar(50)  NOT NULL,
  system_role_id  uuid NOT NULL,        -- 인라인 코드참조 → user_ct.id (code_group='SYSTEM_ROLE')
  is_operator     boolean NOT NULL DEFAULT false,  -- §3.2 2차 방어(파생값)
  is_active       boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
  -- ❌ household_id 금지 → household_user_rt
);
CREATE UNIQUE INDEX uq_user_email          ON user_mt (lower(email));
CREATE UNIQUE INDEX uq_user_single_operator ON user_mt (is_operator) WHERE is_operator;

CREATE TABLE family_member_mt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(50) NOT NULL,
  relation_id uuid,                     -- → user_ct.id (code_group='MEMBER_RELATION')
  color       varchar(20),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
  -- ❌ household_id / user_id / is_self 금지 → 각각 _rt
);

CREATE TABLE payment_method_mt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(100) NOT NULL,
  method_type_id uuid NOT NULL,         -- → payment_ct.id (code_group='METHOD_TYPE')
  issuer_id      uuid,                  -- → payment_ct.id (code_group='ISSUER')
  identifier     varchar(50),
  card_no        varchar(20),           -- 마스킹 저장
  account_no     varchar(50),
  memo           text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
  -- ❌ household_id / owner 금지 → household_payment_method_rt / payment_method_family_member_rt
);

CREATE TABLE counterparty_mt (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(200) NOT NULL,
  type_id    uuid,                      -- → transaction_ct.id (code_group='COUNTERPARTY_TYPE')
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 전역 마스터 (운영자 관리 — §3.3)
CREATE TABLE category_mt (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(20) NOT NULL UNIQUE,  -- '0501' — 표시·시드 안정용 자연키 유지
  name       varchar(100) NOT NULL,
  parent_id  uuid,                      -- ⭕ 자기참조 계층 → category_mt.id (SKILL §5.4 예외 B)
  type_id    uuid NOT NULL,             -- → transaction_ct.id (code_group='TRANSACTION_TYPE')
  depth      int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  -- ❌ household_id 등 **다른** 마스터 종속 컬럼 금지
);
CREATE INDEX ix_category_parent ON category_mt (parent_id);

-- 트리 조회 (재귀 CTE) — 관계 테이블 없이 그대로 된다
-- WITH RECURSIVE tree AS (
--   SELECT id, code, name, parent_id, 1 AS lvl FROM category_mt WHERE parent_id IS NULL
--   UNION ALL
--   SELECT c.id, c.code, c.name, c.parent_id, t.lvl + 1
--     FROM category_mt c JOIN tree t ON c.parent_id = t.id
-- ) SELECT * FROM tree ORDER BY lvl, code;

CREATE TABLE merchant_rule_mt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern       varchar(200) NOT NULL,
  match_type_id uuid NOT NULL,          -- → rule_ct.id (code_group='MATCH_TYPE')
  priority      int NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
  -- ❌ category_code 금지 → merchant_rule_category_rt
);
CREATE INDEX ix_merchant_rule_priority ON merchant_rule_mt (priority) WHERE is_active;

CREATE TABLE recurring_expense_mt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        varchar(100) NOT NULL,
  amount       numeric(15,2) NOT NULL,
  cadence_id   uuid NOT NULL,           -- → rule_ct.id (code_group='RECURRING_CADENCE')
  source_id    uuid NOT NULL,           -- → rule_ct.id (code_group='RECURRING_SOURCE')
  months       int[] NOT NULL DEFAULT '{}',
  start_ym     char(7),
  end_ym       char(7),
  day_of_month int,
  match_key    varchar(100),
  memo         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
  -- ❌ household_id / category_code / payment_method_id 금지 → 각각 _rt
);
```

### 5.3 Master↔Master 관계 (`_rt`)

```sql
CREATE TABLE household_user_rt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL,      -- → household_mt.id
  user_id           uuid NOT NULL,      -- → user_mt.id
  household_role_id uuid NOT NULL,      -- → user_ct.id (code_group='HOUSEHOLD_ROLE')
  is_primary        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_household_user     ON household_user_rt (household_id, user_id);
CREATE UNIQUE INDEX uq_user_primary_house ON household_user_rt (user_id) WHERE is_primary;

CREATE TABLE household_family_member_rt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL,      -- → household_mt.id
  family_member_id  uuid NOT NULL,      -- → family_member_mt.id
  is_representative boolean NOT NULL DEFAULT false,   -- v1 is_self
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_household_family_member ON household_family_member_rt (household_id, family_member_id);
CREATE UNIQUE INDEX uq_household_representative ON household_family_member_rt (household_id) WHERE is_representative;

CREATE TABLE user_family_member_rt (            -- 1:1
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,      -- → user_mt.id
  family_member_id uuid NOT NULL,      -- → family_member_mt.id
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ufm_user   ON user_family_member_rt (user_id);
CREATE UNIQUE INDEX uq_ufm_member ON user_family_member_rt (family_member_id);

-- 테넌트 스코프용 (§4.2) — 복합 인덱스 필수
CREATE TABLE household_payment_method_rt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_hpm ON household_payment_method_rt (household_id, payment_method_id);
CREATE INDEX ix_hpm_pm     ON household_payment_method_rt (payment_method_id);

CREATE TABLE household_counterparty_rt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_hcp ON household_counterparty_rt (household_id, counterparty_id);

CREATE TABLE household_recurring_expense_rt (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         uuid NOT NULL,
  recurring_expense_id uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_hre ON household_recurring_expense_rt (household_id, recurring_expense_id);

CREATE TABLE payment_method_family_member_rt (  -- 명의자 (v1 owner 문자열 승격)
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_method_id uuid NOT NULL,
  family_member_id  uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_pmfm ON payment_method_family_member_rt (payment_method_id);

CREATE TABLE merchant_rule_category_rt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_rule_id uuid NOT NULL,
  category_id      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_mrc ON merchant_rule_category_rt (merchant_rule_id);

CREATE TABLE recurring_expense_category_rt (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_expense_id uuid NOT NULL,
  category_id          uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_rec ON recurring_expense_category_rt (recurring_expense_id);

CREATE TABLE recurring_expense_payment_method_rt (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_expense_id uuid NOT NULL,
  payment_method_id    uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_repm ON recurring_expense_payment_method_rt (recurring_expense_id);
```

### 5.4 Transaction (`_tt`) — 핵심 3개만 전개

`_tt` 는 §8.1 에 따라 마스터·코드·부모업무를 **인라인 uuid** 로 참조한다. 나머지 9개는 v1 컬럼 그대로에 `id`→uuid, enum→`*_id`, `use_yn`→boolean, 공통/소프트삭제 컬럼 추가만 적용한다.

```sql
CREATE TABLE transaction_tt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL,      -- → household_mt.id (§8.1 인라인 허용)
  type_id           uuid NOT NULL,      -- → transaction_ct.id (TRANSACTION_TYPE)
  status_id         uuid NOT NULL,      -- → transaction_ct.id (TRANSACTION_STATUS)
  category_id       uuid NOT NULL,      -- → category_mt.id
  counterparty_id   uuid,               -- → counterparty_mt.id
  payment_method_id uuid NOT NULL,      -- → payment_method_mt.id
  family_member_id  uuid,               -- → family_member_mt.id (지출 명의)
  description       text,
  amount            numeric(15,2) NOT NULL,   -- v1 nullable → NOT NULL (감사 미검증항목)
  transaction_date  date NOT NULL,
  settled_date      date,
  memo              text,
  is_deleted        boolean NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_txn_tenant_date ON transaction_tt (household_id, transaction_date) WHERE NOT is_deleted;
CREATE INDEX ix_txn_category    ON transaction_tt (household_id, category_id)      WHERE NOT is_deleted;
CREATE INDEX ix_txn_payment     ON transaction_tt (household_id, payment_method_id) WHERE NOT is_deleted;

CREATE TABLE bank_transaction_tt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      uuid NOT NULL,
  payment_method_id uuid NOT NULL,      -- → payment_method_mt.id
  transaction_id    uuid,               -- → transaction_tt.id (분류 확정 시 연결)
  txn_type_id       uuid,               -- → statement_ct.id (BANK_TXN_TYPE)
  exclude_reason_id uuid,               -- → transaction_ct.id (EXCLUDE_REASON)
  txn_at            timestamptz NOT NULL,
  txn_type_raw      varchar(100),       -- 발급사 원문 보존 (코드화 안 함)
  counterpart_org   varchar(200),
  description       text,
  withdrawal        numeric(15,2) NOT NULL DEFAULT 0,
  deposit           numeric(15,2) NOT NULL DEFAULT 0,
  balance           numeric(15,2),
  branch            varchar(100),
  is_classified     boolean NOT NULL DEFAULT false,
  import_batch      varchar(50),
  dedup_hash        varchar(64),
  is_deleted        boolean NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_bank_dedup    ON bank_transaction_tt (household_id, dedup_hash);
CREATE UNIQUE INDEX uq_bank_txn_link ON bank_transaction_tt (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX ix_bank_tenant_at       ON bank_transaction_tt (household_id, txn_at) WHERE NOT is_deleted;

-- append-only 예외 (§4) — is_deleted/deleted_at 없음
CREATE TABLE refresh_token_tt (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,             -- → user_mt.id  (v1 은 member_id 였다)
  token_hash varchar(128) NOT NULL,
  family_id  uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_refresh_hash ON refresh_token_tt (token_hash);
CREATE INDEX ix_refresh_family      ON refresh_token_tt (family_id) WHERE revoked_at IS NULL;
```

> `bank_transaction_tt.txn_at` 는 v1 이 `timestamp`(TZ 없음)에 **벽시계 값을 UTC 성분으로** 담는 규약이었다. v2 에서 `timestamptz` 로 바꾸면 기존 값이 UTC 로 재해석되어 **KST 기준 9시간 밀린다.** 이관 시 `AT TIME ZONE 'Asia/Seoul'` 변환을 반드시 넣어야 한다(§6.4). 감사 P1 #12(UTC/KST) 와 같은 뿌리다.

---

## 6. 마이그레이션 전략

`Int`→`uuid` + 테이블 분리/증설이므로 **점진적 ALTER 로는 불가능**하다. 새 스키마를 옆에 만들고 이관 후 컷오버한다.

### 6.1 단계

| 단계 | 작업 | 산출물 |
|---|---|---|
| **P0** | `ledger_v2` Postgres 스키마에 v2 DDL 전량 생성 | `schema.v2.prisma` → baseline 마이그레이션 |
| **P1** | `_ct` 시드 — enum 값·`bank_txn_type` 행 → 코드 행. **uuid 확정** | `seed-codes.ts` |
| **P2** | 마스터 이관 + **id 매핑 테이블** | `_migration_id_map` |
| **P3** | `_rt` 생성 — v1 의 FK 컬럼을 관계 행으로 전개 | |
| **P4** | `_tt` 이관 — 매핑으로 uuid 치환, TZ 변환 | |
| **P5** | 검증 → 컷오버 | 대조 리포트 |

### 6.2 id 매핑 테이블

```sql
CREATE TABLE _migration_id_map (
  old_table varchar(60) NOT NULL,
  old_id    text        NOT NULL,      -- v1 Int / category.code 문자열 모두 수용
  new_id    uuid        NOT NULL,
  PRIMARY KEY (old_table, old_id)
);
CREATE INDEX ix_mig_new ON _migration_id_map (new_id);
```

이관 SQL 은 전부 이 테이블을 조인해 치환한다. 이관 완료·검증 후 삭제.

### 6.3 `household_member` 분리 규칙 (핵심)

v1 한 행이 v2 에서 최대 5개 행으로 갈라진다.

```
household_member 1행
  ├─ family_member_mt                (항상)  name, relation→code, color
  ├─ household_family_member_rt      (항상)  is_representative ← is_self, sort_order
  ├─ user_mt                         (email IS NOT NULL 인 경우만)
  ├─ user_family_member_rt           (동상)
  └─ household_user_rt               (동상)  household_role_id ← role, is_primary=true
```

- `email IS NULL` 인 구성원(자녀 등)은 **계정을 만들지 않는다.** v1 에서 `role` 기본값 `member` 가 들어가 있어도 무시한다.
- `use_yn='N'` → `family_member_mt.is_active=false` **및** 연결된 `user_mt.is_active=false`. (감사 #6 과 같은 취지 — 두 곳을 함께 꺼야 한다)
- **운영자 지정**: 이관 시 `created_at` 이 가장 이른 계정 1건에 `SYSTEM_ROLE='OPERATOR'`, `is_operator=true`. 나머지는 `USER`.
- `transaction.member_id` → `transaction_tt.family_member_id` (계정이 아니라 **사람**을 가리킨다).
- `refresh_token.member_id` / `password_reset_token.member_id` → `*_tt.user_id` (**계정**을 가리킨다). 두 방향을 혼동하면 인증이 깨진다.

### 6.4 검증 항목 (컷오버 게이트)

| 항목 | 판정 |
|---|---|
| 테이블별 행 수 | v1 = v2 (분리 대상은 산식으로) |
| 금액 합계 | `SUM(transaction.amount)` per `(household, ym)` 완전 일치 |
| 월 집계 | v2 에서 재집계한 `monthly_*` 가 이관값과 일치 |
| 고아 참조 | 모든 논리 참조에 대해 대상 행 존재 확인 (물리 FK 가 없으므로 **쿼리로** 검증) |
| 날짜 | `txn_at` KST 벽시계 값이 v1 과 동일 |
| 계정 | `user_mt` 수 = v1 `email IS NOT NULL` 수, `is_operator` = 1건 |
| 물리 FK | `FOREIGN KEY` 제약 0건 (V4) |

`_migration_id_map` 이 있으므로 고아 참조 검증은 전수 조사가 가능하다. **물리 FK 를 포기한 대가를 이 게이트에서 지불한다** — 이후에도 정기 정합성 배치를 권장한다.

### 6.5 기존 마이그레이션 이력

v1 마이그레이션 12개는 v2 와 이어지지 않는다. `apps/api/prisma/migrations` 를 **새 baseline 으로 리셋**하고, v1 이력은 `docs/legacy-migrations/` 로 보존한다.

---

## 7. 애플리케이션 영향

| 영역 | 규모 | 내용 |
|---|:---:|---|
| `prisma.service.ts` | 중 | `SCOPED_MODELS` → `_tt` 12개. 마스터는 `TENANT_VIA_RT`(§4.2)로 분리 |
| `auth` 모듈 | **대** | `HouseholdMember` → `user_mt`+`_rt` 3종. 토큰 클레임에 `srole`/`fmid` 추가. 가입 시 운영자 판정(§3.2). `SystemRolesGuard` 신설 |
| `household` 모듈 | **대** | 구성원 CRUD 가 `family_member_mt` + `_rt` 2~3개 동시 write → 전부 `$transaction` |
| `category` / 규칙 | 소 | `parent_code`(문자열) → `parent_id`(uuid) 로만 바뀐다. 트리 구성 코드는 그대로. 쓰기는 `@SystemRoles('OPERATOR')` |
| `payment-method` / `counterparty` / `recurring-expense` | **대** | 생성 시 `household_*_rt` 동시 생성. 조회는 `tenantWhere()` 경유 |
| enum 사용처 전역 | **대** | `TransactionType.expense` 등 리터럴 비교 → 코드 uuid 조회로 전환. **코드 캐시(부팅 시 1회 로드) 필수** |
| `statistics` / `forecast` | 중 | enum→code, `Int`→`uuid`. 집계 로직 자체는 유지 |
| 프론트 `types.ts` / 뷰 13개 | 중 | id 타입 `number`→`string`, enum 문자열→코드 |

**enum → 코드 전환이 가장 광범위한 변경**이다. `where: { type: 'expense' }` 가 전부 `where: { typeId: codes.TRANSACTION_TYPE.expense }` 가 된다. 부팅 시 `_ct` 전량을 메모리에 올려 `code → uuid` / `uuid → code` 양방향 맵을 제공하는 `CodeService` 를 먼저 만들고, 그 위에서 모듈별로 옮기는 순서를 권한다.

---

## 8. 설계 체크리스트 (SKILL §9 대조)

- [x] 각 테이블을 master(`_mt`) / code(`_ct`) / transaction(`_tt`) 로 분류·명명했는가? → §1
- [x] 마스터 테이블에 **다른** 마스터를 가리키는 종속 컬럼이 없는가? → §5.2 (`household_id` 포함 엄격 적용, 결정 V1)
- [x] 서로 다른 마스터↔마스터 관계를 `_rt`(uuid)로 분리했는가? → §5.3 (10개)
- [x] 같은 테이블의 상위-하위 계층을 불필요하게 `_rt` 로 빼지 않았는가? → `category_mt.parent_id` 인라인 (결정 V7)
- [x] 열거형 속성을 `_ct` 코드(인라인 uuid)로 참조했는가? `_ct` 는 도메인별 1개+`code_group`? → §1.2 (5개)
- [x] 업무 테이블의 마스터/코드/부모 참조는 인라인 uuid 인가? → §5.4
- [x] 물리 FK 없이 논리적 uuid 연결만 사용했는가? → V4, 검증은 §4.3-4·§6.4
- [x] 공통 컬럼(id/created_at/updated_at)과 업무 소프트삭제(is_deleted/deleted_at)를 넣었는가? → §5, 예외는 §1.5

---

## 9. 미결 사항

1. **`recurring_expense` / `merchant_rule` 의 분류** — 규칙/정책성 기준정보로 보아 `_mt` 로 두었다(SKILL §1 의 `notification_rule_mt` 선례). 그 대가로 `_rt` 5개가 생겼다. `_tt` 로 재분류하면 인라인 참조가 허용되어 **6개 테이블이 2개로 줄어든다.** 결정 필요.
2. **`category_mt.code`(자연키) 유지 여부** — uuid PK 와 별도로 `'0501'` 코드를 UNIQUE 로 남겼다. 시드 안정성·기존 파서 규칙 호환에 필요하지만 식별자가 둘이 된다.
3. **다가구 지원 범위** — `household_user_rt` 가 구조적으로 다가구를 허용하게 됐다. 가구 전환 UI/API 를 실제로 만들지, 아니면 `is_primary` 1건만 쓰고 잠글지.
4. **운영자 임퍼소네이션** — §3.3 에서 타 가구 데이터 접근을 막았다. 지원 업무에 필요하면 별도 기능 + 감사 로그(`activity_log_tt`, append-only) 설계 필요.
5. **`_ct` 도메인 분할 경계** — 5개로 묶었으나 `transaction_ct` 에 `COUNTERPARTY_TYPE` 이 들어가는 등 애매한 배치가 있다.
6. **v2 착수 시점** — 감사 잔여 항목(P1 금액 정확성 5건, P2 트랜잭션 원자성 4건)을 v1 에서 먼저 고칠지, v2 재작성에 흡수할지. **파서 결함(#7·#11·#14·#15)은 스키마와 무관하므로 v1 에서 먼저 고치는 것을 권한다.**
