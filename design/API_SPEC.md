# 가계부 API 명세 (v1)

> **단일 진실원은 코드**. 이 문서는 개요이며, 실제 스펙은 서버 기동 후 자동 생성된다.
> - Swagger UI: `GET /api/v1/docs`
> - OpenAPI JSON: `GET /api/v1/docs-json` (웹·모바일 클라이언트 코드 생성 소스)
>
> 공통: Base URL `/{host}/api/v1`, 인증 `Authorization: Bearer <token>`(예정), 오류는 Nest 표준 `{ statusCode, message, error }`.

---

## 리소스 개요

| 태그 | 경로 | 설명 |
|------|------|------|
| health | `/health` | DB 연결 헬스체크 |
| categories | `/categories` | 분류 코드(Parent-Child) 조회 |
| payment-methods | `/payment-methods` | 결제수단(카드·은행) CRUD |
| counterparties | `/counterparties` | 수입처/거래처 |
| transactions | `/transactions` | 거래 CRUD·검색·필터 |
| statistics | `/stats` | 월별 요약 통계·재집계 |
| imports | `/imports` | 명세서 업로드·적재 잡 상태 |

---

## 1. categories

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/categories?type=&tree=` | 분류 목록. `tree=true` 면 대/소분류 트리 |
| GET | `/categories/{code}` | 분류 단건 |

- `type`: `income` | `expense` (선택)
- 트리 응답 노드: `{ code, name, type, depth, sortOrder, children[] }`

## 2. payment-methods

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/payment-methods?methodType=` | 목록 (`bank`/`card` 필터) |
| GET | `/payment-methods/{id}` | 단건 |
| POST | `/payment-methods` | 등록 |
| PATCH | `/payment-methods/{id}` | 수정 |
| DELETE | `/payment-methods/{id}` | 삭제 |

- 생성 바디: `{ name, methodType, issuer?, identifier?, accountNo?, owner? }`

## 3. counterparties

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/counterparties?q=` | 목록(부분검색) |
| POST | `/counterparties` | 등록 `{ name, type? }` |

## 4. transactions

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/transactions` | 목록 (필터·검색·페이지네이션) |
| GET | `/transactions/{id}` | 단건 (분류·수입처·결제수단 포함) |
| POST | `/transactions` | 등록 |
| PATCH | `/transactions/{id}` | 수정 |
| DELETE | `/transactions/{id}` | 삭제 |

**목록 쿼리 파라미터**
`type`, `categoryCode`(대분류 지정 시 하위 포함), `paymentMethodId`, `from`, `to`(YYYY-MM-DD), `q`(설명/메모 검색), `page`, `pageSize`.

**목록 응답**: `{ items[], total, page, pageSize }`

**생성 바디**
```json
{
  "type": "expense",
  "categoryCode": "0501",
  "paymentMethodId": 3,
  "counterpartyId": 12,
  "description": "이마트 김포한강점",
  "amount": 32340,
  "transactionDate": "2026-03-01",
  "settledDate": "2026-03-01",
  "status": "settled",
  "memo": ""
}
```

## 5. statistics

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/stats/monthly?ym=` | 월 전체 요약 (ym 없으면 `recent=6` 최근 목록) |
| GET | `/stats/monthly/category?ym=&type=` | 월 × 분류별 |
| GET | `/stats/monthly/source?ym=` | 월 × 수입처별 |
| GET | `/stats/monthly/payment?ym=&methodType=` | 월 × 결제수단별(카드/은행) |
| POST | `/stats/monthly/{ym}/rebuild` | 월 요약 재집계(거래 변경/업로드 후) |

- `ym` 형식: `YYYY-MM`. 집계는 `settled` + 금액 존재 거래만(이체·카드대금 자동 제외).

## 6. imports (명세서 자동 입력)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/imports` | 명세서 파일 업로드(multipart) → 적재 잡 생성 |
| GET | `/imports/{jobId}` | 잡 진행 상태 폴링 |

- 업로드: `multipart/form-data` — `issuer`(발급사), `paymentMethodId?`, `file`(Excel/CSV).
- 잡 응답: `{ jobId, status, issuer, parsedRows?, pendingRows?, error? }`
- `status`: `queued → parsing → classifying → review → completed`(또는 `failed`).
- ⚠️ 현재 컨트롤러/계약만 확정된 **스텁**. 실제 파싱·분류·큐 처리는 4단계(적재 파이프라인)에서 구현.

---

## 클라이언트 코드 생성 (권장 워크플로)

```bash
# 서버 기동 후 OpenAPI JSON 확보
curl http://localhost:4000/api/v1/docs-json > openapi.json

# 웹/모바일 공용 타입·클라이언트 생성 (예: openapi-typescript)
npx openapi-typescript openapi.json -o packages/api-client/src/schema.ts
```

> 생성물은 `packages/api-client` 에 두어 `apps/web`·`apps/mobile` 이 공유한다.
