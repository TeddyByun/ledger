# 검토 · 확정 워크플로 설계서 (Pending Review & Rule Learning)

> 자동입력 파이프라인의 마지막 조각. 자동분류 실패(pending) 건을 사용자가 **확정**하고, 그 결과를 **규칙으로 학습**해 다음 업로드 정확도를 높인다.
> 연동: [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §7(검토 UI) · [ARCHITECTURE.md](ARCHITECTURE.md) §5(파이프라인 ⑦ Review)

---

## 1. 개요 (Human-in-the-loop)

```
업로드 → 자동분류 → [pending 발생] → 검토 화면 → 확정
                                          │
                          ┌───────────────┼────────────────┐
                          ▼               ▼                ▼
                    분류 확정         제외 처리          규칙 학습
                 (거래 생성·연결)  (이체/카드대금/정보)  (다음부터 자동)
                          └───────────────┴────────────────┘
                                          ▼
                                  영향 월 재집계(rebuild)
```

- **pending 정의**: 자동분류에서 카테고리를 못 정한 staging 행.
  - 은행: `bank_transaction` 중 `transactionId=NULL AND excludeReason=NULL`
  - 카드: `card_transaction` 중 `transactionId=NULL AND isCanceled='N' AND principal+fee>0`
- 확정 주체: 가구 member 이상(AUTH_DESIGN RBAC), household 스코프.

---

## 2. 확정 액션 (Action 종류)

| action | 의미 | 결과 |
|--------|------|------|
| `classify` | 분류 확정 | `transaction` 생성 + staging 연결(`transactionId`, `isClassified='Y'`) |
| `exclude` | 지출 아님 | 은행: `excludeReason` 설정(`self_transfer`/`card_settlement`), 카드: `status=info` 취급(미연결) |
| `info` | 참고성(금액 0/정보 행) | 거래 미생성, `isClassified='Y'`로 검토 완료 표시 |
| `split` *(후순위)* | 한 건을 여러 분류로 분할 | 원거래를 n개 거래로 분할 생성 |

- 금액/날짜 규칙은 파이프라인과 동일: 카드 `amount=principal+fee`, 할부=청구월, 은행=출금/입금액.

---

## 3. 분류 추천 (Suggestion Engine)

검토 화면(§7 ✨)에 채울 추천값. pending은 규칙 미스이므로 **이력 기반**으로 보강한다.

우선순위:
1. **가맹점 규칙**(`merchant_category_map`) — 이미 미스(참고용).
2. **이력 최빈값** — 같은 가구에서 동일/유사 가맹점명의 과거 `transaction.categoryCode` 최빈값.
3. **발급사 힌트** — 은행 `txnType`(보험료→03 등, DATABASE.md §7.1).

`GET /imports/{jobId}/pending` 응답에 각 행의 `suggestedCategoryCode`(+`source`: rule|history|hint|null) 포함.

---

## 4. API 설계

### 4.1 검토 목록 (확장)
```
GET /imports/{jobId}/pending
→ {
    bank: [{ id, txnAt, description, withdrawal, deposit,
             suggestedCategoryCode, suggestionSource }],
    card: [{ id, txnDate, merchantName, principal, fee, installmentPeriod,
             suggestedCategoryCode, suggestionSource }]
  }
```

### 4.2 일괄 확정
```
PATCH /imports/{jobId}/classify
body: {
  items: [
    { source: 'card', id: 123, action: 'classify', categoryCode: '0501',
      learn: { enabled: true, pattern: 'GS25', matchType: 'contains' } },
    { source: 'bank', id: 45, action: 'exclude', excludeReason: 'self_transfer' },
    { source: 'card', id: 130, action: 'info' }
  ]
}
→ { classified: 8, excluded: 1, info: 1, rulesLearned: 3, rebuiltMonths: ['2026-03'] }
```
- 트랜잭션(원자적) 처리: 항목별 staging 갱신 + 거래 생성 → 성공분만 커밋.
- `learn.enabled` 시 규칙 upsert(§5). 확정 후 **영향 월 집합 rebuild**.

### 4.3 규칙 직접 관리 (독립 사용도 가능)
```
POST   /merchant-rules   { pattern, matchType, categoryCode, priority? }
GET    /merchant-rules
PATCH  /merchant-rules/{id}
DELETE /merchant-rules/{id}
```
- 생성/변경 시 **ClassifierService 캐시 invalidate**.

---

## 5. 규칙 학습 (Rule Learning / 피드백 루프)

확정 시 사용자가 "이 가맹점은 앞으로 이 분류로" 체크하면 규칙을 추가한다.

- **패턴 제안**: 가맹점명에서 지점/부가 접미사 제거한 핵심 토큰을 기본 제시.
  예: `GS25 군자점` → `GS25`, `산들푸드_나이스정보통신` → `산들푸드`.
- **중복 방지**: 동일 (pattern, categoryCode) 존재 시 upsert(무시).
- **우선순위**: 학습 규칙은 기본 priority(예: 60) — 시드 일반 규칙과 상충 시 조정 가능.
- **즉시 반영**: 규칙 추가 후 같은 배치의 남은 pending에 **재분류 1회 적용** 옵션 → 연쇄 확정 편의.
- **안전장치**: 과도 일반화 방지(너무 짧은 pattern 경고), 규칙은 언제든 설정에서 수정/삭제.

---

## 6. 서비스 로직 (NestJS)

```
ReviewService (IngestionModule 내)
 ├─ getPending(jobId)         : staging 조회 + SuggestionService 로 추천 부여
 ├─ classifyBatch(jobId, dto) : 항목별 action 처리(트랜잭션) → rebuild
 ├─ SuggestionService         : rule→history→hint 순 추천
 └─ MerchantRuleService       : 규칙 CRUD + classifier 캐시 무효화
```
- `classifyBatch` 내부는 파이프라인의 거래 생성 로직 재사용(공통 헬퍼로 추출).
- 권한: `@Roles('owner','member')`, household 스코프 가드.

---

## 7. 상태 전이

```
ImportJob.status:  review ──(모든 pending 처리)──▶ completed
staging row:       pending ──classify──▶ linked(transactionId)
                           ──exclude───▶ excluded(excludeReason)
                           ──info──────▶ reviewed(무연결)
```
- 잡의 `pendingRows` 카운트가 0이 되면 `status=completed`로 자동 전환.

---

## 8. 엣지 케이스

- **부분 확정**: 일부만 확정하고 나가도 됨 → 잡은 계속 `review`, 남은 건 재방문.
- **오분류 정정**: 이미 생성된 거래는 `PATCH /transactions/{id}`로 분류 변경(기존 API).
- **되돌리기**: 확정 취소 시 거래 삭제 + staging `transactionId=NULL` 복원(선택 기능).
- **분할(split)**: 한 결제를 항목별로 나눠 담기 — 후순위.
- **동시성**: 같은 잡을 두 사용자가 검토 → 행 단위 낙관적 잠금(이미 처리된 행은 skip).

---

## 9. 스키마 영향

- **신규 테이블 없음** — 기존 `bank_transaction`/`card_transaction`/`merchant_category_map`/`transaction` 활용.
- (선택) `merchant_category_map`에 `source`(seed|learned)·`createdBy`·`householdId` 추가 시 가구별 규칙/학습 이력 관리 가능.

---

## 10. 확정 필요 사항
1. **학습 규칙 범위**: 전역 공유 vs **가구별**(권장, householdId 부여) — 가족마다 소비 패턴 다름
2. 확정 취소(undo) 기능 포함 여부(초기 범위)
3. 분할(split) 지원 시점(초기 제외 권장)
