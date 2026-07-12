# API 규약 · 에러 계약 · 잡 통지 설계서

> 백로그: 백엔드 「API 규약 표준화」·「잡 상태 통지 방식」 + 공통 「공통 에러 계약」·「실시간 잡 상태 전송 규약」 4항목 통합.
> 네 항목 모두 **프론트↔백엔드 API 계약**이라 한 문서로 묶는다. 계약 타입은 `@ledger/shared`에 두어 웹·모바일·백엔드가 단일 소스로 공유한다.
> 연동: [API_SPEC.md](API_SPEC.md) · [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md) §8(페칭)·§14 · [ARCHITECTURE.md](ARCHITECTURE.md) §5(큐) · [AUTH_DESIGN.md](AUTH_DESIGN.md)(401/403)

---

## 1. 응답 봉투 (Envelope)

현재는 Nest 기본(`{ statusCode, message, error }`)이라 성공 응답에 규약이 없다. **성공은 봉투 없이 리소스를 그대로**, **에러만 표준 봉투**로 통일한다.

| 케이스 | 형태 |
|--------|------|
| 단건 | 리소스 객체 그대로 (`{ id, ... }`) |
| 목록 | `{ items: [...], page: {...} }` (§3) |
| 에러 | `{ error: { code, message, ... } }` (§2) |
| 204 | 본문 없음(삭제 등) |

> 성공 응답을 `{ data: ... }`로 한 번 더 감싸지 않는다 — OpenAPI 타입 생성물이 단순해지고, 기존 `/transactions` 목록 형태와 호환.

---

## 2. 에러 계약 (공통 에러 타입)

### 2.1 구조

```jsonc
{
  "error": {
    "code": "TRANSACTION_NOT_FOUND",   // 머신 판독용 안정 코드(SCREAMING_SNAKE)
    "message": "거래를 찾을 수 없습니다.", // 사람용(로케일 가능), UI 그대로 노출 가능
    "details": [                        // (선택) 필드 검증 오류 목록
      { "field": "amount", "code": "POSITIVE", "message": "금액은 0보다 커야 합니다." }
    ],
    "traceId": "01J..."                 // 로그 상관관계(관측성 연동)
  }
}
```

- HTTP 상태코드는 그대로 유지(404/400/…)하되, **분기 로직은 `error.code`로** 한다(문구·상태코드 변경에 안전).
- `@ledger/shared`에 `ErrorCode` enum + `ApiError` 타입 정의 → 프론트 api-client가 이 타입으로 파싱, 백엔드 예외 필터가 이 형태로 직렬화.

### 2.2 표준 에러 코드 (초기 집합)

| code | HTTP | 의미 |
|------|:----:|------|
| `VALIDATION_FAILED` | 400 | 요청 검증 실패(`details`에 필드별) |
| `UNAUTHENTICATED` | 401 | 토큰 없음/만료 → 프론트 refresh 트리거(AUTH §2.2) |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh 재사용 감지 → 강제 로그아웃 |
| `FORBIDDEN` | 403 | 권한 부족(RBAC/가구 스코프) |
| `NOT_FOUND` | 404 | 리소스 없음(구체 코드: `*_NOT_FOUND`) |
| `CONFLICT` | 409 | 유니크/상태 충돌(예: 중복 명세서) |
| `UNPROCESSABLE` | 422 | 형식은 맞으나 업무 규칙 위반 |
| `RATE_LIMITED` | 429 | 요청 제한(로그인·재설정, AUTH §8) |
| `INTERNAL` | 500 | 서버 오류(traceId만 노출, 내부 상세 숨김) |

### 2.3 구현 (NestJS)

- **전역 `AllExceptionsFilter`**: Nest `HttpException` → 위 봉투로 매핑. `ValidationPipe` 오류 → `VALIDATION_FAILED` + `details`.
- **도메인 예외**: `DomainException(code, message, httpStatus)` 베이스 → 서비스에서 `throw new NotFoundException('TRANSACTION_NOT_FOUND')` 대신 코드 기반 던지기.
- 500은 `message`를 일반화("일시적 오류")하고 실제 스택은 로그+`traceId`로만.

---

## 3. 목록 규약 (정렬 · 필터 · 페이지네이션)

### 3.1 페이지네이션 — 리소스별 이원화

| 방식 | 대상 | 이유 |
|------|------|------|
| **offset** (`page`,`pageSize`) | 소·유한 목록: categories, payment-methods, budgets, recurring-rules | 총 개수·페이지 점프 필요, 데이터 적음 |
| **cursor(keyset)** | 대·증가 목록: **transactions**, 향후 감사로그 | 대량·무한스크롤, 삽입 중 페이지 밀림 없음 |

**커서 응답**
```jsonc
{
  "items": [ /* ... */ ],
  "page": { "nextCursor": "eyJ0eEF0IjoiMjAyNi0wNi0zMCIsImlkIjoxMjM0fQ", "hasNext": true }
}
```
- 커서 = `(transaction_date, id)` 등 **안정 정렬키를 base64url 인코딩**한 불투명 토큰. 클라이언트는 내용 해석 안 함.
- 요청: `GET /transactions?cursor=...&limit=50`. `cursor` 없으면 첫 페이지.
- offset 응답은 기존과 호환: `{ items, page: { page, pageSize, total } }` (기존 `total/page/pageSize` 평면 형태에서 `page` 객체로 이관 — 마이그레이션 노트 §6).

### 3.2 정렬

- `sort=field:dir` 콤마 다중: `?sort=transactionDate:desc,id:desc`.
- 리소스별 **허용 필드 화이트리스트**(임의 컬럼 정렬 차단). 기본 정렬 명시(거래=`transactionDate:desc,id:desc`).
- 커서 페이지네이션 리소스는 정렬키와 커서키 **일치 필수**(불일치 시 `VALIDATION_FAILED`).

### 3.3 필터

- **필드=값** 쿼리(기존 유지): `type`, `categoryCode`(대분류 시 하위 포함), `paymentMethodId`, `memberId`, `from`,`to`(YYYY-MM-DD), `q`(검색).
- 다중값=콤마: `?categoryCode=05,08`. 범위는 `from`/`to` 접미사 규약.
- 알 수 없는 필터 파라미터는 **무시가 아니라 400**(오타·오해 조기 발견). 페이지·정렬 파라미터는 예외.

### 3.4 공통 파라미터 요약

| 파라미터 | 적용 | 형식 |
|----------|------|------|
| `page`,`pageSize` | offset 리소스 | 정수(pageSize 상한 100) |
| `cursor`,`limit` | cursor 리소스 | 불투명 문자열 / 정수(상한 100) |
| `sort` | 목록 | `field:asc\|desc`(,다중) |
| `from`,`to` | 날짜 필터 | `YYYY-MM-DD` |
| `q` | 검색 | 문자열(설명·메모) |

---

## 4. 잡 상태 통지 (폴링 vs 실시간)

업로드 파이프라인(queued→parsing→classifying→review→completed/failed)의 진행 상태를 클라이언트에 전달하는 방식.

### 4.1 결정: 폴링 기본 + SSE 선택 업그레이드

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| J1 | 기본 통지 | **폴링**(`GET /imports/{jobId}`) | 단순·무상태·프록시/모바일 친화. 잡은 초 단위라 폴링으로 충분 |
| J2 | 실시간 | **SSE**(`GET /imports/{jobId}/events`) 선택 제공 | 단방향 서버→클라이언트에 최적, WebSocket보다 경량. 미지원 환경은 폴링 폴백 |
| J3 | WebSocket | 채택 안 함 | 양방향 불필요, 인프라 복잡도↑ |

- **단일 계약 타입**: 폴링 응답과 SSE 이벤트 payload는 **동일한 `JobStatus` 타입**(`@ledger/shared`) — 프론트가 전송 방식만 바꾸면 됨.
- **폴링 규약**: `Retry-After`/권장 간격 헤더 제공, 지수 백오프(1s→2s→…최대 5s), `completed`/`failed`면 중단.

### 4.2 JobStatus payload (공유 타입)

```jsonc
{
  "jobId": "01J...",
  "status": "classifying",           // ImportJobStatus(enums.ts) 재사용
  "issuer": "hana_card",
  "progress": { "parsed": 77, "classified": 60, "pending": 12 },
  "error": null,                     // failed 시 { code, message }
  "updatedAt": "2026-07-01T12:00:03Z"
}
```

### 4.3 SSE 이벤트 스트림

```
GET /imports/{jobId}/events   (Accept: text/event-stream)

event: status
data: {"jobId":"01J...","status":"parsing","progress":{...}}

event: status
data: {"jobId":"01J...","status":"review","progress":{"pending":12}}

event: done
data: {"jobId":"01J...","status":"completed"}
```
- 종료 이벤트(`done`) 후 서버가 스트림 종료. 연결 끊기면 클라이언트가 **폴링으로 폴백**(마지막 상태 재조회).
- 인증: SSE는 커스텀 헤더 제약이 있어 **단명 토큰 쿼리** 또는 쿠키 세션 사용(AUTH 웹=쿠키와 정합).

### 4.4 큐 재시도 · DLQ (신뢰성)

- **재시도**: 파싱/분류 워커 실패 시 지수 백오프 재시도(기본 3회). 재시도 시 `status`는 유지, 내부 `attempts` 증가.
- **DLQ(Dead Letter Queue)**: 최종 실패 잡은 DLQ로 이동 + `status='failed'`, `error.code`(예: `PARSE_UNSUPPORTED_FORMAT`) 저장. 운영자 재처리 트리거(`POST /imports/{jobId}/retry`).
- **멱등성**: 같은 파일(체크섬) 재업로드는 기존 잡 반환 또는 `CONFLICT`(중복 명세서) — 중복 적재 방지(DATABASE §7.1).

---

## 5. 버저닝 · 관측성 연동

- **버전**: URL 프리픽스 `/api/v1`(기존). 파괴적 변경은 `/v2`, 비파괴는 필드 추가만.
- **traceId**: 모든 응답(성공 헤더 `X-Trace-Id`, 에러 봉투 `traceId`) — 구조화 로그와 상관(인프라 관측성 항목과 연동).
- **문서화**: 에러 코드·정렬 화이트리스트·페이지네이션 방식을 OpenAPI 스키마/`description`에 반영해 api-client 생성물에 노출.

---

## 6. 마이그레이션 노트 (기존 API_SPEC 대비 변경)

1. **에러 형태**: `{ statusCode, message, error }`(Nest 기본) → `{ error: { code, message, details?, traceId } }`. 전역 필터 1곳 교체 + 프론트 파서 1곳 교체.
2. **목록 응답**: 평면 `{ items, total, page, pageSize }` → `{ items, page: { ... } }`로 이관. transactions는 offset→**cursor** 전환(기존 page 파라미터는 한시적 병행 후 폐기).
3. **정렬/필터**: `sort` 파라미터 규약 신설, 알 수 없는 필터 400 정책 도입.
4. **잡 통지**: 폴링 유지 + `/imports/{jobId}/events`(SSE) 신설, payload를 공유 `JobStatus` 타입으로.

---

## 7. 스키마/공유 패키지 영향 (@ledger/shared)

- 추가: `ErrorCode` enum, `ApiError`/`ApiErrorDetail` 타입, `PageInfo`(offset/cursor 유니온), `SortParam` 헬퍼, `JobStatus` 타입.
- `ImportJob`에 `attempts INT`, DLQ 재처리용 컬럼(선택) 추가 검토.

---

## 8. 확정 필요 사항

1. **에러 message 로케일**: 서버가 ko 고정 vs `Accept-Language` 대응(초기 ko 고정 권장).
2. **transactions 페이지네이션 전환 시점**: offset 병행 기간(프론트 전환 완료까지) 길이.
3. **SSE 도입 시점**: MVP는 폴링만, SSE는 2차(FRONTEND §14.2와 함께 확정).
4. **DLQ 인프라**: BullMQ 내장 실패 큐로 충분한지 vs 별도 저장(운영 규모에 따라).
