# 가계부 DB 설계서 (수입 + 지출 통합)

> 구글 드라이브 "가계 정리" 스프레드시트의 **수입 / 지출 테이블**을 기반으로 설계.
>
> - 수입 원본: `수입처 / 일 / 수입 항목 / 입금액 / 입금일 / 입금계좌`
> - 지출 원본: `분류 / 일 / 지출 항목 / 지출액 / 지출일 / 지출처 / 비고`

---

## 1. 원본 데이터 분석

### 1.1 수입 테이블
| 원본 컬럼 | 예시 | 정규화 방향 |
|-----------|------|-------------|
| 수입처 | VNTG, 신한카드, 변채민 | `counterparty` (거래 상대) |
| 일 | 4, 12, 20 | `transaction_date` |
| 수입 항목 | 본 월급, 출장비, 캐시백 | `category` (type='income') |
| 입금액 | 6,700,225 | `amount` |
| 입금일 | 26-01-04 | `settled_date` |
| 입금계좌 | 하나은행62707 | `payment_method` |

### 1.2 지출 테이블
| 원본 컬럼 | 예시 | 정규화 방향 |
|-----------|------|-------------|
| 분류 | 공과금, 투자, 보험, 대출, 통신, 생활, 교육 | `category` (type='expense') |
| 일 | 5, 12, 22 | `transaction_date` |
| 지출 항목 | METLIFE 선영, 주택금융공사(원금+이자) | `transaction.description` (거래별 상세) |
| 지출액 | 109,440 (일부 공란) | `amount` (NULL 허용) |
| 지출일 | 26-01-11 | `settled_date` |
| 지출처 | 하나은행47307, 신한카드KT본인, 삼성카드T | `payment_method` (계좌+카드 통합) |
| 비고 | (메모) | `transaction.memo` |

### 1.3 수입·지출 비교를 통한 핵심 설계 결정
| 항목 | 수입 | 지출 | 통합 설계 |
|------|------|------|-----------|
| **카테고리** | `수입 항목`(단일) | `분류`(대분류) | `category` 테이블 + `type` 으로 통합 |
| **상세 설명** | (없음) | `지출 항목`(상세 텍스트) | `transaction.description` 로 보존 |
| **거래 상대** | `수입처` | (지출 항목에 내포) | `counterparty` (NULL 허용) |
| **결제수단** | `입금계좌`(은행) | `지출처`(은행+카드) | `payment_method` 로 일반화 (type: bank/card) |
| **금액** | 항상 존재 | 일부 공란 | `amount` NULL 허용 + `status` |

> **가장 중요한 통합 포인트**: 지출처에 은행 계좌와 신용/체크카드가 섞여 있어, 수입의 `입금계좌`까지 포괄하는 **`payment_method`** 테이블로 일반화한다.

### 1.4 은행 거래내역(원천 데이터)
은행에서 내려받은 **거래내역 원본**. 수기 수입/지출 시트는 이 원천을 사람이 분류·가공한 결과이므로, 원천을 **별도 적재(staging) 테이블**에 보존하고 분류 결과를 `transaction`에 연결한다.

**헤더 정보**
| 항목 | 예시 | 매핑 |
|------|------|------|
| 계좌번호 | 569-910201-47307 | `payment_method` (= 하나은행47307) |
| 예금종류 | 수신 | (참고) |
| 조회기간 | 2026-03-01 ~ 2026-03-31 | 적재 배치 메타 |
| 잔액 / 인출가능금액 | -37,769,406 / 2,230,594 | (참고) |

**명세 컬럼**
| 원본 컬럼 | 예시 | 매핑 |
|-----------|------|------|
| 거래일시 | 2026-03-24 18:44:07 | `bank_transaction.txn_at` (DATETIME) |
| 구분 | 타행이체, 타행송금(키움증권), 대출이자, CMS | `bank_transaction.txn_type_code` (코드화) |
| 적요 | 변채민친구밥, 키움투자, METLIFE03190 | `bank_transaction.description` |
| 출금액 | 200,000 | `bank_transaction.withdrawal` |
| 입금액 | 7,800 | `bank_transaction.deposit` |
| 잔액 | -37,946,258 | `bank_transaction.balance` |
| 거래점 | 기업은행(2081), 모바일뱅킹(스마트폰) | `bank_transaction.branch` |

**구분(거래 유형) 값 분석** — 앞부분은 거래 유형, 괄호는 상대 기관:
`타행이체`, `타행송금(키움증권/카카오뱅크/우리은행/기업은행/신한은행)`, `당행송금`, `대출이자`, `타사카드`, `하나카드`, `정기적금`, `대체`, `보험료`, `CMS`, `청약종합`, `급여이체`, `예금이자`, `현금`
→ 기준 유형은 `bank_txn_type` 코드 테이블로 관리, 괄호 상세는 원문 보존.

**계좌별 특이 케이스** (62707 계좌 추가 확인)
- **잔액 `-` 표기**: 출금 직후 잔액이 `-`(대시)로 표기되는 행 존재 → `balance = NULL`로 적재(미표기 의미).
- **적요 공란**: `현금`(CD/ATM) 거래는 적요가 비어 있음 → `description = NULL` 허용.
- **세금 정보**: `예금이자` 적요 `(예금이자 22 소득세 0 지방소득세 0)`는 파싱하지 않고 원문 보존.

> **흐름**: `bank_transaction`(원천) → [분류 작업] → `transaction`(가계부 거래). 한 건의 은행 거래는 0~1건의 가계부 거래로 매핑(자기 계좌 간 이체·정보성 행은 미연결 가능).

### 1.5 카드 이용대금 명세서 (자동 입력 원천)
카드사 명세서는 **① 명세서 헤더(요약)** + **② 이용상세내역(건별)** 2단 구조. 업로드 시 ①은 `card_statement`, ②는 `card_transaction`에 적재하고, **가맹점명 기반 자동 분류**로 `transaction`을 생성한다.

**① 명세서 헤더 → `card_statement`**
| 원본 | 예시 | 매핑 |
|------|------|------|
| 명세서 기준월 | 2026년 04월 | `statement_ym` |
| 출금일/결제일 | 2026.04.13 | `billing_date` |
| 합계(입금하실 금액) | 1,298,219 | `total_amount` |
| 일시불 / 할부 / 현금서비스 / 카드론 / 리볼빙 / 연회비 | 1,298,219 / 0 / … | 각 합계 컬럼 |
| 전월 미결제 / 연체료 | 0 / 0 | `prev_unpaid` / `late_fee` |
| 총건수 / 혜택금액 | 77 / -20,317 | `total_count` / `benefit_total` |
| 작성일 | 2026.04.01 | `created_date` |
| 신용공여기간(일시불/할부) | 2026.03.01~03.31 | `credit_from`/`credit_to` |

**② 이용상세내역 → `card_transaction`** (컬럼 13종)
| 원본 | 예시 | 매핑 |
|------|------|------|
| (카드 구분 헤더) | #tag1카드 Navy 본인 7322 | `card_label` |
| 거래일자 | 2026.03.01 | `txn_date` |
| 가맹점명 | 대성석유(주)…주유소 | `merchant_name` |
| 이용금액 | 74,000 | `usage_amount` |
| 할부기간 | - | `installment_period` |
| 청구회차 | - | `billing_round` |
| 결제원금 | 71,420 | `principal` (실제 청구액) |
| 수수료 | 0 | `fee` |
| 이용혜택 | 할인 / 포인트사용 | `benefit_type` |
| 혜택금액 | -2,580 | `benefit_amount` |
| 이용지역 | 국내 / 국외 | `region` |
| 혜택구분 | 일시불 / 할부 / 기타매출 | `sale_type` |
| 결제후잔액 | 0 | `balance_after` |
| 포인트 | 0 | `point` |

**핵심 포인트**
- **가계부 금액 = `결제원금(principal) + 이자(fee)`**: 할인 반영 실청구 원금 + 할부 이자. 일시불은 `fee=0`이라 결제원금과 동일. 예: 74,000 − 2,580 = 71,420(일시불).
- **할부**: `할부기간`/`청구회차`가 그대로 회차 정보(일시불은 `-`). `transaction`의 할부 컬럼으로 연결.
- **자동 분류 엔진**: `가맹점명`을 `merchant_category_map`(가맹점 패턴 → 분류 코드)으로 매칭해 `category_code` 자동 부여 → 미매칭만 수기 분류.

> **흐름**: `card_transaction`(원천) → [가맹점 자동매핑] → `transaction`(가계부 지출). 결제일(`billing_date`)이 `settled_date`, 개별 거래일이 `transaction_date`.

### 1.6 카드사별 명세서 포맷 차이 (정규화)
카드사마다 컬럼 구성이 달라, 업로드 파서가 **`card_transaction` 공통 스키마로 정규화**한다.

| 항목 | 하나카드 | 현대카드 | 정규화 |
|------|----------|----------|--------|
| 할부/회차 | `할부기간` + `청구회차` 분리 | `할부/회차` 결합 (예: `3/3`) | `installment_period` + `billing_round`로 분리 저장 |
| 적립/할인율 | (없음) | `적립/할인율(%)` (예: 0.70%) | `benefit_rate` |
| 적립·할인 금액 | `혜택금액`(할인 음수) + `포인트` | `예상적립/할인` 단일 컬럼(적립 +, 할인 −) | `benefit_amount`(할인 음수) / `point`(적립)로 분해 |
| 카드 구분 | `#tag1카드 …` 헤더 라인 | `이용카드`(예: 본인 ZERO, 본인 SKT-M…) | `card_label` |
| 가맹점 | `가맹점명` | `이용가맹점` | `merchant_name` |

**현대카드 특이 케이스**
- **금액 기준 동일**: 가계부 지출 = `결제원금(principal)`. 예: `모바일이즐 500 / 할인 -4 / 결제원금 496` → 496.
- **적립 vs 할인 판별**: `결제원금 < 이용금액`이면 그 차액은 **할인**(`benefit_amount` 음수), `결제원금 = 이용금액`이고 값이 양수면 **적립 포인트**(`point`). 예: 코스트코 `21,690 / +108 / 결제원금 21,690` → 적립 108, 지출 21,690.
- **결제원금 0원 정보성 행 제외**: `GS25 M포인트 사용 / 이용금액 0 / 결제원금 0`처럼 실제 청구 0원 행은 `status='info'`(또는 미연결)로 두어 집계 제외. (직전 GS25 구매 20,900 → M포인트 2,769 사용 → 결제원금 18,131에 이미 반영됨.)
- **할부 원거래일 vs 청구월**: 할부 건은 `이용일`(예: 2026-01-05)을 `card_transaction.txn_date`에 보존하되, **회차별 월 집계 정책**(7.2)에 따라 가계부 `transaction_date`는 청구월(명세서 월)로 생성하고 `amount = principal`(회차 금액). 예: `나이스-팬딩 330,000 할부 3/3 / 결제원금 110,000` → 이번 달 지출 110,000.

### 1.7 신한카드 명세서 특이사항
| 항목 | 신한카드 표기 | 정규화 |
|------|--------------|--------|
| 할부기간 / 회차 | 분리 (`할부기간`, `회차`) | `installment_period` + `billing_round` |
| 납부원금 / 수수료 | `이번달 납부금액`(원금/수수료) | `principal` + `fee` |
| 적용 구분 | 할인 / 취소 / (공란) | `sale_type` |
| 포인트적립율 | `포인트적립율(마이신한포인트)` | `benefit_rate` 또는 `point` |
| 결제계좌 | 하나은행 / 56991\*\*\*\*\*7307 | `card_statement.settle_account_id` (= 하나은행47307) |
| 카드 명의 | 본인253 / 가족160 | `card_label` (본인/가족 + 식별번호) |

**핵심 처리 규칙**
- **금액 = 납부원금(principal)**: `이용금액`이 아닌 `이번달 납부금액-원금`이 실청구액. 예: `KT통신요금 이용 102,310 / 할인 15,000 / 납부원금 87,310` → 지출 87,310.
- **취소 거래 처리**: `적용구분='취소'` + 음수 `이용금액` 행은 `is_canceled='Y'`로 적재. 정상→취소→재승인 3행 패턴(예: 고속버스 22,000 → −22,000 → 22,000)에서 **납부원금이 0인 행(원거래·취소분)은 집계 제외**, 실제 청구된 행(납부원금 22,000)만 지출로 잡는다. → `principal` 기준으로 집계하면 자동 상계.
- **결제계좌 연결**: 명세서의 결제계좌(`하나은행47307`)를 `settle_account_id`로 연결 → 은행 명세의 `타사카드(신한카드) 출금`을 `card_settlement`로 자동 식별·제외(7.2).
- **할인 상세(섹션 6) 보존**: `할인내역` 텍스트(예: `KT 가족만족 DC`)는 `benefit_note`에, 할인 금액은 `benefit_amount`(음수)에 저장. 원금은 이미 할인 반영.
- **생활형 정기결제 분류**: 명세서가 `일시불(생활형 정기결제)`로 묶는 항목(예: KT통신요금)은 고정 지출 힌트 → 분류 시 `is_recurring='Y'` 후보(7절 확장).
- **본인/가족 구분**: `가족160` 등은 가족 구성원 지출. `card_label`에 보존하고, 향후 `member` 테이블 분리 시 매핑.

### 1.8 삼성카드 명세서 특이사항
일시불/할부 섹션이 동일 컬럼 구조. 할부 정보가 가장 상세하다.

| 삼성카드 컬럼 | 정규화 |
|--------------|--------|
| 이용일 (`20260301` 형식) | `txn_date` (구분자 없는 yyyymmdd 파싱) |
| 이용구분 (본인 252) | `card_label` |
| 가맹점 | `merchant_name` |
| 이용금액 | `usage_amount` |
| 총할부금액 | `installment_total_amt` |
| 이용혜택 / 혜택금액 | `benefit_type` / `benefit_amount` |
| 개월 / 회차 | `installment_period` / `billing_round` |
| 원금 | `principal` (이번 달 청구 원금) |
| 이자/수수료 | `fee` |
| 포인트명 / 적립금액 | `point_name` / `point` |
| 입금후잔액 | `balance_after` |

**핵심 처리 규칙**
- **할부 회차별 집계 일치**: SKT `이용금액 480,000 / 개월 24 / 회차 14 / 원금 20,000 / 이자 1,082` → 이번 달 지출 = `principal 20,000`(+ 필요 시 이자 1,082 별도). 총액(480,000)은 `usage_amount`로 보존하되 집계 제외. (7.2 회차별 월 집계 정책과 동일)
- **이자/수수료 처리 (확정: 원금+이자 합산)**: 할부 이자(`fee`)는 **원금과 합산해 그 달 지출로 집계**한다. 즉 가계부 지출 금액 = `principal + fee`(실제 출금액 기준). 예: SKT `원금 20,000 + 이자 1,082` → 이번 달 지출 **21,082**. `fee`는 이자 분석을 위해 컬럼으로 계속 보존.
- **선입금/할인 조정 행**: `미리입금/할인,면제 등 −10,000`처럼 가맹점이 없는 조정 행은 `merchant_name='(선입금/할인·면제)'`, `sale_type='조정'`, `principal` 음수로 적재. 해당 월 청구액에서 차감 반영.
- **포인트사용 0원 행**: `바로알림서비스 03월이용료 / 이용 300 / 포인트사용 −300 / 원금 0` → 실청구 0원이므로 `status='info'` 집계 제외.
- **날짜 포맷**: `20260301`(yyyymmdd, 구분자 없음) → 파서가 `DATE`로 정규화.

---

## 2. ERD 개요

```
                bank_txn_type        card_statement
                     │                    │
                     v                    v
counterparty ─┐ bank_transaction    card_transaction ─ merchant_category_map
              ├─< transaction >─────┴────┴──────────── payment_method
category ─────┘
```
- `payment_method` 1 : N `bank_transaction` / `card_transaction` (수단별 원천 내역)
- `bank_transaction` / `card_transaction` 0..1 : 1 `transaction` (분류 결과 연결)
- `bank_txn_type` 1 : N `bank_transaction`
- `card_statement` 1 : N `card_transaction` (명세서별 건별 내역)
- `merchant_category_map` : `card_transaction` 가맹점명 → `category` 자동 매핑

```
counterparty ──┐
               ├─< transaction >─ payment_method
category ──────┘
```

- `category` 1 : N `transaction`
- `counterparty` 1 : N `transaction` (NULL 허용)
- `payment_method` 1 : N `transaction`

---

## 3. 테이블 정의

### 3.1 `payment_method` — 결제수단 (계좌 + 카드 통합)
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 결제수단 ID |
| name | VARCHAR(50) | NOT NULL, UNIQUE | 원문 표기 (예: 하나은행47307, 삼성카드T) |
| method_type | VARCHAR(10) | NOT NULL | 'bank' / 'card' |
| issuer | VARCHAR(50) | NULL | 은행/카드사 (예: 하나은행, 삼성카드, 현대카드) |
| identifier | VARCHAR(50) | NULL | 계좌 식별번호 또는 카드 별칭 (예: 47307, T, M본인) |
| account_no | VARCHAR(30) | NULL | 전체 계좌번호 (예: 569-910201-47307) |
| owner | VARCHAR(30) | NULL | 명의자 (예: 본인, 선영) |
| created_at | DATETIME | DEFAULT now | 생성 시각 |

> 예: `신한카드KT본인` → name='신한카드KT본인', method_type='card', issuer='신한카드', owner='본인'
> 예: 계좌 `569-910201-47307` → name='하나은행47307', method_type='bank', issuer='하나은행', identifier='47307', account_no='569-910201-47307'

### 3.2 `category` — 분류 코드 (Parent-Child 코드 관리)
자기참조(self-reference) 구조의 **코드 관리 테이블**. 코드 값(`code`)이 업무 키(PK)이며, `parent_code`로 대/소분류 계층을 표현한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| code | VARCHAR(10) | **PK** | 분류 코드 (대분류 2자리, 소분류 4자리) |
| parent_code | VARCHAR(10) | FK → category.code, NULL | 상위 분류 코드 (NULL = 대분류) |
| name | VARCHAR(50) | NOT NULL | 분류명 |
| type | VARCHAR(10) | NOT NULL | 'income' / 'expense' |
| depth | INTEGER | NOT NULL | 계층 깊이 (1=대분류, 2=소분류) |
| sort_order | INTEGER | DEFAULT 0 | 정렬 순서 |
| use_yn | CHAR(1) | DEFAULT 'Y' | 사용 여부 ('Y'/'N') |

**채번 규칙**: 대분류 = 2자리 일련번호(`05`), 소분류 = `상위코드(2) + 소분류 일련번호(2)`(`0501`).

#### 지출 분류 코드 시드 데이터
| code | parent_code | name | depth |
|------|-------------|------|-------|
| 01 | (NULL) | 대출 | 1 |
| 02 | (NULL) | 투자 | 1 |
| 03 | (NULL) | 보험 | 1 |
| 04 | (NULL) | 공과금 | 1 |
| 05 | (NULL) | 생활 | 1 |
| 0501 | 05 | 월 생활비 | 2 |
| 0502 | 05 | ATM 출금 | 2 |
| 0503 | 05 | 기타 | 2 |
| 06 | (NULL) | 통신 | 1 |
| 07 | (NULL) | 건강 | 1 |
| 08 | (NULL) | 교통 | 1 |
| 09 | (NULL) | 차량 | 1 |
| 10 | (NULL) | 경조사 | 1 |
| 11 | (NULL) | 교육 | 1 |
| 12 | (NULL) | 여가 | 1 |

> **거래 연결 규칙**: `transaction`은 가장 하위 코드를 참조한다. 소분류가 있으면 소분류 코드(예: `0501`), 없으면 대분류 코드(예: `01`)를 사용한다.
> **수입 분류**: 동일 테이블에 `type='income'`으로 `1x`/`2x`대 코드를 추가해 같은 방식으로 관리한다.

### 3.3 `counterparty` — 거래 상대 (수입처/거래처)
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 거래 상대 ID |
| name | VARCHAR(100) | NOT NULL, UNIQUE | 이름 (예: VNTG, 신한카드, 변채민) |
| type | VARCHAR(20) | NULL | 유형 (회사/카드사/개인) |

> 수입의 `수입처`를 저장. 지출은 보통 NULL(상세는 `description`), 필요 시 거래처로 활용.

### 3.4 `transaction` — 거래 (수입/지출 공용)
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 거래 ID |
| type | VARCHAR(10) | NOT NULL | 'income' / 'expense' |
| category_code | VARCHAR(10) | FK → category.code, NOT NULL | 분류 코드 (최하위 코드 참조) |
| counterparty_id | INTEGER | FK → counterparty.id, NULL | 수입처/거래처 |
| payment_method_id | INTEGER | FK → payment_method.id, NOT NULL | 입금/결제 수단 |
| description | VARCHAR(255) | NULL | 거래 상세 (지출 항목 텍스트) |
| amount | DECIMAL(15,2) | NULL | 금액 (공란 허용) |
| transaction_date | DATE | NOT NULL | 거래 발생일 (원본 `일`) |
| settled_date | DATE | NULL | 입금/결제일 (입금일/지출일) |
| status | VARCHAR(15) | DEFAULT 'settled' | 'settled'/'pending'/'info' (금액 공란 처리) |
| memo | VARCHAR(255) | NULL | 비고 |
| created_at | DATETIME | DEFAULT now | 등록 시각 |
| updated_at | DATETIME | DEFAULT now | 수정 시각 |

> **금액 공란 처리**: `선영 핸드폰-폴드7`, `채민 SKT핸드폰`처럼 지출액이 비어 있는 행은 `amount=NULL, status='info'`(참고용 등록 정보)로 구분.

### 3.5 `bank_txn_type` — 은행 거래구분 코드
은행 명세서의 `구분` 값을 코드로 관리하는 코드 테이블.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| code | VARCHAR(10) | **PK** | 거래구분 코드 |
| name | VARCHAR(30) | NOT NULL | 구분명 (타행이체, 대출이자 등) |
| direction | VARCHAR(10) | NULL | 기본 방향 힌트 ('in'/'out'/'both') |
| use_yn | CHAR(1) | DEFAULT 'Y' | 사용 여부 |

#### 시드 데이터
| code | name | direction |
|------|------|-----------|
| BT01 | 타행이체 | both |
| BT02 | 타행송금 | out |
| BT03 | 당행송금 | out |
| BT04 | 대출이자 | out |
| BT05 | 타사카드 | out |
| BT06 | 하나카드 | out |
| BT07 | 정기적금 | out |
| BT08 | 청약종합 | out |
| BT09 | 보험료 | out |
| BT10 | CMS | out |
| BT11 | 대체 | both |
| BT12 | 급여이체 | in |
| BT13 | 예금이자 | in |
| BT14 | 현금 | both |

> 괄호 상세(예: `타행송금(키움증권)`)는 코드에 포함하지 않고 `bank_transaction.counterpart_org` 등 원문으로 보존.
> `현금`은 CD/ATM 입출금, `급여이체`/`예금이자`는 입금성 거래. `예금이자` 적요의 세금 정보(소득세·지방소득세)는 `description` 원문으로 보존.

### 3.6 `bank_transaction` — 은행 거래내역 (원천 적재/staging)
은행에서 받은 명세를 **무손실 그대로 적재**하는 테이블. 분류 작업을 거쳐 `transaction`에 연결한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 원천 거래 ID |
| payment_method_id | INTEGER | FK → payment_method.id, NOT NULL | 대상 계좌 |
| txn_at | DATETIME | NOT NULL | 거래일시 |
| txn_type_code | VARCHAR(10) | FK → bank_txn_type.code, NULL | 거래구분 코드 |
| txn_type_raw | VARCHAR(50) | NULL | 구분 원문 (예: 타행송금(키움증권)) |
| counterpart_org | VARCHAR(50) | NULL | 상대 기관 (구분 괄호에서 파싱) |
| description | VARCHAR(255) | NULL | 적요 |
| withdrawal | DECIMAL(15,2) | DEFAULT 0 | 출금액 |
| deposit | DECIMAL(15,2) | DEFAULT 0 | 입금액 |
| balance | DECIMAL(15,2) | NULL | 거래 후 잔액 |
| branch | VARCHAR(50) | NULL | 거래점/채널 |
| transaction_id | INTEGER | FK → transaction.id, NULL | 분류된 가계부 거래 |
| is_classified | CHAR(1) | DEFAULT 'N' | 분류 완료 여부 ('Y'/'N') |
| exclude_reason | VARCHAR(20) | NULL | 집계 제외 사유 (card_settlement/self_transfer) |
| import_batch | VARCHAR(50) | NULL | 적재 배치(조회기간 등) 식별자 |
| created_at | DATETIME | DEFAULT now | 적재 시각 |

> **무결성 활용**: `balance`는 검증용으로 보존(직전 잔액 ± 금액 = 현재 잔액). 내부 이체나 정보성 행은 `transaction_id=NULL`로 두고 집계에서 제외.

### 3.7 `card_statement` — 카드 명세서 헤더
월별 이용대금 명세서 요약. 카드(payment_method)별·기준월별 1건.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 명세서 ID |
| payment_method_id | INTEGER | FK → payment_method.id, NOT NULL | 카드 |
| statement_ym | CHAR(7) | NOT NULL | 명세서 기준월 (예: 2026-04) |
| billing_date | DATE | NULL | 출금일/결제일 |
| settle_account_id | INTEGER | FK → payment_method.id, NULL | 카드대금 결제계좌 (예: 하나은행47307) |
| settle_account_raw | VARCHAR(50) | NULL | 결제계좌 원문 (예: 하나은행 / 56991*****7307) |
| total_amount | DECIMAL(15,2) | NULL | 합계(입금하실 금액) |
| lump_sum | DECIMAL(15,2) | DEFAULT 0 | 일시불 합계 |
| installment_amt | DECIMAL(15,2) | DEFAULT 0 | 할부 합계 |
| cash_advance | DECIMAL(15,2) | DEFAULT 0 | 단기카드대출(현금서비스) |
| card_loan | DECIMAL(15,2) | DEFAULT 0 | 장기카드대출(카드론) |
| revolving | DECIMAL(15,2) | DEFAULT 0 | 리볼빙 |
| annual_fee | DECIMAL(15,2) | DEFAULT 0 | 연회비 |
| prev_unpaid | DECIMAL(15,2) | DEFAULT 0 | 전월 미결제금액 |
| late_fee | DECIMAL(15,2) | DEFAULT 0 | 연체료 |
| total_count | INTEGER | NULL | 이용 총건수 |
| benefit_total | DECIMAL(15,2) | DEFAULT 0 | 총 혜택금액 |
| credit_from | DATE | NULL | 신용공여기간 시작 |
| credit_to | DATE | NULL | 신용공여기간 종료 |
| created_date | DATE | NULL | 명세서 작성일 |
| created_at | DATETIME | DEFAULT now | 적재 시각 |

> 유니크 권장: (`payment_method_id`, `statement_ym`).

### 3.8 `card_transaction` — 카드 이용내역 (원천 적재/staging)
명세서 `이용상세내역`을 건별로 무손실 적재. 분류 후 `transaction`에 연결.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 카드 이용내역 ID |
| statement_id | INTEGER | FK → card_statement.id, NOT NULL | 소속 명세서 |
| payment_method_id | INTEGER | FK → payment_method.id, NOT NULL | 카드 |
| card_label | VARCHAR(50) | NULL | 카드 구분 헤더 (예: #tag1카드 Navy 본인 7322) |
| txn_date | DATE | NOT NULL | 거래일자 |
| merchant_name | VARCHAR(100) | NOT NULL | 가맹점명 |
| usage_amount | DECIMAL(15,2) | NOT NULL | 이용금액 |
| principal | DECIMAL(15,2) | NOT NULL | 결제원금 (실제 청구액) |
| fee | DECIMAL(15,2) | DEFAULT 0 | 수수료 |
| installment_period | VARCHAR(10) | NULL | 할부기간/개월 (일시불 = NULL, 예: 24) |
| billing_round | VARCHAR(10) | NULL | 청구회차 (예: 14) |
| installment_total_amt | DECIMAL(15,2) | NULL | 총할부금액 (삼성카드 등) |
| benefit_type | VARCHAR(20) | NULL | 이용혜택 (할인/포인트사용/적립 등) |
| benefit_rate | DECIMAL(5,2) | NULL | 적립/할인율(%) — 현대카드 등 (예: 0.70) |
| benefit_amount | DECIMAL(15,2) | DEFAULT 0 | 혜택금액 (할인은 음수, 적립은 양수) |
| benefit_note | VARCHAR(100) | NULL | 할인내역 텍스트 (예: KT 가족만족 DC 국내이용할인) |
| region | VARCHAR(10) | NULL | 이용지역 (국내/국외) |
| sale_type | VARCHAR(20) | NULL | 적용/혜택 구분 (일시불/할부/할인/취소/기타매출) |
| is_canceled | CHAR(1) | DEFAULT 'N' | 취소 거래 여부 ('Y'=매출취소, 음수 금액) |
| balance_after | DECIMAL(15,2) | NULL | 결제후잔액/입금후잔액 |
| point_name | VARCHAR(30) | NULL | 포인트명 (예: 보너스P) |
| point | DECIMAL(15,2) | DEFAULT 0 | 적립 포인트/적립금액 |
| transaction_id | INTEGER | FK → transaction.id, NULL | 분류된 가계부 거래 |
| is_classified | CHAR(1) | DEFAULT 'N' | 분류 완료 여부 |
| created_at | DATETIME | DEFAULT now | 적재 시각 |

> **가계부 연결 시**: `amount = principal + fee`(할부 이자 포함), `description = merchant_name`, `transaction_date = txn_date`(할부는 청구월), `settled_date = card_statement.billing_date`.

### 3.9 `merchant_category_map` — 가맹점 자동 분류 규칙
가맹점명 패턴을 분류 코드에 매핑하는 **자동 입력 규칙 테이블**. 업로드 시 이 규칙으로 `category_code`를 자동 부여한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 규칙 ID |
| pattern | VARCHAR(100) | NOT NULL | 가맹점명 매칭 패턴 (부분일치/정규식) |
| match_type | VARCHAR(10) | DEFAULT 'contains' | 'contains'/'exact'/'regex' |
| category_code | VARCHAR(10) | FK → category.code, NOT NULL | 매핑 분류 코드 |
| priority | INTEGER | DEFAULT 100 | 우선순위(작을수록 우선) |
| use_yn | CHAR(1) | DEFAULT 'Y' | 사용 여부 |

#### 예시 규칙 (시드)
| pattern | category_code | 설명 |
|---------|--------------|------|
| 주유소 | 09 | 차량 |
| 카카오T \| 택시 \| 티머니 \| 캐시비 \| 이동의즐거움 | 08 | 교통 |
| 고속버스 \| 운송사업조합 \| 버스 \| 지하철 | 08 | 교통 |
| 약국 \| 의원 \| 보건소 \| 병원 \| 정형외과 | 07 | 건강 |
| 우아한형제들 \| 배민 \| 도시락 \| 국수 \| 국밥 \| 돈불 \| 칼국수 \| 피자 \| 순대국 \| 돌솥밥 \| 포차 \| 부안집 \| 맛찬방 | 0501 | 생활-월 생활비(식비) |
| 헤어 \| 미용 | 0501 | 생활-월 생활비 |
| KT통신요금 \| 통신요금 | 06 | 통신 |
| 아파트관리비 \| 관리비 | 04 | 공과금 |
| 구글페이먼트 \| 구글플레이 | 0503 | 생활-기타 |
| 마트 \| 다이소 \| GS25 \| CU \| 세븐일레븐 \| 이마트24 \| 코스트코 \| 식자재 | 0501 | 생활-월 생활비 |
| 돈까스 \| 국밥 \| 버거킹 \| 파스타 \| 짬뽕 \| 커피 \| 카페 \| 냉면 \| 제면 \| 롯데리아 \| 써브웨이 \| 맘스터치 | 0501 | 생활-월 생활비(식비) |
| 하이패스 \| 고속도로 \| 도로공사 | 08 | 교통 |
| 팬딩 | 11 | 교육 |
| 대학서적 \| 학술정보 | 11 | 교육 |

> 미매칭 가맹점은 `is_classified='N'`으로 남겨 수기 분류 후, 필요 시 규칙으로 학습·추가.

---

## 4. 원본 → 테이블 매핑

| 원본(수입) | 원본(지출) | 매핑 |
|-----------|-----------|------|
| 수입처 | — | `transaction.counterparty_id` |
| 수입 항목 | 분류 | `transaction.category_code` (category 코드 매핑) |
| — | 지출 항목 | `transaction.description` |
| 입금액 | 지출액 | `transaction.amount` |
| 일 | 일 | `transaction.transaction_date` |
| 입금일 | 지출일 | `transaction.settled_date` |
| 입금계좌 | 지출처 | `transaction.payment_method_id` |
| — | 비고 | `transaction.memo` |

---

## 5. 샘플 데이터 변환 예시

**지출 원본 1행**
`보험 / 11 / METLIFE 선영 / 109,440 / 26-01-11 / 하나은행47307`

```sql
-- 보험 분류는 코드 '03', 결제수단은 마스터에서 조회
INSERT INTO payment_method (name, method_type, issuer, identifier)
  VALUES ('하나은행47307', 'bank', '하나은행', '47307');

INSERT INTO "transaction"
  (type, category_code, payment_method_id, description, amount,
   transaction_date, settled_date, status)
VALUES
  ('expense', '03', <하나은행47307.id>, 'METLIFE 선영', 109440,
   '2026-01-11', '2026-01-11', 'settled');
```

**금액 공란 행** (`통신 / 11 / 선영 핸드폰-폴드7 ... / (공란) / 26-01-11 / 신한카드KT선영`)
```sql
INSERT INTO "transaction"
  (type, category_code, payment_method_id, description, amount,
   transaction_date, settled_date, status)
VALUES
  ('expense', '06', <신한카드KT선영.id>, '선영 핸드폰-폴드7 (25.07~, 84,590원)',
   NULL, '2026-01-11', '2026-01-11', 'info');
```

**은행 거래내역 원천 적재** (`2026-03-10 18:31:38 / CMS / METLIFE03190 / 109,440 출금`)
```sql
INSERT INTO bank_transaction
  (payment_method_id, txn_at, txn_type_code, txn_type_raw, description,
   withdrawal, deposit, balance, branch, import_batch)
VALUES
  (<하나은행47307.id>, '2026-03-10 18:31:38', 'BT10', 'CMS', 'METLIFE03190',
   109440, 0, -30445132, '합정역금융센터', '2026-03');

-- 이후 분류 작업: 보험(코드 03) 가계부 거래로 연결
UPDATE bank_transaction
   SET transaction_id = <new_tx.id>, is_classified = 'Y'
 WHERE description = 'METLIFE03190' AND txn_at = '2026-03-10 18:31:38';
```

**상대 기관 파싱 예시** (`타행송금(키움증권)`)
```text
txn_type_raw   = '타행송금(키움증권)'
txn_type_code  = 'BT02'   -- 타행송금
counterpart_org = '키움증권'
```

**카드 명세서 업로드 → 자동 입력** (`2026.03.01 / 대성석유 주유소 / 이용 74,000 / 결제원금 71,420 / 할인 -2,580`)
```sql
-- 1) 명세서 헤더 적재
INSERT INTO card_statement
  (payment_method_id, statement_ym, billing_date, total_amount,
   lump_sum, total_count, benefit_total, created_date)
VALUES
  (<하나카드Tag.id>, '2026-04', '2026-04-13', 1298219,
   1298219, 77, -20317, '2026-04-01');

-- 2) 이용내역 건별 적재
INSERT INTO card_transaction
  (statement_id, payment_method_id, card_label, txn_date, merchant_name,
   usage_amount, principal, benefit_type, benefit_amount, region, sale_type)
VALUES
  (<stmt.id>, <하나카드Tag.id>, '#tag1카드 Navy 본인 7322', '2026-03-01',
   '대성석유(주)김포한강신도시주유소', 74000, 71420, '할인', -2580, '국내', '일시불');

-- 3) 가맹점 자동 분류 ('주유소' → 차량 09) 후 가계부 거래 생성·연결
INSERT INTO "transaction"
  (type, category_code, payment_method_id, description, amount,
   transaction_date, settled_date, status)
VALUES
  ('expense', '09', <하나카드Tag.id>, '대성석유(주)김포한강신도시주유소',
   71420, '2026-03-01', '2026-04-13', 'settled');

UPDATE card_transaction
   SET transaction_id = <new_tx.id>, is_classified = 'Y'
 WHERE id = <ct.id>;
```

---

## 6. DDL (SQLite/MySQL 호환)

```sql
CREATE TABLE payment_method (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        VARCHAR(50) NOT NULL UNIQUE,
    method_type VARCHAR(10) NOT NULL CHECK (method_type IN ('bank','card')),
    issuer      VARCHAR(50),
    identifier  VARCHAR(50),
    account_no  VARCHAR(30),
    owner       VARCHAR(30),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE category (
    code        VARCHAR(10) PRIMARY KEY,
    parent_code VARCHAR(10) REFERENCES category(code),
    name        VARCHAR(50) NOT NULL,
    type        VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
    depth       INTEGER NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    use_yn      CHAR(1) DEFAULT 'Y' CHECK (use_yn IN ('Y','N'))
);

-- 지출 분류 코드 시드 데이터
INSERT INTO category (code, parent_code, name, type, depth, sort_order) VALUES
  ('01', NULL, '대출',   'expense', 1,  1),
  ('02', NULL, '투자',   'expense', 1,  2),
  ('03', NULL, '보험',   'expense', 1,  3),
  ('04', NULL, '공과금', 'expense', 1,  4),
  ('05', NULL, '생활',   'expense', 1,  5),
  ('0501', '05', '월 생활비', 'expense', 2, 1),
  ('0502', '05', 'ATM 출금',  'expense', 2, 2),
  ('0503', '05', '기타',      'expense', 2, 3),
  ('06', NULL, '통신',   'expense', 1,  6),
  ('07', NULL, '건강',   'expense', 1,  7),
  ('08', NULL, '교통',   'expense', 1,  8),
  ('09', NULL, '차량',   'expense', 1,  9),
  ('10', NULL, '경조사', 'expense', 1, 10),
  ('11', NULL, '교육',   'expense', 1, 11),
  ('12', NULL, '여가',   'expense', 1, 12);

CREATE TABLE counterparty (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  VARCHAR(100) NOT NULL UNIQUE,
    type  VARCHAR(20)
);

CREATE TABLE "transaction" (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    type              VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
    category_code     VARCHAR(10) NOT NULL REFERENCES category(code),
    counterparty_id   INTEGER REFERENCES counterparty(id),
    payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
    description       VARCHAR(255),
    amount            DECIMAL(15,2),
    transaction_date  DATE NOT NULL,
    settled_date      DATE,
    status            VARCHAR(15) DEFAULT 'settled'
                        CHECK (status IN ('settled','pending','info')),
    memo              VARCHAR(255),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tx_date     ON "transaction"(transaction_date);
CREATE INDEX idx_tx_type     ON "transaction"(type);
CREATE INDEX idx_tx_category ON "transaction"(category_code);
CREATE INDEX idx_tx_pm       ON "transaction"(payment_method_id);

-- 은행 거래구분 코드
CREATE TABLE bank_txn_type (
    code      VARCHAR(10) PRIMARY KEY,
    name      VARCHAR(30) NOT NULL,
    direction VARCHAR(10) CHECK (direction IN ('in','out','both')),
    use_yn    CHAR(1) DEFAULT 'Y' CHECK (use_yn IN ('Y','N'))
);

INSERT INTO bank_txn_type (code, name, direction) VALUES
  ('BT01', '타행이체', 'both'),
  ('BT02', '타행송금', 'out'),
  ('BT03', '당행송금', 'out'),
  ('BT04', '대출이자', 'out'),
  ('BT05', '타사카드', 'out'),
  ('BT06', '하나카드', 'out'),
  ('BT07', '정기적금', 'out'),
  ('BT08', '청약종합', 'out'),
  ('BT09', '보험료',   'out'),
  ('BT10', 'CMS',     'out'),
  ('BT11', '대체',     'both'),
  ('BT12', '급여이체', 'in'),
  ('BT13', '예금이자', 'in'),
  ('BT14', '현금',     'both');

-- 은행 거래내역 원천 적재(staging)
CREATE TABLE bank_transaction (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
    txn_at            DATETIME NOT NULL,
    txn_type_code     VARCHAR(10) REFERENCES bank_txn_type(code),
    txn_type_raw      VARCHAR(50),
    counterpart_org   VARCHAR(50),
    description       VARCHAR(255),
    withdrawal        DECIMAL(15,2) DEFAULT 0,
    deposit           DECIMAL(15,2) DEFAULT 0,
    balance           DECIMAL(15,2),
    branch            VARCHAR(50),
    transaction_id    INTEGER REFERENCES "transaction"(id),
    is_classified     CHAR(1) DEFAULT 'N' CHECK (is_classified IN ('Y','N')),
    exclude_reason    VARCHAR(20)
                        CHECK (exclude_reason IN ('card_settlement','self_transfer')),
    import_batch      VARCHAR(50),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bt_account  ON bank_transaction(payment_method_id);
CREATE INDEX idx_bt_at       ON bank_transaction(txn_at);
CREATE INDEX idx_bt_class    ON bank_transaction(is_classified);
CREATE INDEX idx_bt_tx       ON bank_transaction(transaction_id);

-- 카드 명세서 헤더
CREATE TABLE card_statement (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
    statement_ym      CHAR(7) NOT NULL,
    billing_date      DATE,
    settle_account_id INTEGER REFERENCES payment_method(id),
    settle_account_raw VARCHAR(50),
    total_amount      DECIMAL(15,2),
    lump_sum          DECIMAL(15,2) DEFAULT 0,
    installment_amt   DECIMAL(15,2) DEFAULT 0,
    cash_advance      DECIMAL(15,2) DEFAULT 0,
    card_loan         DECIMAL(15,2) DEFAULT 0,
    revolving         DECIMAL(15,2) DEFAULT 0,
    annual_fee        DECIMAL(15,2) DEFAULT 0,
    prev_unpaid       DECIMAL(15,2) DEFAULT 0,
    late_fee          DECIMAL(15,2) DEFAULT 0,
    total_count       INTEGER,
    benefit_total     DECIMAL(15,2) DEFAULT 0,
    credit_from       DATE,
    credit_to         DATE,
    created_date      DATE,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (payment_method_id, statement_ym)
);

-- 카드 이용내역 원천 적재(staging)
CREATE TABLE card_transaction (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id       INTEGER NOT NULL REFERENCES card_statement(id),
    payment_method_id  INTEGER NOT NULL REFERENCES payment_method(id),
    card_label         VARCHAR(50),
    txn_date           DATE NOT NULL,
    merchant_name      VARCHAR(100) NOT NULL,
    usage_amount       DECIMAL(15,2) NOT NULL,
    principal          DECIMAL(15,2) NOT NULL,
    fee                DECIMAL(15,2) DEFAULT 0,
    installment_period VARCHAR(10),
    billing_round      VARCHAR(10),
    installment_total_amt DECIMAL(15,2),
    benefit_type       VARCHAR(20),
    benefit_rate       DECIMAL(5,2),
    benefit_amount     DECIMAL(15,2) DEFAULT 0,
    benefit_note       VARCHAR(100),
    region             VARCHAR(10),
    sale_type          VARCHAR(20),
    is_canceled        CHAR(1) DEFAULT 'N' CHECK (is_canceled IN ('Y','N')),
    balance_after      DECIMAL(15,2),
    point_name         VARCHAR(30),
    point              DECIMAL(15,2) DEFAULT 0,
    transaction_id     INTEGER REFERENCES "transaction"(id),
    is_classified      CHAR(1) DEFAULT 'N' CHECK (is_classified IN ('Y','N')),
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ct_statement ON card_transaction(statement_id);
CREATE INDEX idx_ct_card      ON card_transaction(payment_method_id);
CREATE INDEX idx_ct_date      ON card_transaction(txn_date);
CREATE INDEX idx_ct_class     ON card_transaction(is_classified);
CREATE INDEX idx_ct_tx        ON card_transaction(transaction_id);

-- 가맹점 자동 분류 규칙
CREATE TABLE merchant_category_map (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern       VARCHAR(100) NOT NULL,
    match_type    VARCHAR(10) DEFAULT 'contains'
                    CHECK (match_type IN ('contains','exact','regex')),
    category_code VARCHAR(10) NOT NULL REFERENCES category(code),
    priority      INTEGER DEFAULT 100,
    use_yn        CHAR(1) DEFAULT 'Y' CHECK (use_yn IN ('Y','N'))
);

CREATE INDEX idx_mcm_priority ON merchant_category_map(priority);
```

---

## 7. 설계 시 고려사항 / 확인 필요 사항

- **연·월 처리**: 원본 `일`은 day만 존재 → 월별 시트 탭에서 연·월 보완 필요. 입력 시 `transaction_date`에 연·월을 채워야 함.
- **금액 공란 행**: 참고용 정보 행으로 판단 → `amount=NULL, status='info'`. 실제 집계(합계)에서는 제외.
- **할부 정보**: `지출 항목`에 `(할부12/24)`, `(할부1/3)` 등 할부 회차가 텍스트로 포함. 향후 `installment_total`/`installment_current` 컬럼 분리 고려.
- **결제수단 파싱**: `신한카드KT본인`, `삼성카드T` 등 표기 규칙이 다양 → issuer/identifier/owner 분해 규칙 정의 필요(우선 `name` 원문 보존).
- **명의자(가족) 관리**: 본인/선영/채민/채성 등 가족 구성원이 항목·카드에 반복 등장 → 향후 `member` 테이블 분리 검토.
- **고정 지출 식별**: 보험·대출·적금처럼 매월 반복되는 지출 → `is_recurring` 플래그 또는 반복 거래 테이블 확장 고려.

### 7.1 은행 원천 ↔ 가계부 거래 대사(reconciliation)
- **적재 우선**: 은행 명세는 `bank_transaction`에 무손실 적재 후, 분류 작업으로 `transaction` 생성·연결(`transaction_id`).
- **자동 분류 힌트**: `txn_type_code` + `description` 패턴으로 카테고리 추천 가능 (예: `보험료`/`CMS`+`METLIFE` → 보험 03, `정기적금`/`청약종합`/`타행송금(키움증권)` → 투자 02, `대출이자` → 대출 01).
- **자산 이동성 거래도 지출로 처리(확정 정책)**: 키움투자·정기적금·청약종합 등 자산 이동성 출금은 **별도 자산 이동으로 빼지 않고 '지출'(`type='expense'`)로 분류**한다. 분류 코드는 성격에 맞게 `투자(02)` 등으로 부여하며, 월 지출 집계에 그대로 **포함**한다.
- **잔액 검증**: 적재 시 `직전 balance ± (deposit−withdrawal) = 현재 balance` 로 누락/중복 검출. 단, `balance`가 `-`(NULL)인 행은 검증에서 제외.
- **중복 적재 방지**: (계좌, 거래일시, 출금액, 입금액, 잔액) 조합으로 유니크 제약 또는 사전 체크 권장.
- **자기 계좌 간 이체 처리**: 보유 계좌 간 이체(예: `62707`의 `당행송금(ㅅ) 8,837,922 출금` ↔ `47307`의 `대체(ㅅ) 8,837,922 입금`)는 가계부상 실지출이 아니므로 **양쪽을 한 쌍으로 인식해 지출 집계에서 제외**한다. 같은 날짜·동일 금액·반대 방향·본인 명의 계좌 조건으로 자동 매칭하고, `transaction`에는 미연결 + `exclude_reason='self_transfer'`로 둔다. (자산 이동성 '지출' 정책은 외부 투자·저축에 적용되며, 본인 계좌 간 단순 이동은 여기서 분리.)

### 7.2 카드 명세서 자동 입력 흐름
- **적재 단위**: 업로드 1회 = `card_statement` 1건 + `card_transaction` N건. 명세서 합계(`total_amount`)와 건별 `principal` 합이 일치하는지 검증.
- **자동 분류**: `merchant_category_map`을 `priority` 순으로 적용해 `category_code` 부여 → 매칭 시 `transaction` 자동 생성·연결. 미매칭은 `is_classified='N'`으로 남겨 수기 처리 후 규칙 보강.
- **금액 기준 (확정)**: 가계부 지출 금액 = `principal + fee`(할인 반영 실청구 원금 + 할부 이자). 일시불은 `fee=0`이라 `principal`과 동일, 할부는 이자까지 포함(1.8 확정 정책). `usage_amount`/`benefit_amount`는 분석·혜택 통계용으로 보존.
- **카드대금 출금 제외 (확정)**: 은행 명세의 `타사카드`/`하나카드` 구분 출금(= 카드대금 결제)은 **카드 건별 지출과 중복**이므로 **지출 집계에서 제외**한다. 해당 `bank_transaction` 행은 `transaction`에 연결하지 않고(`transaction_id=NULL`), `exclude_reason='card_settlement'`로 표시해 실지출은 오직 `card_transaction`(카드 건별)으로만 잡는다. **자동 식별**: `card_statement.settle_account_id` + `billing_date` + `total_amount`로 은행 명세의 카드대금 출금 행과 매칭(예: 신한카드 명세 결제계좌 `하나은행47307` → 은행 `타사카드(신한카드)` 출금 제외).
- **할부 거래 (확정: 청구 회차별 월 집계)**: 할부는 **최초 거래월에 총액을 잡지 않고, 매 청구 회차에 해당 월의 청구액만 지출로 집계**한다. 즉 카드 명세서에 그 달 청구된 회차 금액(`principal`)이 곧 그 달의 지출이며, `transaction.transaction_date`는 청구 시점(명세서 월) 기준으로 생성한다. `installment_period`(예: 12/24 → 총 24회)와 `billing_round`(예: 12 → 12회차)는 회차 추적용으로 보존한다.

> 향후 다른 시트(예: 자산 현황)도 공유해 주시면 통합 모델에 반영하겠습니다.

---

## 8. 월별 요약 통계 테이블

월별 대시보드용 **집계(aggregate) 테이블**. 거래 적재/분류가 끝난 뒤 월 단위로 재집계하여 채운다. 요청 차원(지출 분류·수입처·카드별·은행별)을 **전체 요약 1 + 차원별 3** 테이블로 커버한다.

### 8.0 설계 방식
- **저장형 집계 테이블 채택**: 대시보드 조회 성능을 위해 `transaction`을 미리 합산해 저장. (대안: SQL VIEW = 항상 최신이나 매 조회 시 집계 → 데이터 많아지면 느림.)
- **갱신 시점**: 업로드·분류 후 해당 월(`ym`)을 **삭제 후 재삽입(rebuild)**. 배치 또는 트리거로 수행.
- **집계 대상(필터)**: `transaction` 중 `amount IS NOT NULL AND status='settled'`만 합산. 정보성 행(`status='info'`)·자기이체·카드대금(`bank_transaction.exclude_reason`)은 애초 `transaction`에 미연결이라 자동 제외.
- **기준월(`ym`)**: 카드 할부는 청구월, 그 외는 `transaction_date`의 `YYYY-MM`.

### 8.1 `monthly_summary` — 월 전체 요약
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| ym | CHAR(7) | **PK** | 기준월 (예: 2026-03) |
| income_total | DECIMAL(15,2) | DEFAULT 0 | 총수입 |
| expense_total | DECIMAL(15,2) | DEFAULT 0 | 총지출 |
| net_amount | DECIMAL(15,2) | DEFAULT 0 | 순액 (수입−지출) |
| income_count | INTEGER | DEFAULT 0 | 수입 건수 |
| expense_count | INTEGER | DEFAULT 0 | 지출 건수 |
| transfer_excluded | DECIMAL(15,2) | DEFAULT 0 | 집계 제외 자기이체 합 (참고) |
| card_settle_excluded | DECIMAL(15,2) | DEFAULT 0 | 집계 제외 카드대금 합 (참고) |
| updated_at | DATETIME | DEFAULT now | 재집계 시각 |

### 8.2 `monthly_category_stat` — 월 × 분류(지출/수입)
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| ym | CHAR(7) | PK(복합) | 기준월 |
| category_code | VARCHAR(10) | PK(복합), FK → category.code | 분류 코드 |
| type | VARCHAR(10) | NOT NULL | income / expense |
| amount_total | DECIMAL(15,2) | DEFAULT 0 | 분류별 합계 |
| tx_count | INTEGER | DEFAULT 0 | 건수 |
| ratio | DECIMAL(5,2) | NULL | 해당 월 동일 type 내 비중(%) |

> 대분류만 보고 싶으면 `category.parent_code`로 롤업, 소분류(예: 0501)까지 보고 싶으면 그대로 사용.

### 8.3 `monthly_source_stat` — 월 × 수입처
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| ym | CHAR(7) | PK(복합) | 기준월 |
| counterparty_id | INTEGER | PK(복합), FK → counterparty.id | 수입처 |
| amount_total | DECIMAL(15,2) | DEFAULT 0 | 수입처별 입금 합계 |
| tx_count | INTEGER | DEFAULT 0 | 건수 |

### 8.4 `monthly_payment_stat` — 월 × 결제수단 (카드별·은행별 공통)
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| ym | CHAR(7) | PK(복합) | 기준월 |
| payment_method_id | INTEGER | PK(복합), FK → payment_method.id | 결제수단 |
| method_type | VARCHAR(10) | NOT NULL | bank / card (카드별/은행별 필터) |
| income_total | DECIMAL(15,2) | DEFAULT 0 | 입금 합계 (은행 계좌) |
| expense_total | DECIMAL(15,2) | DEFAULT 0 | 지출 합계 (카드·계좌) |
| tx_count | INTEGER | DEFAULT 0 | 건수 |

> `method_type='card'`로 필터 = **카드별 요약**, `='bank'`로 필터 = **은행별 요약**. 한 테이블로 두 차원 모두 제공.

### 8.5 재집계 SQL (월 rebuild 예시, `:ym` 파라미터)
```sql
-- 1) 전체 요약
DELETE FROM monthly_summary WHERE ym = :ym;
INSERT INTO monthly_summary (ym, income_total, expense_total, net_amount,
                             income_count, expense_count)
SELECT :ym,
       COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0),
       COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0),
       COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0)
         - COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0),
       SUM(CASE WHEN type='income'  THEN 1 ELSE 0 END),
       SUM(CASE WHEN type='expense' THEN 1 ELSE 0 END)
FROM "transaction"
WHERE amount IS NOT NULL AND status='settled'
  AND strftime('%Y-%m', transaction_date) = :ym;

-- 2) 분류별
DELETE FROM monthly_category_stat WHERE ym = :ym;
INSERT INTO monthly_category_stat (ym, category_code, type, amount_total, tx_count)
SELECT :ym, category_code, type, SUM(amount), COUNT(*)
FROM "transaction"
WHERE amount IS NOT NULL AND status='settled'
  AND strftime('%Y-%m', transaction_date) = :ym
GROUP BY category_code, type;

-- 3) 수입처별
DELETE FROM monthly_source_stat WHERE ym = :ym;
INSERT INTO monthly_source_stat (ym, counterparty_id, amount_total, tx_count)
SELECT :ym, counterparty_id, SUM(amount), COUNT(*)
FROM "transaction"
WHERE amount IS NOT NULL AND status='settled' AND type='income'
  AND counterparty_id IS NOT NULL
  AND strftime('%Y-%m', transaction_date) = :ym
GROUP BY counterparty_id;

-- 4) 결제수단별 (카드/은행)
DELETE FROM monthly_payment_stat WHERE ym = :ym;
INSERT INTO monthly_payment_stat (ym, payment_method_id, method_type,
                                  income_total, expense_total, tx_count)
SELECT :ym, t.payment_method_id, pm.method_type,
       COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount END),0),
       COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END),0),
       COUNT(*)
FROM "transaction" t
JOIN payment_method pm ON pm.id = t.payment_method_id
WHERE t.amount IS NOT NULL AND t.status='settled'
  AND strftime('%Y-%m', t.transaction_date) = :ym
GROUP BY t.payment_method_id, pm.method_type;

-- 5) 분류별 비중(ratio) 갱신
UPDATE monthly_category_stat
   SET ratio = ROUND(100.0 * amount_total /
        NULLIF((SELECT SUM(amount_total) FROM monthly_category_stat m2
                 WHERE m2.ym = monthly_category_stat.ym
                   AND m2.type = monthly_category_stat.type), 0), 2)
 WHERE ym = :ym;
```

### 8.6 DDL
```sql
CREATE TABLE monthly_summary (
    ym                   CHAR(7) PRIMARY KEY,
    income_total         DECIMAL(15,2) DEFAULT 0,
    expense_total        DECIMAL(15,2) DEFAULT 0,
    net_amount           DECIMAL(15,2) DEFAULT 0,
    income_count         INTEGER DEFAULT 0,
    expense_count        INTEGER DEFAULT 0,
    transfer_excluded    DECIMAL(15,2) DEFAULT 0,
    card_settle_excluded DECIMAL(15,2) DEFAULT 0,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE monthly_category_stat (
    ym            CHAR(7) NOT NULL,
    category_code VARCHAR(10) NOT NULL REFERENCES category(code),
    type          VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
    amount_total  DECIMAL(15,2) DEFAULT 0,
    tx_count      INTEGER DEFAULT 0,
    ratio         DECIMAL(5,2),
    PRIMARY KEY (ym, category_code)
);

CREATE TABLE monthly_source_stat (
    ym              CHAR(7) NOT NULL,
    counterparty_id INTEGER NOT NULL REFERENCES counterparty(id),
    amount_total    DECIMAL(15,2) DEFAULT 0,
    tx_count        INTEGER DEFAULT 0,
    PRIMARY KEY (ym, counterparty_id)
);

CREATE TABLE monthly_payment_stat (
    ym                CHAR(7) NOT NULL,
    payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
    method_type       VARCHAR(10) NOT NULL CHECK (method_type IN ('bank','card')),
    income_total      DECIMAL(15,2) DEFAULT 0,
    expense_total     DECIMAL(15,2) DEFAULT 0,
    tx_count          INTEGER DEFAULT 0,
    PRIMARY KEY (ym, payment_method_id)
);
```

### 8.7 대시보드 조회 예시
```sql
-- 이번 달 분류별 지출 TOP (대분류 롤업)
SELECT COALESCE(c.parent_code, c.code) AS 대분류,
       SUM(s.amount_total) AS 지출합, SUM(s.tx_count) AS 건수
FROM monthly_category_stat s
JOIN category c ON c.code = s.category_code
WHERE s.ym = '2026-03' AND s.type = 'expense'
GROUP BY COALESCE(c.parent_code, c.code)
ORDER BY 지출합 DESC;

-- 카드별 이번 달 지출
SELECT pm.name AS 카드, p.expense_total
FROM monthly_payment_stat p
JOIN payment_method pm ON pm.id = p.payment_method_id
WHERE p.ym = '2026-03' AND p.method_type = 'card'
ORDER BY p.expense_total DESC;

-- 최근 6개월 수입·지출 추이
SELECT ym, income_total, expense_total, net_amount
FROM monthly_summary
ORDER BY ym DESC LIMIT 6;
```
