# Ledger 백업·복구

2026-09-25 기준. 운영 DB는 워크스페이스 밖의 Docker 호스트에서 실행된다.
SSH 로그인 정보는 코드·문서·백업 서비스에 저장하지 않는다.

## 현재 자동 백업 정책

| 항목 | 구성 |
|---|---|
| 실행 위치 | Docker 호스트의 `ledger-db-backup.service` / `ledger-db-backup.timer` |
| 일정 | 매일 03:00, `Asia/Seoul`; 호스트 정지 중 놓친 일정은 부팅 후 실행 (`Persistent=true`) |
| DB 대상 | 호스트 PostgreSQL 컨테이너의 `ledger` DB 전체, PostgreSQL 18 |
| 앱 대상 | Coder 홈 영구 볼륨의 `ledger` 디렉터리. 앱 컨테이너가 꺼져 있어도 읽을 수 있음 |
| 포함 | DB, 소스와 Git 이력, 미커밋 파일, 환경 설정, 업로드 원본, 백업 서비스 복구 설정 |
| 제외 | 의존성, 빌드 결과, 캐시, 로그, SSH 인증 정보, 백업 암호화 키, rclone 인증 파일 |
| 암호화 | 전체 묶음을 GPG AES-256으로 암호화; 무작위 복구 키는 별도 파일로 보관 |
| 로컬 | 호스트 `/var/backups/ledger`, 최근 14개 |
| 원격 | 기존 개인 Google Drive의 `My Dev/Ledger/secure-snapshots`, 최근 30개 |
| 검증 | DB 스냅샷과 동일 시점의 테이블 행 수·내용 지문을 별도 PostgreSQL 컨테이너에 복원하여 비교 |
| 업로드 검증 | 암호문을 다시 내려받아 비교하는 `rclone check --download` |
| 삭제 조건 | 새 백업의 복원·암호화·업로드 검증이 모두 성공한 뒤 이 작업의 파일 이름만 정리 |
| 실패 처리 | 비정상 종료 기록, 15분 간격으로 최대 2회 추가 재시도. 기존 정상 백업 유지 |

백업 데이터는 작업 중에만 권한 700의 임시 디렉터리에 존재하며 작업 종료 시 제거한다.
영구 저장되는 새 자동 백업은 암호화 파일과 SHA-256 파일이다. 로그에는 비밀번호와 거래 내용을 기록하지 않는다.
복원 검증 컨테이너는 네트워크와 외부 포트 없이 실행하고 검증 후 삭제한다.
운영 DB는 읽기 전용 스냅샷으로 조회하며 복원 대상으로 사용하지 않는다.

호스트가 꺼지거나 PostgreSQL 컨테이너가 실행되지 않으면 백업할 수 없다.
별도 외부 알림 채널은 설정하지 않았으므로 systemd 실패 상태와 최근 성공 시각을 확인한다.
이 작업은 `ledger-runtime.timer` 등 앱 자동 기동 설정을 변경하지 않는다.

## 설치·상태 확인

원본은 `scripts/backup/`에 있다. Docker 호스트에 Python 3, Docker, GPG,
rclone, Git, tar/gzip/sha256sum이 필요하다. 아래는 **호스트**에서 실행한다.

```bash
sudo python3 <저장소 경로>/scripts/backup/install-host-backup.py \
  --app-container <워크스페이스 컨테이너 이름>

# 먼저 한 번 실행하여 성공 확인
sudo systemctl start ledger-db-backup.service
sudo systemctl show ledger-db-backup.service -p Result -p ExecMainStatus
sudo systemctl enable --now ledger-db-backup.timer

# 일정과 결과 점검
sudo systemctl list-timers --all ledger-db-backup.timer --no-pager
sudo journalctl -u ledger-db-backup.service -n 50 --no-pager
sudo cat /var/backups/ledger/local-status.json  # 최근 로컬 암호화·복원 검증 성공
sudo cat /var/backups/ledger/status.json        # 최근 원격 업로드까지 성공
```

설치기는 워크스페이스의 영구 홈 볼륨 경로를 찾아 `/etc/ledger-backup/config.json`에 저장한다.
새 워크스페이스가 다른 홈 볼륨을 사용하면 설치기를 다시 실행하여 경로를 갱신한다.
Docker는 호스트의 로컬 소켓을 명시적으로 사용하므로 개인 Docker context에 영향받지 않는다.
`/etc/ledger-backup/rclone.conf`는 기존 리모트 인증을 별도 복사한 권한 600 파일이다.
인증 만료·해제 시 이 파일의 인증을 갱신해야 한다.
공용 rclone OAuth 프로젝트는 이번 점검에서 Google API `rateLimitExceeded`를 반환했다.
이 오류는 암호화된 로컬 백업을 무효화하지 않지만 원격 백업 성공으로 처리하지 않는다.
전용 Google OAuth 클라이언트를 사용하는 설정으로 갱신하면 공용 프로젝트 의존성을 없앨 수 있다.
방법은 [rclone 공식 안내](https://rclone.org/drive/#making-your-own-client-id)를 참고한다.
인증 파일의 비밀값은 출력하거나 커밋하지 말고 `/etc/ledger-backup/rclone.conf`에서만 관리한다. 기존 9월 7일·8일 SQL 백업과
수동 `snapshots/` 폴더는 새 작업의 보관 정리 대상이 아니다.

## 복구 키 보관

복구 키는 다음 두 위치에만 별도로 저장한다. 둘 다 파일 권한 600이다.

- 호스트: `/etc/ledger-backup/recovery.key` (root만 접근)
- 워크스페이스: `~/.config/ledger-backup/recovery.key` (소유자만 접근)

키는 소스 저장소와 Google Drive 백업 묶음에 포함하지 않는다.
**호스트 전체를 잃어도 복구할 수 있도록 이 키를 별도의 비밀번호 관리자나 안전한 장치에도 보관해야 한다.**
키를 잃으면 암호화 백업을 복원할 수 없다. 키를 임의로 재생성하거나 덮어쓰지 않는다.
SSH 암호는 이 암호화 키와 관계없으며 자동 백업에 필요하지 않다.

## 복구

운영 DB에 덮어쓰지 말고 PostgreSQL 18 이상의 **새 빈 DB**에 먼저 복원한다.
환경 설정·금융 데이터가 복호화되므로 복구 폴더도 권한 700으로 만든다.

```bash
umask 077
mkdir -m 700 ledger-restore
cd ledger-restore
# UTC 시각이 붙은 파일명을 선택
BACKUP_FILE=ledger_<UTC시각>.tar.gpg
rclone copyto "gdrive:My Dev/Ledger/secure-snapshots/$BACKUP_FILE" "$BACKUP_FILE"
rclone copyto "gdrive:My Dev/Ledger/secure-snapshots/$BACKUP_FILE.sha256" "$BACKUP_FILE.sha256"
sha256sum --check "$BACKUP_FILE.sha256"

gpg --batch --pinentry-mode loopback --passphrase-file /안전한/경로/recovery.key \
  --output snapshot.tar --decrypt "$BACKUP_FILE"
tar -xf snapshot.tar
```

`manifest.json`의 `artifacts`에 기록된 `database.dump`, `application.tar.gz` 해시를 확인한다.
`host-backup-configuration/`에는 백업 코드·systemd 파일·접속 위치 설정이 포함된다.
실제 암호화 키와 rclone 인증 파일은 포함되지 않는다.

```bash
# PGHOST / PGPORT / PGUSER / PGPASSWORD는 복구용 서버 값 사용
createdb ledger_restore
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
  --dbname=ledger_restore database.dump
mkdir -m 700 restored-app
tar -xzf application.tar.gz -C restored-app
```

`manifest.json`의 테이블별 행 개수와 내용 지문을 비교한다.
지문은 세션 시간대 `UTC`, `DateStyle = ISO, YMD`에서 계산한다.

```sql
SELECT count(*)::text AS rows,
       md5(coalesce(string_agg(md5(row_to_json(t)::text), ''
           ORDER BY md5(row_to_json(t)::text)), '')) AS fingerprint
FROM ledger."transaction" t;
```

`.env`를 복구 서버 환경에 맞춰 조정하고 의존성 설치, Prisma 클라이언트 생성,
API·웹 빌드를 수행한 뒤 검증이 끝나면 운영 연결을 전환한다.
DB 로그인 역할·소유권·접근 권한과 Redis 대기 작업은 별도로 복구해야 한다.

## 수동 로컬 백업과 과거 구성

`scripts/backup-current.mjs`는 현재 앱의 `.env`를 읽어 로컬 스냅샷을 만든다.
Node.js 20 이상, 설치된 API 의존성, PostgreSQL 18 클라이언트가 필요하다.

```bash
node --env-file=.env scripts/backup-current.mjs
```

도구가 PATH에 없다면 `PG_BIN`을 지정한다. 결과는
`~/db-backups/snapshots/<UTC 시각>/`에 저장되며 **암호화되지 않은 로컬 백업**이다.
평문 백업의 원격 업로드 기능은 제공하지 않는다.
원격 백업에는 위 호스트의 암호화 작업을 사용한다.

9월 25일 최초 점검에서 과거 컨테이너·Google Drive 백업의 마지막 성공 기록은
9월 8일이었고, 운영 문서에 적혀 있던 호스트 `ledger-db-backup.timer`는 존재하지 않았다.
기존 `~/db-backups/backup.sh`, `restore.sh`는 `localhost`와 과거 인증 설정을
하드코딩한 구성이라 현재 운영 DB에 사용하지 않는다. 과거 스크립트에는
업로드 실패가 성공으로 끝나거나 원격 확인 전에 파일을 정리할 수 있는 문제도 있었다.

기존 `ledger_*.sql.gz` 파일을 복구하려면 `set -o pipefail`을 지정하고,
새 빈 DB에 `gzip -dc <파일> | psql --set=ON_ERROR_STOP=1 --dbname=ledger_restore`로 복원한다.
