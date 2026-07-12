# 도메인 모델 보강 설계서 (예산 · 반복지출 · 가족구성원)

> 백로그 §6-4 「예산 · 반복 · member 모델 보강」. 기존 [DATABASE.md](DATABASE.md) 스키마와 [AUTH_DESIGN.md](AUTH_DESIGN.md) 멀티테넌시(가구 스코프) 위에 세 모델을 얹는다.
> 세 모델은 서로 얽힌다: **member**(가족)에 지출·예산이 귀속되고, **반복지출**이 매월 거래를 생성하며, **예산**이 그 실적을 집계로 대비한다.
> 연동: [DATABASE.md](DATABASE.md) §3(테이블)·§8(월 집계) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §3(householdId 스코프) · [API_SPEC.md](API_SPEC.md)

---

## 0. 세 모델의 관계

```
        household (AUTH_DESIGN)
             │
   ┌─────────┼──────────────────────────┐
   ▼         ▼                          ▼
household_member   budget            recurring_rule
   │ (본인/선영/…)   │ (분류·구성원별)     │ (매월 고정지출)
   │                │                    │  autoCreate
   │                │                    ▼
   │                │            ┌── transaction ──┐  (매월 생성)
   └── 귀속(member_id)─┴─ 실적 집계 ─┘  status=pending → 확정
                    ▲                    │
          monthly_category_stat ◀───rebuild(§8)
```

- **household_member ≠ Membership**: `Membership`(AUTH_DESIGN §3)은 *앱 사용자*의 가구 접근권(owner/member/viewer). 여기 `household_member`는 *지출 명의*(본인/선영/채민/채성)로 **앱 계정이 없어도 존재**한다. 앱 사용자이기도 하면 `linked_user_id`로 연결.
- 카드 명세의 `card_label`(본인/가족253 — DATABASE.md §1.7)이 곧 member 귀속 힌트다.

---

## 1. 가족 구성원 (household_member)

### 1.1 모델

```prisma
model HouseholdMember {
  id           Int       @id @default(autoincrement())
  householdId  Int       @map("household_id")
  name         String                                   // 본인, 선영, 채민, 채성
  relation     String?                                  // self/spouse/child/parent (자유표기 허용)
  linkedUserId Int?      @map("linked_user_id")          // 앱 사용자면 연결(없으면 NULL)
  isSelf       Boolean   @default(false) @map("is_self") // 대표(본인) 1명
  color        String?                                   // 대시보드 색 태그(#RRGGBB)
  sortOrder    Int       @default(0) @map("sort_order")
  useYn        String    @default("Y") @map("use_yn") @db.Char(1)
  createdAt    DateTime  @default(now()) @map("created_at")

  household Household @relation(fields: [householdId], references: [id])
  user      User?     @relation(fields: [linkedUserId], references: [id])
  transactions   Transaction[]
  paymentMethods PaymentMethod[]

  @@index([householdId])
  @@map("household_member")
}
```

### 1.2 기존 테이블 연결 (귀속)

| 테이블 | 추가 컬럼 | 의미 |
|--------|-----------|------|
| `transaction` | `member_id INT NULL` FK → household_member | 이 지출/수입의 명의(본인/가족) |
| `payment_method` | `member_id INT NULL` FK → household_member | 카드/계좌 명의자 (기존 `owner` 문자열을 승격) |

- **자동 귀속(적재 파이프라인)**: `card_label`·`payment_method.owner`(본인/가족)를 member로 매핑 → 거래 생성 시 `transaction.member_id` 자동 부여. 결제수단에 `member_id`가 있으면 그 카드 거래는 기본적으로 해당 member.
- **집계 확장**: 향후 `monthly_member_stat`(ym, member_id, expense_total, …) 추가 시 "구성원별 지출" 대시보드 가능. (이번 범위는 컬럼·귀속까지, 집계 테이블은 후순위.)
- **마이그레이션**: 가구 생성 시 `isSelf=true` 기본 member 1건 자동 생성(회원가입 훅). 기존 `payment_method.owner` 문자열 → member upsert 후 `member_id` backfill.

---

## 2. 예산 (budget)

### 2.1 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| B1 | 주기 | **월(monthly) 우선** | 가계부 집계 단위(ym)와 일치. 주/연은 후순위 |
| B2 | 반복 정의 | **템플릿(기본) + 월 오버라이드** | 매월 같은 예산은 `ym=NULL` 1건, 특정 달만 다르면 그 달 행 추가 |
| B3 | 대상 | **분류(category_code)별** + 총예산(`category_code=NULL`) | 대분류/소분류 어느 레벨이든 지정 가능 |
| B4 | 구성원 | `member_id` NULL(가구 전체) 또는 특정 member | 개인별 용돈 예산 지원 |
| B5 | 실적 소스 | `monthly_category_stat` 재사용 | 이미 rebuild되는 집계(§8)로 소진율 계산, 중복 합산 없음 |

### 2.2 모델

```prisma
model Budget {
  id           Int      @id @default(autoincrement())
  householdId  Int      @map("household_id")
  ym           String?  @db.Char(7)                     // NULL=매월 기본 템플릿, '2026-07'=해당 월 오버라이드
  categoryCode String?  @map("category_code")           // NULL=총예산
  memberId     Int?     @map("member_id")               // NULL=가구 전체
  amount       Decimal  @db.Decimal(15, 2)              // 한도 금액
  alertRatio   Decimal  @default(80) @map("alert_ratio") @db.Decimal(5, 2) // 경고 임계 %(소진율)
  rollover     Boolean  @default(false)                 // 잔액 이월 여부(후순위 계산)
  useYn        String   @default("Y") @map("use_yn") @db.Char(1)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  household Household @relation(fields: [householdId], references: [id])
  category  Category? @relation(fields: [categoryCode], references: [code])
  member    HouseholdMember? @relation(fields: [memberId], references: [id])

  @@unique([householdId, ym, categoryCode, memberId])   // 동일 스코프 중복 방지
  @@index([householdId, ym])
  @@map("budget")
}
```

### 2.3 소진율(실적 대비) 계산

특정 월 `ym`의 카테고리 예산 조회 시:
1. **한도(limit)** = 그 달 오버라이드(`ym=YM`) 있으면 그 값, 없으면 템플릿(`ym=NULL`) 값.
2. **실적(spent)** = `monthly_category_stat`에서 `ym=YM, category_code` 합. (member 예산이면 `monthly_member_stat` 필요 → 후순위, 그전까지는 member별 예산은 실적 미대비 상태로 표시.)
3. **소진율** = `spent / limit * 100`, **초과** = `spent > limit`, **경고** = `소진율 ≥ alertRatio`.

> 대분류 예산인데 실적은 소분류로 쌓인 경우: 하위 코드 실적을 롤업 합산(예: `05` 예산 vs `0501+0502+0503` 실적). category self-reference(DATABASE.md §3.2)로 하위 코드 목록을 구해 합산.

### 2.4 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|:----:|
| GET | `/budgets?ym=2026-07` | 예산 목록(해당 월 유효 한도로 해석) | 조회 |
| POST | `/budgets` | 예산 생성(템플릿 또는 월 오버라이드) | owner |
| PATCH | `/budgets/{id}` | 한도·경고임계 수정 | owner |
| DELETE | `/budgets/{id}` | 삭제 | owner |
| GET | `/budgets/status?ym=2026-07` | **대비 실적**(카테고리별 limit/spent/ratio/over/alert) | 조회 |

```jsonc
// GET /budgets/status?ym=2026-07
{
  "ym": "2026-07",
  "total":   { "limit": 3000000, "spent": 1842000, "ratio": 61.4, "over": false, "alert": false },
  "byCategory": [
    { "categoryCode": "05", "name": "생활", "limit": 800000, "spent": 902300, "ratio": 112.8, "over": true,  "alert": true },
    { "categoryCode": "08", "name": "교통", "limit": 150000, "spent": 96500,  "ratio": 64.3,  "over": false, "alert": false }
  ]
}
```

- 예산 미설정 카테고리는 응답에서 `limit=null`(실적만 표기) 또는 생략(쿼리 파라미터로 선택).
- **알림 연동**: `alert=true`/`over=true`는 프론트 Toast·대시보드 경고(FRONTEND_DESIGN §12 "예산 초과 경고")로 노출.

---

## 3. 반복 / 고정 지출 (recurring_rule)

보험·대출·적금·통신처럼 매월 반복되는 거래를 규칙으로 등록하고, 매월 자동 생성한다.

### 3.1 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| R1 | 표현 | **별도 규칙 테이블 + 생성 거래에 역참조** | 규칙 변경이 과거 거래에 영향 없음 |
| R2 | 자동 생성물 상태 | **`status='pending'`로 생성 → 사용자 확정** | 금액 변동(통신·공과금) 검토 후 확정, 오생성 방지 |
| R3 | 생성 시점 | 월 배치(cron) + `dayOfMonth` | 결제일 기준으로 그 달 거래 예약 |
| R4 | 감지 힌트 | 카드 명세 `일시불(생활형 정기결제)` (DATABASE.md §1.7) | 규칙 등록 후보 추천 |

### 3.2 모델

```prisma
model RecurringRule {
  id              Int       @id @default(autoincrement())
  householdId     Int       @map("household_id")
  type            TransactionType                        // income/expense
  categoryCode    String    @map("category_code")
  paymentMethodId Int?      @map("payment_method_id")
  memberId        Int?      @map("member_id")
  counterpartyId  Int?      @map("counterparty_id")
  description     String?                                // 예: METLIFE 선영, KT통신요금
  amount          Decimal?  @db.Decimal(15, 2)           // 고정액(변동이면 NULL → 확정 시 입력)
  dayOfMonth      Int       @map("day_of_month")         // 청구일(1~31, 말일은 31로 clamp)
  frequency       String    @default("monthly")          // monthly(우선), 이후 weekly/yearly
  startYm         String    @map("start_ym") @db.Char(7)
  endYm           String?   @map("end_ym") @db.Char(7)   // NULL=무기한
  autoCreate      String    @default("Y") @map("auto_create") @db.Char(1) // Y=자동생성, N=알림만
  lastGeneratedYm String?   @map("last_generated_ym") @db.Char(7)         // 멱등성(중복생성 방지)
  useYn           String    @default("Y") @map("use_yn") @db.Char(1)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  household     Household      @relation(fields: [householdId], references: [id])
  category      Category       @relation(fields: [categoryCode], references: [code])
  paymentMethod PaymentMethod? @relation(fields: [paymentMethodId], references: [id])
  member        HouseholdMember? @relation(fields: [memberId], references: [id])
  transactions  Transaction[]

  @@index([householdId, useYn])
  @@map("recurring_rule")
}
```

### 3.3 기존 `transaction` 연결

| 추가 컬럼 | 의미 |
|-----------|------|
| `is_recurring CHAR(1) DEFAULT 'N'` | 반복성 거래 표시(집계/필터용) |
| `recurring_rule_id INT NULL` FK → recurring_rule | 어떤 규칙에서 생성됐는지 역참조 |

### 3.4 생성 로직 (월 배치)

```
매월 배치(또는 온디맨드) — 대상 ym 확정
 for each RecurringRule (useYn='Y', startYm ≤ ym ≤ endYm, lastGeneratedYm ≠ ym):
   date = ym + clamp(dayOfMonth, 그 달 말일)
   if autoCreate='Y':
     INSERT transaction(status='pending', is_recurring='Y', recurring_rule_id=rule.id,
                        amount=rule.amount /*NULL이면 검토화면에서 입력*/, member_id=rule.memberId ...)
   rule.lastGeneratedYm = ym         // 멱등성: 같은 달 재실행해도 중복 생성 안 함
 → 생성분은 검토 화면(REVIEW_WORKFLOW_DESIGN)의 pending 흐름으로 확정
```

- **멱등성**: `lastGeneratedYm`으로 같은 달 재생성 차단. (배치 재시도·수동 트리거 안전.)
- **확정 흐름 재사용**: 생성 거래는 `status='pending'`이므로 기존 검토·확정 워크플로([REVIEW_WORKFLOW_DESIGN.md](REVIEW_WORKFLOW_DESIGN.md))로 그대로 확정 → 확정 시 해당 월 rebuild.
- **자동입력 명세서와 충돌 방지**: 카드/은행 명세로 이미 적재된 실거래가 있으면 반복 생성분은 후보로만 두고, 확정 화면에서 **중복 병합**(같은 분류·결제수단·근사 금액) 제안. (완전 자동 매칭은 후순위.)

### 3.5 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|:----:|
| GET | `/recurring-rules` | 규칙 목록 | 조회 |
| POST | `/recurring-rules` | 규칙 등록 | member↑ |
| PATCH | `/recurring-rules/{id}` | 수정(금액·결제일·종료월 등) | member↑ |
| DELETE | `/recurring-rules/{id}` | 삭제(과거 생성분 유지) | member↑ |
| POST | `/recurring-rules/generate?ym=2026-07` | 해당 월 수동 생성(멱등) | member↑ |
| GET | `/recurring-rules/suggestions` | 명세서 기반 반복 후보 추천(§3.1 R4) | 조회 |

---

## 4. 스키마 변경 요약 (구현 시)

- **신규 테이블**: `household_member`, `budget`, `recurring_rule`
- **컬럼 추가**:
  - `transaction`: `member_id`, `is_recurring`, `recurring_rule_id`
  - `payment_method`: `member_id` (기존 `owner` 문자열은 유지하되 member로 승격 backfill)
- **enum 추가**(`@ledger/shared`): `RecurringFrequency`(monthly/weekly/yearly), `BudgetPeriod`(monthly) — 향후 확장 대비 상수화
- **가구 스코프**(AUTH_DESIGN §3.2): 세 신규 테이블 모두 `household_id` NOT NULL + 인덱스, Prisma householdScope 확장으로 자동 필터
- **마이그레이션 순서**: ① 테이블/컬럼 추가(nullable) → ② 기본 member 생성·`owner` backfill → ③ 자동귀속 재적재(선택) → ④ 필요한 NOT NULL 승격

---

## 5. 백로그 매핑

| DESIGN_BACKLOG 항목 | 본 문서 |
|---------------------|---------|
| 🟡 예산(Budget) 모델·API | §2 |
| 🟡 반복/고정 지출 (is_recurring + 자동 생성 규칙) | §3 |
| 🟡 가족 구성원(member) 모델 | §1 |

---

## 6. 확정 필요 사항

1. **member 자동귀속 기본값**: 결제수단 명의가 곧 member인가(권장) vs 항상 수기 지정?
2. **반복 생성물 상태**: `pending` 검토 후 확정(권장) vs `settled` 즉시 반영(편의) — 금액 변동 항목이 많으면 pending 권장.
3. **예산 실적의 member 분해**: `monthly_member_stat` 집계 테이블 도입 시점(개인별 예산 소진율 정확도와 직결).
4. **예산 주기 확장**: 월 외 주/연 예산 필요 여부(초기 월만 권장).
