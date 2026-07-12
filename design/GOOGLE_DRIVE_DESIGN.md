# 구글 드라이브 연동 설계서 (파일 저장 · 기존 시트 가져오기)

> 2026-07 결정: 업로드 명세서 저장소로 **구글 드라이브**를 사용하고, 기존 "가계 정리" **구글 시트**도 직접 읽어 가져온다. 연결 단위는 **가구 대표 계정 1개**.
> 핵심 원칙: **앱 로그인(자체 JWT)과 드라이브 연결(Google OAuth)은 완전히 별개 레이어**다.
> 연동: [AUTH_DESIGN.md](AUTH_DESIGN.md) §11 · [INFRA_OPS_DESIGN.md](INFRA_OPS_DESIGN.md) §1.3 · [ARCHITECTURE.md](ARCHITECTURE.md) §5(적재) · [DATABASE.md](DATABASE.md) §1(원본 시트)

---

## 1. 두 개의 인증 레이어 (혼동 금지)

| | 앱 로그인 | 드라이브 연결 |
|---|-----------|---------------|
| 무엇 | 누가 앱을 쓰는가 | 앱이 어느 드라이브에 파일을 두고, 어느 시트를 읽는가 |
| 방식 | 이메일+비밀번호 → **자체 JWT**(Access/Refresh) | **Google OAuth 2.0** → Google refresh token |
| 주체 | 모든 가구원 | **가구 owner 1명**(대표 계정) |
| 저장 | refresh_token 테이블 | `google_connection`(암호화) |

> 사용자는 "구글로 로그인"하는 게 아니라, **앱에 로그인한 뒤 설정에서 가구의 구글 드라이브를 연결**한다.

---

## 2. 연결 모델 (가구 1 : 1 구글 계정)

```prisma
model GoogleConnection {
  id               Int      @id @default(autoincrement())
  householdId      Int      @unique @map("household_id")   // 가구당 1개
  googleEmail      String   @map("google_email")           // 연결된 대표 계정(표시용)
  refreshTokenEnc  String   @map("refresh_token_enc")      // 암호화 저장(원문 금지)
  scopes           String                                   // 부여된 scope 목록
  driveFolderId    String?  @map("drive_folder_id")        // 앱 전용 업로드 폴더 ID
  sheetFileId      String?  @map("sheet_file_id")          // 선택한 '가계 정리' 시트 ID(선택)
  connectedByUserId Int     @map("connected_by_user_id")   // 연결 수행 owner
  status           String   @default("active")             // active / needs_reconnect / revoked
  connectedAt      DateTime @default(now()) @map("connected_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  household Household @relation(fields: [householdId], references: [id])
  @@map("google_connection")
}
```

- **암호화**: refresh token은 앱 시크릿/KMS로 암호화 후 저장. 로그·응답에 절대 노출 금지(AUTH §8).
- **owner 전용**: 연결·해제·재연결은 `@Roles('owner')`. member/viewer는 결과(업로드·가져오기)만 사용.

---

## 3. 권한 범위 (최소권한 — drive.file + Picker)

| scope | 용도 | 접근 범위 |
|-------|------|-----------|
| `drive.file` | 업로드 파일 저장 + **사용자가 고른** 기존 파일 접근 | 앱이 만든 파일 + Picker로 선택한 파일**만** |
| `spreadsheets.readonly` | 선택한 가계부 시트 셀 읽기 | 시트 내용 읽기 전용 |

- **왜 Picker인가**: `drive.file`은 "앱이 만든 파일"과 "**Google Picker로 사용자가 명시 선택한 파일**"에만 접근을 준다. 따라서 넓은 `drive.readonly` 없이도:
  - ✅ 업로드 명세서 → 앱이 만든 폴더에 저장(접근 가능)
  - ✅ 기존 "가계 정리" 시트 → 사용자가 Picker로 콕 집어 선택 → 그 파일만 접근
  - ⛔ 그 외 사용자의 드라이브 파일은 접근 불가 (신뢰·보안)

---

## 4. 저장소 추상화 (StorageService)

Drive에 강결합하지 않도록 인터페이스 뒤에 둔다 — dev/테스트는 로컬 폴백.

```ts
interface StorageService {
  save(householdId, file): Promise<{ fileRef: string }>   // Drive: fileId 반환 / local: 경로
  read(householdId, fileRef): Promise<Stream>
  remove(householdId, fileRef): Promise<void>
}
// GoogleDriveStorage(운영·기본) | LocalStorage(dev/test/CI)  — env로 선택
```

- `import_job`에는 **파일 원문이 아니라 `fileRef`(Drive fileId)만** 저장(DATABASE §1.5 흐름과 동일, "메타+경로만").
- CI/테스트는 `LocalStorage`라 구글 연결 없이도 파서·파이프라인 테스트 가능(TEST_STRATEGY §3 정합).

---

## 5. 폴더 구조 (앱 전용)

```
Google Drive (가구 대표 계정)
└─ 가계부-Ledger/                 ← 앱이 생성(drive.file), driveFolderId
   ├─ statements/
   │  ├─ hana_card/2026-04/<원본파일>
   │  └─ bank/47307/2026-06/<원본파일>
   └─ exports/                    ← 데이터 내보내기 결과(BACKEND_FEATURES §2)도 이곳 저장 가능
```

---

## 6. 주요 흐름

### 6.1 드라이브 연결 (설정 화면, owner)
```
설정 → "구글 드라이브 연결" → Google OAuth 동의(scope 3) → 콜백
  → refresh token 암호화 저장 + 앱 폴더 생성(driveFolderId)
  → status=active
```

### 6.2 명세서 업로드 (기존 파이프라인에 저장소만 Drive)
```
POST /imports (파일) → StorageService.save() → Drive statements/ 에 저장, fileId 획득
  → import_job(fileRef=fileId, status=queued) → 이후 파서·분류·집계 동일(ARCHITECTURE §5)
```

### 6.3 기존 "가계 정리" 시트 가져오기 (일회성 마이그레이션 + 반복 동기화)
```
설정 → "기존 가계부 시트 연결" → Google Picker로 시트 선택 → sheetFileId 저장
  → POST /imports/google-sheet { range } → Sheets API로 수입/지출 탭 읽기
  → DATABASE §4 매핑(분류·결제수단·금액·날짜)으로 transaction 생성(검토 경유 권장)
  → 영향 월 rebuild
```
- 원본 시트 구조(수입: 수입처/일/항목/입금액…, 지출: 분류/일/항목/지출액…)는 DATABASE §1 매핑 규칙 재사용.
- 최초 이관은 대량 → 검토(pending) 흐름으로 확정(REVIEW_WORKFLOW). 이후 주기적 재동기화는 선택.

---

## 7. API 설계

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|:----:|
| GET | `/integrations/google` | 연결 상태 조회(email·status·folder) | 조회 |
| GET | `/integrations/google/auth-url` | OAuth 동의 URL 발급 | owner |
| GET | `/integrations/google/callback` | OAuth 콜백 → 토큰 저장·폴더 생성 | owner |
| DELETE | `/integrations/google` | 연결 해제(토큰 폐기) | owner |
| POST | `/imports` | 명세서 업로드(저장소=Drive) | member↑ |
| POST | `/integrations/google/pick-sheet` | Picker로 고른 sheetFileId 등록 | owner |
| POST | `/imports/google-sheet` | 선택 시트 가져오기 잡 생성 | member↑ |

---

## 8. 신뢰성 · 예외 처리

- **토큰 만료/폐기**: refresh 실패(사용자가 구글에서 권한 회수) → `status=needs_reconnect`, 진행 잡은 `failed`(에러코드 `DRIVE_REAUTH_REQUIRED`, API_CONVENTIONS §2) → 설정에서 재연결 유도.
- **할당량/네트워크**: Drive/Sheets API 실패는 큐 재시도·DLQ(API_CONVENTIONS §4.4)로 흡수.
- **파일 삭제 정합**: 드라이브에서 원본을 사람이 지우면 `read` 실패 → 재처리 불가 안내(원천 보존 권고).
- **개인정보**: 시트에 계좌·카드번호가 있으면 가져올 때 마스킹 규칙 적용(ARCHITECTURE §10).

---

## 9. 스키마/코드 영향

- 신규 테이블: `google_connection`(가구 스코프, refresh token 암호화).
- 신규 모듈: `IntegrationsModule`(GoogleAuthService·DriveService·SheetImportService), `StorageService` 추상화(Drive/Local).
- env(INFRA_OPS §1.3): `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`GOOGLE_REDIRECT_URI`·`STORAGE_ENC_KEY`·`STORAGE_DRIVER=google|local`.
- 프론트: 설정 화면에 "드라이브 연결" + Google Picker 스크립트, 연결 상태 배지.

---

## 10. 확정 필요 사항

1. **재동기화 주기**: 기존 시트를 한 번만 이관 vs 주기적 재동기화(중복 방지 키 필요).
2. **토큰 암호화 키 관리**: 앱 시크릿 vs 클라우드 KMS(운영 시).
3. **모바일 앱(2단계)**: 모바일에서도 동일 가구 드라이브 연결 재사용(가구 스코프라 재사용 가능) 확인.
4. **구글 앱 검증(OAuth verification)**: 외부 사용자 대상 배포 시 Google 앱 검수 필요 여부(민감 scope).
