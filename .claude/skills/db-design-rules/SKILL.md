---
name: db-design-rules
description: "Database/schema design conventions for the user's projects — classifying tables as master (_mt), code (_ct), or transaction (_tt) data; naming suffixes (_mt master, _ct code, _tt transaction, _rt master-to-master relationship, _ht change-history, _vw view); every table has an immutable internal uuid id plus (for master/code) a separate mutable user-facing business key; master tables carry no dependency columns to OTHER master data (two inline exceptions: code references and self-referencing parent/child); all links are logical uuid references (no physical FK) — so integrity is enforced by app rules, deactivation over deletion, orphan checks, and aggressive NOT NULL/CHECK/UNIQUE constraints; _rt tables use a composite UNIQUE over the internal ids; standard common columns with auto-updated updated_at and created_by/updated_by audit; every master/code change is written to a history table; plus rules for multi-tenant scoping, concurrency (optimistic locking, atomic multi-table writes, idempotency), safe migrations (expand-contract, no destructive commands on live DBs), PII/secrets handling, documentation/JSONB, and read/write performance (indexing, time-ordered uuid, partial indexes, views/materialized views). Each rule ships with a pragmatic relaxation note for when strictness would block development. Use whenever designing, reviewing, or refactoring database schemas, tables, DDL, ER diagrams, or Prisma/ORM models."
---

# DB Design Rules

프로젝트 DB/스키마 설계 시 반드시 따르는 규칙. **테이블을 만들거나 고칠 때, DDL/ERD/Prisma
모델을 작성·검토할 때** 이 규칙을 먼저 적용한다.

> ### 규칙 적용 원칙 (엄격도와 완화)
> 이 문서의 규칙은 **기본값**이다. 무작정 엄격하게 적용해 개발을 막지 않는다.
> - **반드시** = 하드 규칙(위반 시 리뷰에서 차단). **권장** = 상황에 맞게 조정 가능한 가이드.
> - 규칙이 오히려 **개발·데이터 적재·성능을 막으면 완화한다.** 단, **완화 근거를 DDL 주석/PR/
>   설계서에 남긴다**(무근거 이탈 금지). 각 규칙 아래 `> 완화:` 가 대표적 예외 상황이다.
> - 우선순위: **데이터 정합성·보안 > 규칙 형식.** 형식 때문에 정합성/가용성을 해치지 않는다.
> - 완화 위치도 계층화한다: **개발/CI(자유) → 스테이징(정제) → 운영(엄격).**

## 1. 데이터 분류 (먼저 분류하라)

모든 저장 테이블을 아래 셋 중 하나로 분류한다.

| 구분 | 정의 | 접미어 | 예 |
| ---- | ---- | ------ | -- |
| **Master data** | 실세계 개체(entity) 기준정보. 한 행 = 하나의 실체 | `_mt` | 회사, 조직, 직급, 사용자 |
| **Code data** | 열거형 허용값(공통코드). 짧고 고정된 값 목록 | `_ct` | 요청상태, 긴급도, 추진유형 |
| **Transaction/업무 data** | 마스터·코드를 참조하며 발생·누적되는 운영 기록 | `_tt` | 요청, 조사, 분석, 결정, 로그, 알림 |

**Meta data(메타데이터)** 는 "데이터에 대한 데이터"(테이블/컬럼 정의, 폼 스키마, 코드그룹 정의
자체)로 **별도 테이블 카테고리가 아니다.** 코드/설정/문서로 관리하며 반드시 DB 테이블일 필요 없다.

> **구성/정책/참조 데이터도 master:** 앱이 참조하는 구성·정책성 기준정보(권한 `permission_mt`,
> 상태전이 정의 `request_transition_mt`, 알림 규칙 `notification_rule_mt`, Chat Space `chat_space_mt`
> 등)도 **master(`_mt`)** 로 분류한다. 이들 사이의 M:N 관계(예: 역할↔권한)는 `_rt` 로 연결한다
> (예: `role_permission_rt`, `request_transition_role_rt`).

## 2. 명명 규칙

| 대상 | 접미어 | 예 |
| ---- | ------ | -- |
| Master table | `_mt` | `company_mt`, `organization_mt`, `job_title_mt`, `user_mt` |
| Code table | `_ct` | `request_ct`, `org_ct` (※ `_ct`가 code를 의미 → 이름에 'code' 중복 금지) |
| Transaction table | `_tt` | `request_tt`, `investigation_tt`, `notification_tt` |
| Master↔Master 관계 table | `_rt` | `organization_company_rt`, `user_organization_rt` |
| 변경 이력(history) table | `_ht` | `organization_ht`, `user_ht`, `request_ct_ht` |
| 조회용 뷰(view) | `_vw` | `organization_vw`, `request_vw` |

> 식별자 길이는 PostgreSQL 기준 **63자 제한**. `_rt`/`_ht` 조합명이 길어지면 도메인 약어를 쓴다.

## 3. 식별키 원칙 — 내부 id ↔ 사용자 키 (이중키) ★

**모든 참조·연결·조인은 오직 "내부 id(uuid)"로만 한다.** 사용자가 보고 쓰는 키는 절대
참조 키로 쓰지 않는다.

- **내부 식별키 `id uuid`** — 시스템 내부 전용, **불변**. 모든 테이블 간 연결(`*_id`, `_rt`,
  `_tt` 참조, 히스토리 원본 참조)은 이 값으로만 한다. 사용자에게 노출하지 않아도 된다.
- **사용자 유니크 키(업무 키)** — 사람이 인지·검색·업무로 쓰는 별도의 유니크 값
  (코드값 같은 것). 마스터/코드 테이블은 이 키를 **반드시** 별도 컬럼으로 둔다.
  도메인에 맞게 명명한다: `org_code`, `employee_no`, `request_no` 등. **변경 가능**.

> **왜 두 개인가:** 사용자 키(사번·조직코드·요청번호 등)는 운영 중 "값을 바꿔달라"는
> 요구가 잦다. 이 값을 참조 키로 쓰면, 값이 바뀌는 순간 그동안 쌓인 모든 참조 데이터가
> 꼬인다. **참조는 불변 내부 id 로, 표시·검색은 사용자 키로** 분리하면 사용자 키를 언제
> 바꿔도 관계가 깨지지 않는다.

- 사용자 키는 `UNIQUE`. 소프트삭제(`_tt`) 테이블에서 값 재사용이 필요하면 **부분 유니크**
  (`WHERE is_deleted = false`)로 건다.
- 마스터 데이터 간 연결은 §8 `_rt` 테이블로 정의하며, `_rt` 는 내부 id 들의 연결이므로
  **참여 내부 id 컬럼 전체 조합을 UNIQUE** 로 둔다.

## 4. 참조·무결성 공통 원칙

- **모든 테이블 간 연결은 내부 `id`(uuid)로 한다.**(§3)
- **물리 FK 제약(REFERENCES)을 걸지 않는다 — 논리적 연결만.** 참조 무결성은 애플리케이션이
  보장한다. (n8n 등 DB-to-DB 동기화 순서 제약, 유연성 확보 목적)
- 물리 FK가 없으므로 참조 컬럼에 **인덱스가 자동 생성되지 않는다.** §12 인덱스 규칙을 반드시 적용한다.
- 아래 DDL 예시의 주석 `-- → xxx.id` 는 "논리적으로 그 테이블 id 를 참조"라는 뜻이며 물리
  제약을 의미하지 않는다.

## 5. 공통 표준 컬럼

- **모든 테이블:** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
  `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
  - `gen_random_uuid()` 는 **PostgreSQL 13+ 내장**(그 이전은 `pgcrypto` 확장). 성능상 권장은
    **시간정렬 UUID(v7)** — §12 참조.
  - **`updated_at` 은 UPDATE 시 자동 갱신한다.** `DEFAULT now()` 는 INSERT 에만 적용되므로,
    수정 시 갱신은 **DB 트리거**로 강제한다(앱 코드에만 의존하지 않는다).
    ```sql
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
    -- 모든 테이블에 부착
    CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON organization_mt
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ```
  - **감사 컬럼 `created_by uuid` / `updated_by uuid`**(→ `user_mt.id`) 를 둔다 — "누가" 만들고
    마지막에 고쳤는지. `_ht`(§10)가 "무엇이 언제" 라면 이 둘은 현재 행의 "누가". 앱/트리거가
    세션 actor(`app.actor_id`)로 채운다.
    > **완화:** 시스템 자동 생성 행이나 마이그레이션 유입은 actor 가 없을 수 있다 → nullable
    > 로 두고, 로그인 사용자 경로에서만 강제한다.
- **Master(`_mt`)/Code(`_ct`):** 사용자 유니크 키(§3) + `is_active boolean NOT NULL DEFAULT true`
  로 활성/비활성 관리(물리 삭제 대신).
- **Transaction(`_tt`) 테이블:** 추가로 **소프트 삭제** `is_deleted boolean NOT NULL DEFAULT false`,
  `deleted_at timestamptz`.
  - **예외 — append-only 테이블:** 감사 로그, 이벤트/아웃박스, 이력성 append-only 테이블은
    **불변(immutable)** 이므로 소프트삭제 컬럼(`is_deleted/deleted_at`)을 두지 않는다.
    (예: `activity_log_tt`, `notification_outbox_tt`) 이런 테이블은 `updated_at` 도 생략 가능.

## 6. Master table 규칙 (`_mt`)

1. 마스터 테이블은 **자기 자신의 속성 컬럼만** 가진다. 내부 `id`(불변) + **사용자 유니크 키**(§3)를 둔다.
2. **다른(other) master data 를 가리키는 종속성/관계 컬럼(`*_id`)을 만들지 않는다.**
   - ❌ `organization_mt.company_id` — 타 마스터 참조 금지 → `_rt` 로 분리(§8)
3. **예외 A — 코드 참조는 인라인 허용:** 마스터의 열거형 속성은 자유 문자열 대신 **코드(`_ct`)를
   참조**하며, `_ct.id`(내부 uuid)를 테이블 안에 **인라인 컬럼**으로 둔다.
4. **예외 B — 같은 테이블 안의 상위-하위(계층) 참조는 인라인 허용:** 자기 자신을 가리키는
   계층 컬럼(`parent_id`)은 마스터 안에 그대로 **유지한다.** 트리 조회(재귀 CTE)가
   자연스럽고, 관계 테이블로 분리해도 얻는 것이 없다.
   - ⭕ `organization_mt.parent_id` → `organization_mt.id` (같은 테이블)
   - ⭕ `category_mt.parent_id` → `category_mt.id`

> 즉 "종속 컬럼 금지"는 **서로 다른 두 마스터 사이**에만 적용된다. 코드(`_ct`) 참조와
> 자기 자신에 대한 계층 참조는 대상이 아니다.

```sql
CREATE TABLE organization_mt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- 내부 불변 키(참조 전용)
  org_code    varchar(40) NOT NULL,     -- 사용자 유니크 키(표시·검색용, 변경 가능)
  name        varchar(200) NOT NULL,
  parent_id   uuid,          -- ⭕ 자기참조 계층 → organization_mt.id (예외 B)
  org_type_id uuid,          -- ⭕ 인라인 코드참조 → org_ct.id (code_group='ORG_TYPE')
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
  -- ❌ company_id 등 **다른** 마스터 종속 컬럼 금지
);
CREATE UNIQUE INDEX ux_organization_mt_org_code ON organization_mt(org_code);  -- 사용자 키
CREATE INDEX ix_organization_mt_parent   ON organization_mt(parent_id);        -- 참조(§12)
CREATE INDEX ix_organization_mt_org_type ON organization_mt(org_type_id);
CREATE INDEX ix_organization_mt_active   ON organization_mt(is_active) WHERE is_active;
```

## 7. Code table 규칙 (`_ct`)

1. **도메인/주제별로 하나의 `_ct` 테이블**을 두고 `code_group` 으로 코드그룹을 세분한다.
2. **테이블명은 `{도메인/주제}_ct`** — `_ct` 가 이미 code table 을 의미하므로 이름에 'code'를
   중복해 넣지 않는다. (예: `request_ct` ⭕ / `request_code_ct` ❌)
3. 코드 식별자는 **내부 uuid(`id`)**, 다른 테이블은 이 **id(uuid)를 인라인 참조**한다.
   여기서 `code` 컬럼이 곧 **사용자 유니크 키**(사람이 쓰는 값, 변경 가능)이다.
4. 표준 컬럼 + `UNIQUE(code_group, code)`.

```sql
CREATE TABLE request_ct (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- 내부 불변 키(참조 전용)
  code_group varchar(40) NOT NULL,   -- 'REQUEST_STATUS' | 'URGENCY' | 'INITIATIVE_TYPE' ...
  code       varchar(40) NOT NULL,   -- 'HIGH'  (사용자 유니크 키)
  name       varchar(100) NOT NULL,  -- '높음'
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_group, code)
);
```

## 8. Master↔Master 관계 규칙 (`_rt`)

1. `_rt` 는 **서로 다른 두 마스터**를 잇는다. 각 마스터의 **내부 id(uuid) 컬럼**으로 연결한다.
2. **참여 내부 id 컬럼 전체 조합을 UNIQUE** 로 둔다(중복 관계 방지). §3.
3. 관계 속성(`is_primary`, 유효기간, 순서, 원천키 등)은 `_rt` 에 둔다.
4. **자기참조(같은 테이블의 상위-하위)는 `_rt` 로 만들지 않는다** — §6.4 예외 B 에 따라
   인라인 `parent_id` 컬럼으로 둔다.

```sql
CREATE TABLE organization_company_rt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,   -- → organization_mt.id
  company_id      uuid NOT NULL,   -- → company_mt.id
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id)   -- 내부 id 조합 = 관계 유니크 키(§8.2)
);
CREATE INDEX ix_org_company_rt_company ON organization_company_rt(company_id);  -- 역방향 조회(§12)

-- ❌ organization_parent_rt 처럼 자기참조를 관계 테이블로 빼지 않는다.
--    organization_mt.parent_id 인라인 컬럼으로 충분하다(§6.4).
```

### 8.1 다대다 계층이 필요하면

한 노드가 **상위를 여럿** 가질 수 있는 DAG 구조라면 인라인 `parent_id` 로 표현할 수 없다.
이때만 예외적으로 자기참조 `_rt`(`organization_parent_rt`)를 만든다. 일반적인 트리
(상위 0~1개)는 §6.4 대로 인라인이다.

## 9. Transaction table 규칙 (`_tt`)

1. 업무 테이블은 마스터·코드·다른 업무를 **인라인 내부 uuid 컬럼으로 자유롭게 참조**한다.
   (`_rt` 는 master↔master 전용. 업무의 참조는 인라인)
   - 마스터 참조: `assignee_id uuid` → `user_mt.id`
   - 코드 참조: `urgency_id uuid` → `request_ct.id` (code_group='URGENCY')
   - 부모 업무 참조: `request_id uuid` → `request_tt.id`
2. 공통 컬럼(§5) + 소프트 삭제 컬럼을 포함한다.
3. 사용자 식별 번호(`request_no` 등)는 **사용자 유니크 키**(§3)로 별도 관리하며, 참조는
   내부 id 로 한다.

```sql
CREATE TABLE request_tt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- 내부 불변 키(참조 전용)
  request_no  varchar(20) NOT NULL,   -- 사용자 유니크 키(변경 가능)
  title       varchar(200) NOT NULL,
  status_id   uuid,          -- → request_ct.id (code_group='REQUEST_STATUS')
  urgency_id  uuid,          -- → request_ct.id (code_group='URGENCY')
  assignee_id uuid,          -- → user_mt.id
  requester_org_id uuid,     -- → organization_mt.id
  is_deleted  boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- 사용자 키는 살아있는 행에서만 유일(삭제분은 값 재사용 허용)
CREATE UNIQUE INDEX ux_request_tt_no ON request_tt(request_no) WHERE is_deleted = false;
CREATE INDEX ix_request_tt_status   ON request_tt(status_id);     -- 참조(§12)
CREATE INDEX ix_request_tt_assignee ON request_tt(assignee_id);
CREATE INDEX ix_request_tt_org      ON request_tt(requester_org_id);
```

## 10. 변경 이력 규칙 (`_ht`)

**모든 master(`_mt`)·code(`_ct`) 데이터의 변경 이력을 별도 히스토리 테이블에 남긴다.**
값이 바뀌었을 때 "언제·누가·무엇을 어떻게" 바꿨는지 되짚을 수 있어야 한다.

1. 원본 테이블마다 `{table}_ht` 를 둔다. **append-only 불변** — 소프트삭제/`updated_at` 없음.
2. 원본 **내부 id** 를 참조(`{entity}_id`)하고, `operation`(I/U/D)·변경 시점·변경자·
   전체 행 스냅샷(`jsonb`)을 남긴다. (변경 전/후가 모두 필요하면 `before/after` 두 컬럼)
3. **DB 트리거로 자동 적재**해 누락을 막는다(앱 경로마다 심지 않는다).

```sql
CREATE TABLE organization_ht (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,             -- → organization_mt.id (내부 id)
  operation   char(1) NOT NULL,          -- 'I' | 'U' | 'D'
  snapshot    jsonb NOT NULL,            -- 변경 후(삭제는 변경 전) 전체 행
  changed_by  uuid,                      -- → user_mt.id (누가)
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_organization_ht_org ON organization_ht(org_id, changed_at DESC);

-- 트리거 함수(모든 _mt/_ct 에 재사용). changed_by 는 세션 변수로 주입(app.actor_id).
CREATE OR REPLACE FUNCTION log_history() RETURNS trigger AS $$
DECLARE actor uuid := NULLIF(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  INSERT INTO organization_ht(org_id, operation, snapshot, changed_by)
  VALUES (COALESCE(NEW.id, OLD.id), left(TG_OP, 1),
          to_jsonb(COALESCE(NEW, OLD)), actor);
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_organization_ht
  AFTER INSERT OR UPDATE OR DELETE ON organization_mt
  FOR EACH ROW EXECUTE FUNCTION log_history();
```

> 대량·고빈도 테이블이면 트리거(동기) 대신 **아웃박스/CDC(비동기)** 로 이력을 적재해 본
> 트랜잭션 부담을 줄인다(§12).

## 11. 조회용 뷰 규칙 (`_vw`)

내부는 uuid 로만 연결하므로, 조회할 때마다 코드/마스터를 조인해 코드·이름을 붙이는 일이
반복된다. 이를 **뷰로 표준화**한다.

1. 자주 읽는 테이블은 `{table}_vw` 를 만들어, **참조 uuid 를 사람이 읽는 값(코드·이름)으로
   조인해 노출**한다. 앱/리포트/화면은 raw 테이블 대신 뷰를 읽는다.
2. 무거운 다중 조인·집계는 **머티리얼라이즈드 뷰**로 만들고 주기적/이벤트 기반 `REFRESH`
   한다(§12).
3. **소프트삭제/비활성 필터를 조회에서 빠뜨리지 않는다.** 모든 조회는 기본적으로
   `is_deleted = false` / `is_active = true` 를 적용한다. 실수 방지를 위해 **기본 `_vw` 는
   활성 행만** 노출하고, 앱은 원본 테이블 대신 이 뷰를 읽는 것을 기본으로 한다.
   (삭제/비활성까지 봐야 하는 관리 화면만 예외적으로 원본을 본다)

> **완화:** 관리자/감사 화면은 삭제·비활성 포함이 필요하다 → `{table}_all_vw`(전체) 를 따로 두거나
> 파라미터로 필터를 끈다. 성능상 부분 인덱스(§12)가 활성 행 조회를 이미 빠르게 해준다.

```sql
CREATE VIEW organization_vw AS
SELECT o.id, o.org_code, o.name,
       o.parent_id,   p.name  AS parent_name,
       o.org_type_id, t.code  AS org_type_code, t.name AS org_type_name,
       o.is_active, o.created_at, o.updated_at
FROM organization_mt o
LEFT JOIN organization_mt p ON p.id = o.parent_id
LEFT JOIN org_ct          t ON t.id = o.org_type_id;
```

## 12. 성능 규칙 (조회·쓰기 속도)

물리 FK가 없고 uuid 로 연결하는 구조이므로, 성능은 인덱스·키 설계로 확보한다.

- **인덱스(필수):**
  - 모든 참조 `*_id` 컬럼(마스터/코드/부모/`_rt` 의 각 id)에 인덱스. FK가 없어 자동 생성 안 됨.
  - 사용자 유니크 키(`org_code`, `request_no` 등)에 유니크 인덱스.
  - `is_active`/`is_deleted` 는 **부분 인덱스**(`WHERE is_active` / `WHERE is_deleted = false`)로
    살아있는 행만 좁게 인덱싱.
  - 자주 쓰는 조회 조합엔 **복합·커버링 인덱스**(WHERE→ORDER BY 컬럼 순).
- **시간정렬 UUID(v7) 권장:** `gen_random_uuid()`(v4 랜덤)는 B-tree 삽입 위치가 흩어져
  인덱스 페이지 분할·캐시 미스가 커진다. **UUID v7(시간순)** 을 쓰면 삽입·범위조회·인덱스
  지역성이 크게 좋아진다. (PostgreSQL 18 내장 `uuidv7()`, 이전 버전은 앱/확장으로 생성)
- **읽기 최적화:** 반복되는 uuid→코드/이름 조인은 §11 뷰로, 무거운 집계는 **머티리얼라이즈드
  뷰**로 미리 계산. 목록은 keyset(커서) 페이지네이션(OFFSET 지양).
- **쓰기 최적화:** 이력(`_ht`) 적재는 트리거(동기)로 하되 고빈도면 **아웃박스/CDC(비동기)**.
  대량 처리는 **배치 INSERT/UPDATE**. 인덱스는 조회에 실제 쓰는 것만(과다 인덱스는 쓰기 저하).
- **파티셔닝(대용량 `_tt`/`_ht`):** 로그·이력처럼 계속 쌓이는 테이블은 시간(월/연) 기준
  파티셔닝으로 조회 범위를 좁히고 보존정책(오래된 파티션 분리/삭제)을 단순화한다.

## 13. 참조 무결성 운영 — 삭제·비활성·고아 방지

물리 FK가 없어 `ON DELETE/UPDATE` 자동 동작이 없다. 무결성은 아래 규칙 + 앱으로 지킨다.

1. **마스터/코드는 물리 삭제하지 않는다 → `is_active=false`.** 내부 id 가 불변이라 참조 행은
   "비활성" 마스터를 계속 가리켜 관계가 깨지지 않는다.
2. **참조 컬럼마다 삭제/비활성 정책을 정한다**(컬럼 주석/설계서에 명시):
   - `restrict`(기본): 참조가 남아있으면 비활성/삭제를 앱이 막는다.
   - `nullify`: 참조를 NULL 로(선택적 관계일 때).
   - `cascade`(앱): 관련 `_tt`/`_rt` 도 함께 소프트삭제.
3. **고아(orphan) 탐지·주기 점검**을 표준화한다(임포트 순서·동기화로 생길 수 있음).
```sql
-- 예: 존재하지 않는 담당자를 가리키는 요청
SELECT r.id, r.assignee_id FROM request_tt r
LEFT JOIN user_mt u ON u.id = r.assignee_id
WHERE r.assignee_id IS NOT NULL AND u.id IS NULL;
```

> **완화:** 개발/시드 초기엔 참조 대상이 아직 없을 수 있다. 이럴 땐 **참조를 nullable 로 두고
> 나중에 채우거나**, 고아 점검을 "차단"이 아니라 "리포트+치유(self-heal)"로 운영한다. 배치/동기화
> 파이프라인은 순서 보장이 어려우므로 삽입 시 강제보다 **주기 점검**이 현실적이다.

## 14. 제약조건 적극 사용 (FK만 뺀다)

물리 FK를 뺐다고 나머지 제약까지 느슨히 하지 않는다. **오히려 더 강하게 건다.**

- **`NOT NULL`**: 필수 속성·필수 참조(선택 관계만 nullable).
- **`CHECK`**: 값 범위·상태(예: `CHECK (amount >= 0)`, 상태 조합 규칙).
- **`UNIQUE`**: 사용자 키(§3), `_rt` id 조합(§8), `_ct(code_group, code)`.
- **`DEFAULT`**: 표준 컬럼·플래그 기본값.

> **완화:** 레거시 이관·외부 유입처럼 지저분한 데이터가 들어오는 경로는 제약이 적재를 통째로
> 실패시킬 수 있다. 이런 **스테이징 테이블은 제약을 느슨히** 두고 정제 후 본 테이블로 옮긴다.
> 기존 데이터가 있는 테이블에 CHECK 를 도입하면 `NOT VALID` 로 걸고 점진 검증한다.

## 15. 데이터 타입·명명 표준

- **타입:** 금액 `numeric(p, s)`(부동소수 금지), 시각 `timestamptz`(항상 UTC 저장), 식별 `uuid`,
  열거 `_ct`(문자열 하드코딩 금지), 가변속성 `jsonb`(§20).
- **컬럼 명명:** `snake_case`, boolean `is_/has_`, 시각 `_at`, 참조 `{entity}_id`,
  사용자 키 `{entity}_code|_no`. 예약어(`user`, `order` 등) 회피.
- **테이블 명명:** `snake_case` + 접미어(§2). 단수/복수는 프로젝트에서 하나로 통일.

> **완화:** ORM(Prisma 등)은 모델 camelCase + `@map("snake_case")` 로 둘 다 만족한다. 외부 스키마를
> 미러링해야 하면 그쪽 명명을 따르되 경계(뷰/어댑터)에서 표준으로 정규화한다.

## 16. 멀티테넌시(스코프) 규칙

여러 조직/가구/사용자 데이터를 한 DB에 담으면 **테넌트 격리**를 스키마로 강제한다.

1. 스코프 대상 테이블에 **`tenant_id uuid`(또는 household_id)** 를 둔다(내부 id 참조).
2. **모든 유니크·PK 성격 키에 tenant 를 포함**한다: `UNIQUE(tenant_id, org_code)`,
   `_rt` 는 `UNIQUE(tenant_id, a_id, b_id)`.
3. **앱/미들웨어에서 모든 쿼리에 tenant 조건을 자동 주입**한다(수동 누락 방지) — 조회·수정·삭제·
   집계 전부. **중첩 조회(join/include)도 스코프가 새지 않게** 한다.
4. 코드(`_ct`)·전역 마스터처럼 **공용(전역) 데이터는 스코프 대상에서 제외**로 명시한다.

> **완화:** 초기 단일 테넌트 제품은 컬럼만 넣고 값은 기본 테넌트로 고정해 시작해도 된다(나중에
> 전환 시 백필 부담 없음). 강한 격리·규제가 필요하면 스키마/DB 분리도 선택지다.

## 17. 동시성·일관성

- **낙관적 락:** 동시 수정 충돌이 문제되는 테이블은 `version int`(또는 `updated_at`) 로
  `UPDATE ... WHERE id=? AND version=?`, 0행이면 충돌 처리.
- **원자성:** 한 업무 단위의 다중 테이블 쓰기(`_tt` + `_rt` + `_ht`)는 **한 트랜잭션**으로.
- **멱등성:** 외부/비동기/재시도 유입은 **dedup 키**(자연키 해시 등)로 중복 삽입을 막는다.

> **완화:** 대부분의 화면 편집은 경합이 드물다. **핫스팟(재고·잔액·번호 발번 등)에만** 락/직렬화를
> 적용하고 나머지는 생략해 단순함을 유지한다. 낙관적 락이 충돌을 자주 내면 비관적 락
> (`SELECT ... FOR UPDATE`)이나 큐 직렬화로 전환한다.

## 18. 마이그레이션·스키마 진화 안전

- **라이브 DB에 파괴적 명령 금지:** `prisma db push`·`migrate reset`·스키마 DROP 은 운영에서 절대
  금지. 배포는 **사전 검토된 `migrate deploy`** 만.
- **expand-contract(무중단):** 추가 → 백필 → 앱 전환 → (안정 후) 구컬럼 제거. 한 번에 rename/drop
  하지 않는다.
- **되돌릴 수 있게:** 변경 전 **백업/스냅샷**, 마이그레이션 히스토리 정합성 유지, 위험 변경엔
  롤백 절차 동반.

> **완화:** 로컬/CI의 **일회성 개발 DB**는 reset/push 로 빠르게 초기화해도 된다(버려도 되는 환경).
> "파괴적 명령 금지"는 **공유·운영 DB에만** 적용한다. 수동 SQL 을 직접 적용했다면 마이그레이션
> 이력과 어긋나므로, 반드시 **대응 마이그레이션 파일로 베이스라인을 맞춰 드리프트**(다음 migrate 가
> 리셋을 유발하는 상황)를 없앤다.

## 19. 보안·민감정보(PII)

- **비밀은 해시/암호화만 저장**(비밀번호=단방향 해시). 원문·해시 모두 **API 응답에 노출 금지** —
  필요 필드만 select/DTO 화이트리스트.
- **PII 컬럼 표기**(주석/메타) + 최소수집·at-rest 암호화·표시 마스킹·접근 최소권한.
- 로그·이력(`_ht`)·뷰(`_vw`)에도 민감값이 새지 않게 한다.

> **완화:** 개발/테스트는 **가명·합성 데이터**로 대체해 규제 부담 없이 다룬다. 전면 암호화가 조회를
> 막으면 검색 필요 필드는 **결정적 암호화/해시 인덱스**나 부분 마스킹으로 절충한다.

## 20. 문서화·JSONB 가이드

- **`COMMENT ON TABLE/COLUMN`** 으로 스키마를 자기설명화(분류·참조 대상·정책을 주석에).
- **JSONB 는 가변/희소 속성·스냅샷(`_ht`)에만.** 자주 **조회·조인·집계하는 값은 정식 컬럼**으로
  승격한다. JSONB 조건 조회는 **GIN 인덱스**. 스키마 회피용 남용 금지.

> **완화:** 요구가 유동적인 초기엔 JSONB 로 빠르게 담고, 쿼리 패턴이 굳으면 컬럼으로 정규화한다
> ("나중에 승격"). 문서화는 최소한 **분류·비표준 결정·완화 근거**만이라도 남긴다.

## 21. 설계 체크리스트

- [ ] 각 테이블을 master(`_mt`) / code(`_ct`) / transaction(`_tt`) 로 분류·명명했는가?
- [ ] 모든 테이블에 **내부 불변 `id uuid`** + (마스터/코드) **사용자 유니크 키**를 두었는가? (§3)
- [ ] 모든 참조·조인·`_rt` 연결을 **내부 id 로만** 했는가? (사용자 키를 참조 키로 쓰지 않았는가)
- [ ] 마스터 테이블에 **다른 마스터를 가리키는 종속 컬럼이 없는가?** (있으면 `_rt`) — 코드
      참조와 자기참조 `parent_id` 는 예외로 인라인(§6.3·§6.4)
- [ ] 서로 다른 마스터↔마스터 관계를 `_rt` 로 분리하고 **참여 id 조합에 UNIQUE** 를 걸었는가?(§8)
- [ ] 같은 테이블의 상위-하위 계층을 **불필요하게 `_rt` 로 빼지 않았는가?** (§8.1)
- [ ] 열거형 속성을 `_ct` 코드(인라인 uuid)로 참조했는가? `_ct` 는 도메인별 1개+`code_group`?
- [ ] 업무 테이블의 마스터/코드/부모 참조는 **인라인 uuid** 인가?
- [ ] **물리 FK 없이** 논리적 uuid 연결만 사용했는가?
- [ ] 공통 컬럼(id/created_at/updated_at)과 **`updated_at` 자동 갱신 트리거**를 넣었는가?(§5)
- [ ] `_tt` 소프트삭제(is_deleted/deleted_at), master/code 는 `is_active` 로 관리했는가?
- [ ] master/code 변경 **이력 테이블(`_ht`) + 트리거**를 두었는가?(§10)
- [ ] 반복 조인·집계를 **뷰(`_vw`)/머티뷰**로 표준화했는가?(§11)
- [ ] 참조 컬럼·사용자 키·활성/삭제 부분 인덱스, 시간정렬 UUID 등 **성능 규칙**을 적용했는가?(§12)
- [ ] 마스터/코드는 **삭제 대신 비활성**, 참조별 삭제정책 정의, **고아 탐지**를 두었는가?(§13)
- [ ] FK를 뺀 만큼 **NOT NULL/CHECK/UNIQUE/DEFAULT** 를 적극 걸었는가?(§14)
- [ ] 타입·명명 표준(numeric 금액, timestamptz UTC, is_/_at/_id 등)을 지켰는가?(§15)
- [ ] 멀티테넌트면 **tenant 컬럼 + 유니크에 tenant 포함 + 자동 스코핑**인가?(§16)
- [ ] 동시성 핫스팟에 **낙관적 락**, 다중 테이블 쓰기 **원자성**, 유입 **멱등성**?(§17)
- [ ] 라이브 DB **파괴적 명령 금지**, **expand-contract**·백업·마이그레이션 이력 정합?(§18)
- [ ] 비밀 해시·응답 미노출, **PII 표기·마스킹·최소권한**?(§19)
- [ ] 감사 컬럼(created_by/updated_by), COMMENT 문서화, JSONB 남용 회피?(§5·§20)
- [ ] 각 규칙의 **완화(예외) 근거**를 주석/PR에 남겼는가?(적용 원칙)
