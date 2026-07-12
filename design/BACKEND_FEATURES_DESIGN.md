# 백엔드 부가기능 설계서 (감사 로그 · 데이터 내보내기)

> 백로그 백엔드 남은 2항목(둘 다 🟢). 핵심 도메인은 완성됐고, 운영·신뢰성 보강 기능이다.
> 연동: [AUTH_DESIGN.md](AUTH_DESIGN.md) §4·§8(스코프·감사) · [API_CONVENTIONS_DESIGN.md](API_CONVENTIONS_DESIGN.md)(에러·잡·페이지네이션) · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §4(로그 구분)

---

## 1. 감사 로그 (Audit Log)

"누가·언제·무엇을·어떻게 바꿨나"를 남긴다. **운영 로그(§INFRA_OPS §4, 관측용·휘발성)와 다르다** — 감사 로그는 **업무 이벤트의 영속 기록**이다.

### 1.1 대상 이벤트

| 도메인 | 이벤트 |
|--------|--------|
| 거래 | 생성·수정·삭제, 분류 변경, 확정(pending→settled) |
| 업로드/적재 | 명세서 업로드, 잡 실패, 되돌리기(undo) |
| 규칙 | merchant-rule 생성/수정/삭제(학습 포함) |
| 예산/반복 | budget·recurring_rule 생성/수정/삭제 |
| 인증/가구(AUTH §8) | 로그인·로그아웃, 비밀번호 변경, 가구원 초대·역할 변경, 가구 삭제 |
| 마스터 | payment_method·counterparty·category 변경 |

> **조회(read)는 기록하지 않는다**(양·프라이버시). 열람 추적이 필요한 민감 리소스만 선택적.

### 1.2 모델

```prisma
model AuditLog {
  id          BigInt   @id @default(autoincrement())
  householdId Int      @map("household_id")               // 테넌시 스코프(AUTH §3.2)
  actorUserId Int?     @map("actor_user_id")              // 수행 사용자(시스템 배치는 NULL)
  action      String                                       // 예: transaction.update, budget.delete
  entityType  String   @map("entity_type")                // transaction / budget / membership ...
  entityId    String?  @map("entity_id")                  // 대상 PK(문자열화)
  summary     String?                                      // 사람용 한 줄("금액 5,800→6,300")
  before      Json?                                        // 변경 전 스냅샷(민감정보 마스킹)
  after       Json?                                        // 변경 후 스냅샷
  ip          String?                                       // 요청 IP
  userAgent   String?  @map("user_agent")
  traceId     String?  @map("trace_id")                   // 운영 로그와 상관(INFRA_OPS §4)
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([householdId, createdAt])
  @@index([entityType, entityId])
  @@map("audit_log")
}
```

- **불변(append-only)**: UPDATE/DELETE 금지(앱 레벨 + 권한). 정정도 새 레코드로.
- **diff 저장**: `before`/`after`는 **변경 필드만**(전체 아님) — 저장량·가독성. 민감필드(계좌·카드번호)는 마스킹 후 저장.
- **BigInt PK**: 대량 증가 대비.

### 1.3 기록 방식 (NestJS)

- **인터셉터/데코레이터**: `@Audit('transaction.update')` + `AuditInterceptor`가 성공 응답 시 자동 기록(요청 컨텍스트의 `userId`·`householdId`·`traceId`·IP 주입).
- **서비스 명시 기록**: diff가 필요한 변경(수정 전후 비교)은 서비스에서 `AuditService.record({...})` 명시 호출(트랜잭션 내 동일 커밋).
- **비동기 옵션**: 고빈도 경로는 감사 기록을 큐(BullMQ)로 오프로딩 가능(핵심 업무 트랜잭션과 분리). 단, 금전/권한 변경은 동기 기록 권장(유실 방지).

### 1.4 조회 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|:----:|
| GET | `/audit-logs?entityType=&entityId=&action=&from=&to=&actorUserId=` | 감사 로그 조회(커서 페이지네이션) | **owner** |

- 스코프: 요청자 가구로 자동 필터(AUTH §4.1). 열람은 **owner 한정**(민감).
- 페이지네이션·정렬: API_CONVENTIONS §3(커서, `createdAt:desc`).
- 리소스 상세 화면의 "변경 이력" 탭에서 `entityType+entityId`로 타임라인 표시.

### 1.5 보존 정책

- 기본 보존 기간(예: 1년) 후 아카이브/파기 정책(운영 규모에 따라 확정). 인증·권한 변경 등 보안 이벤트는 장기 보존.

---

## 2. 데이터 내보내기 (CSV / Excel Export)

사용자가 자신의 가구 데이터를 표 형식으로 내려받는다(백업·세무·분석).

### 2.1 대상 · 포맷

| 대상 | 내용 | 포맷 |
|------|------|------|
| 거래(transactions) | 필터 조건과 동일(기간·분류·결제수단·구성원) | CSV / XLSX |
| 월 집계(statistics) | monthly_summary/category/payment(§DATABASE §8) | CSV / XLSX |
| 원천(선택) | bank_transaction·card_transaction 원본 | CSV |

- **CSV**: UTF-8 **BOM 포함**(Excel 한글 깨짐 방지). 구분자 `,`, RFC4180 escaping.
- **XLSX**: 시트 분리(거래/요약), 헤더 스타일·숫자서식(₩), 금액은 숫자형(문자 아님).
- **컬럼**: 한글 헤더(일자·분류·내용·금액·결제수단·구성원·메모), 코드가 아닌 **표시명**으로 조인.

### 2.2 동기 vs 비동기

| 규모 | 처리 |
|------|------|
| 소량(예: ≤5,000행) | **동기 스트리밍 다운로드**(`Content-Disposition: attachment`) — 즉시 응답 |
| 대량 | **비동기 잡**(BullMQ) → 파일 생성·스토리지 저장 → 완료 시 서명 URL. 잡 상태는 import와 동일 통지 규약(API_CONVENTIONS §4) 재사용 |

- 스트리밍: 메모리 폭주 방지 위해 커서 기반으로 청크 write(대량은 비동기로 유도).

### 2.3 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/exports/transactions?format=csv\|xlsx&from=&to=&categoryCode=&paymentMethodId=&memberId=` | 거래 내보내기(소량=즉시 다운로드) |
| GET | `/exports/statistics?format=&ym=` | 월 집계 내보내기 |
| POST | `/exports` `{ target, format, filters }` | **비동기 대량** 요청 → `{ exportJobId }` |
| GET | `/exports/{exportJobId}` | 잡 상태·완료 시 다운로드 URL |

- 필터 파라미터·에러는 조회 API와 동일 규약(API_CONVENTIONS §3). 형식 오류 → `VALIDATION_FAILED`.

### 2.4 보안 · 프라이버시

- **가구 스코프 강제**: 내보내기도 요청자 가구 데이터만(AUTH §4.1). 타 가구 유출 방지 — 통합 테스트로 검증(TEST_STRATEGY §2.3).
- **민감정보 마스킹**: 계좌·카드번호는 마스킹(`56991*****7307`) 옵션, 기본 마스킹. 전체 노출은 owner + 명시 옵션.
- **감사 연동**: 내보내기 실행 = 감사 이벤트(`export.create`, §1.1) 기록(데이터 반출 추적).
- **서명 URL**: 비동기 결과 파일은 단명 서명 URL(만료), 스토리지 직접 접근 차단.
- **권한**: 조회 권한(viewer↑)이면 내보내기 허용하되, 원천/미마스킹은 owner 한정.

### 2.5 구현 메모

- CSV: 스트리밍 라이터(수동 또는 `fast-csv`), XLSX: `exceljs`(스트리밍 워크북).
- 큰 XLSX는 메모리 이슈 → 대량은 CSV 권장/기본, XLSX는 요약·중간 규모.

---

## 3. 스키마/코드 영향

- 신규 테이블: `audit_log`(household 스코프, append-only).
- 신규 모듈: `AuditModule`(인터셉터·서비스·컨트롤러), `ExportModule`(스트리밍·잡).
- 큐: export 대량 잡을 기존 BullMQ 인프라에 추가(INFRA_OPS §4 메트릭 포함).
- 공유(@ledger/shared): `AuditAction` 상수, `ExportTarget`/`ExportFormat` enum.

---

## 4. 확정 필요 사항

1. **감사 diff 깊이**: 변경 필드만(권장) vs 전체 스냅샷.
2. **감사 기록 동기/비동기 경계**: 금전·권한=동기, 그 외=큐 오프로딩 기준.
3. **내보내기 기본 포맷/마스킹 기본값**: CSV+BOM & 계좌 마스킹 기본(권장).
4. **보존 기간**: 감사 로그·내보내기 파일 만료 정책(운영 규모 확정).
