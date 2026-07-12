# 테스트 전략 설계서 (Test Strategy)

> 백로그 백엔드 「테스트 전략」. 단위/통합/e2e 계층, 테스트 DB, 파서 픽스처(실파일·EUC-KR)를 규정한다.
> 이 프로젝트의 **고위험 지점**(발급사별 명세서 파싱·금액 규칙·자기이체/카드대금 제외·할부 회차·멀티테넌시 격리·집계 rebuild)에 테스트를 집중한다.
> 연동: [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §3.2(CI 실행) · [DATABASE.md](DATABASE.md) §1·§7(파싱·대사 규칙) · [AUTH_DESIGN.md](AUTH_DESIGN.md) §4(스코프) · [REVIEW_WORKFLOW_DESIGN.md](REVIEW_WORKFLOW_DESIGN.md)

---

## 1. 테스트 피라미드 (계층 · 비중)

| 계층 | 도구 | 비중 | 대상 | 속도 |
|------|------|:---:|------|:---:|
| **단위(unit)** | jest | ~70% | 순수 로직: 파서 정규화, 금액 규칙, 분류 매처, 커서 인코딩, zod 스키마 | ms |
| **통합(integration)** | jest + 테스트 DB | ~25% | 서비스↔Prisma↔PG: CRUD·스코프 필터·집계 rebuild·확정 트랜잭션·큐 프로세서 | 100ms~ |
| **e2e** | Supertest(HTTP) | ~5% | 핵심 플로우 1~2개 end-to-end(가드·필터·봉투 포함) | s |

- **원칙**: 도메인 규칙은 **단위에서 빠르게**, DB·트랜잭션 경계는 **통합에서 실제 PG로**, 사용자 여정은 **소수의 e2e로**. Mock은 외부 경계(스토리지·메일)만, Prisma는 가급적 실제 테스트 DB(모킹은 취약).
- **커버리지 목표**: 라인 전역 강제보다 **핵심 모듈 집중**(파서·집계·인증·확정 서비스 ≥85%), 나머지는 참고 지표.

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
- **대사(reconciliation)**: 자기 계좌 간 이체 쌍 매칭 → `exclude_reason='self_transfer'`; 카드대금 출금 매칭 → `card_settlement`(DATABASE §7.1·§7.2).
- **인코딩**: EUC-KR/CP949 원본 파일 디코딩(§4).

### 2.2 집계 (rebuild 정확성)
- 월 rebuild 후 `monthly_summary`/`category`/`source`/`payment`가 `transaction`(`amount NOT NULL AND status='settled'`)과 일치.
- 대분류 예산 vs 소분류 실적 **롤업 합산**(DOMAIN_MODEL §2.3).
- **멱등성**: 같은 월 rebuild 2회 = 1회와 동일(삭제 후 재삽입).

### 2.3 멀티테넌시 / 인가 (보안)
- **가구 스코프 격리**: household A 사용자가 B의 거래/예산/결제수단 **조회·수정 불가**(householdScope 자동 주입 검증) — 누락 시 데이터 유출.
- RBAC: viewer의 쓰기 차단, member의 예산설정 차단, owner 전용 동작(AUTH §4.2).
- 토큰: Access 만료→refresh 회전, **Refresh 재사용 감지 시 family 전체 무효화**(AUTH §2.2).

### 2.4 확정 워크플로 / 큐
- `classifyBatch` **원자성**: 일부 실패 시 성공분만 커밋되지 않고 롤백/부분커밋 정책대로 동작(REVIEW §4.2).
- 규칙 학습 upsert + classifier 캐시 무효화, 확정 후 영향 월 rebuild.
- 반복지출 생성 **멱등성**(`lastGeneratedYm`), pending 생성(DOMAIN_MODEL §3.4).
- BullMQ 프로세서: 실패 재시도→DLQ, 중복 파일 CONFLICT(API_CONVENTIONS §4.4).

### 2.5 API 계약
- 에러 봉투 형태·`ErrorCode`, 커서 페이지네이션 왕복, `sort` 화이트리스트, 알 수 없는 필터 400(API_CONVENTIONS §2·§3).
- 공유 zod 스키마: 프론트 폼 = 백엔드 DTO 동일 검증(경계값: amount>0, 날짜 형식).

---

## 3. 테스트 DB 전략 (통합)

- **실제 PostgreSQL 사용**(SQLite 대체 금지 — PG 전용 동작·`ledger` 스키마·Decimal 정합). 로컬은 docker-compose PG, CI는 서비스 컨테이너(INFRA_OPS §1·§3.1).
- **스키마 준비**: 스위트 시작 시 `prisma migrate deploy`로 최신 스키마 + 코드성 시드(`SEED_SCOPE=code`).
- **격리 방식**:
  | 방식 | 채택 | 비고 |
  |------|:---:|------|
  | 테스트 간 **truncate + 재시드** | ✅ 기본 | 각 스위트 `beforeEach`에서 도메인 테이블 truncate, 빠름 |
  | 트랜잭션 롤백 래핑 | 보조 | 단일 커넥션 케이스에 한해 |
  | DB per worker | 병렬 시 | jest 워커별 스키마/DB로 충돌 방지 |
- **결정성**: 시간 의존 로직은 clock 주입(고정 `now`), 랜덤(잡 id 등) 시드 고정. 시간대 `Asia/Seoul` 고정.
- **환경**: `NODE_ENV=test`, 별도 `DATABASE_URL`(테스트 전용 DB/스키마) — 운영·개발 DB와 물리 분리, `migrate reset` 가드(INFRA_OPS §2.1)와 정합.

---

## 4. 파서 픽스처 (실파일 · EUC-KR)

파서 테스트의 신뢰도는 **실제 명세서 기반 픽스처**에서 나온다.

### 4.1 픽스처 구성

```
apps/api/test/fixtures/statements/
├─ hana_card/2026-04.raw        # 원본(민감정보 마스킹 후)
├─ hana_card/2026-04.expected.json   # 파서 기대 출력(정규화된 card_transaction[])
├─ hyundai_card/...
├─ shinhan_card/...   (취소 3행·할인 케이스 포함)
├─ samsung_card/...   (할부 회차·yyyymmdd·조정행 포함)
└─ bank/hana_47307_2026-03.raw       # 자기이체·카드대금·현금(적요공란)·잔액'-' 포함
```

- **골든 파일 방식**: `parse(raw) === expected.json` 비교. 규칙 변경 시 expected 갱신을 리뷰에서 확인(의도적 변경만).
- **마스킹 필수**: 계좌·카드번호·이름은 픽스처 커밋 전 마스킹(`56991*****7307`). 민감 원본은 리포지토리에 넣지 않음.
- **엣지 픽스처**: 잔액 `-`(NULL), 적요 공란(현금), `principal=0` 정보행, 선입금 조정 음수, 할부 3/3 등 §2.1 케이스를 **각각 최소 1건** 포함.

### 4.2 인코딩

- 은행/카드 다운로드 원본은 **EUC-KR(CP949)**가 흔함 → 파서 진입점에서 인코딩 감지·`iconv`로 UTF-8 디코딩.
- 테스트: EUC-KR 바이트로 저장된 픽스처를 읽어 한글 가맹점명(`대성석유(주)…`)이 깨지지 않고 파싱되는지 검증. UTF-8/BOM/EUC-KR 3종 입력 케이스.

### 4.3 파서 계약 테스트

- 각 발급사 어댑터가 **공통 인터페이스**(`ParsedStatement`) 계약을 지키는지 동일 스위트로 검증(필수 필드·타입·금액 부호 규약). 새 발급사 추가 시 이 스위트만 통과하면 파이프라인 호환.

---

## 5. 실행 · CI 통합

| 명령 | 범위 |
|------|------|
| `pnpm test` | turbo — 전 패키지 단위+통합(변경 영향분 캐시) |
| `pnpm --filter @ledger/api test` | api 단위+통합 |
| `pnpm --filter @ledger/api test:e2e` | e2e(테스트 DB 필요) |
| `pnpm --filter @ledger/shared test` | zod 스키마·순수 유틸 |

- **CI(PR 게이트)**: PG+Redis 서비스 컨테이너 기동 → `migrate deploy`+시드 → `turbo run test` → 커버리지 리포트(INFRA_OPS §3.1). 실패 시 머지 차단.
- **속도**: 단위는 DB 없이 초 단위, 통합은 truncate 재사용으로 스위트 병렬화. e2e는 핵심 플로우만이라 짧게 유지.

---

## 6. 프론트엔드 테스트 (범위 메모)

- 단위: 포맷터(₩·ko-KR 날짜), 커스텀 훅, zod 폼 검증(공유 스키마 재사용).
- 컴포넌트: Testing Library로 검토(review) UI·빠른입력 폼 상호작용(추천 채움·일괄 확정).
- e2e(후순위): Playwright로 로그인→업로드→검토→확정 1플로우. **초기 범위는 유닛/컴포넌트 우선**, 브라우저 e2e는 2차.

---

## 7. 확정 필요 사항

1. **실제 명세서 픽스처 확보**: 마스킹된 실파일 제공 가능 여부(파서 신뢰도 직결) — 불가 시 합성 픽스처로 시작.
2. **e2e 도구**: 백엔드 Supertest만 vs 프론트 Playwright 포함 시점.
3. **커버리지 게이트 수치**: 핵심 모듈 강제 임계(예: 85%) 도입 여부.
4. **병렬 테스트 격리**: truncate 재시드 vs DB-per-worker(테스트 수 증가 시 재검토).
