# DB 백업 & 복구 매뉴얼 (Ledger)

> 이 문서는 **컨테이너가 완전히 삭제되어도** 백업(구글 드라이브)만으로 DB를 되살릴 수 있도록,
> 백업 구성·복구 절차·스크립트 원문을 전부 담고 있다. GitHub에 보관하는 것이 목적.
> 최종 갱신: 2026-08 기준 구성.

---

## 1. 한눈에 요약

| 항목 | 값 |
|---|---|
| 대상 DB | PostgreSQL `ledger` (스키마 `ledger`) |
| 접속 | `postgresql://ledger:ledger@localhost:5432/ledger?schema=ledger` (앱 `.env`의 `DATABASE_URL`) |
| 백업 방식 | `pg_dump --no-owner --no-privileges \| gzip` |
| 파일명 | `ledger_YYYYMMDD_HHMMSS.sql.gz` (덤프에 `CREATE SCHEMA ledger` 포함) |
| 스케줄 | 컨테이너 PM2 작업 `ledger-db-backup`, cron `0 3 * * *` (매일 03:00) |
| 보관 | 로컬 최근 2개 + 구글 드라이브 최근 2개 |
| 드라이브 위치 | **내 드라이브 > My Dev > Ledger** (계정 `teddiyaki@gmail.com`, rclone 리모트 `gdrive`) |
| 스크립트 | `/home/coder/db-backups/backup.sh`(백업), `/home/coder/db-backups/restore.sh`(복구) |

> **가장 중요한 안정 참조값**: 드라이브 폴더 `My Dev/Ledger` 와 접속 문자열.
> 도커 볼륨 경로(`/var/lib/docker/volumes/coder-...-home/_data`)는 워크스페이스를 새로 만들면 바뀔 수 있다.

---

## 2. 환경 구조 (호스트 vs 컨테이너)

- **컨테이너**(`coder@HouseholdLedger`): 앱·PostgreSQL·rclone·백업 스크립트·백업 파일이 **여기** 있다.
  - 앱: `/home/coder/ledger`
  - 백업: `/home/coder/db-backups`
  - rclone 설정: `/home/coder/.config/rclone/rclone.conf` (리모트 `gdrive`)
- **호스트**(`teddy@so4...`): 도커 호스트. 컨테이너 `/home/coder`는 도커 볼륨에 있어
  호스트에서는 `sudo`로 `/var/lib/docker/volumes/coder-...-home/_data` 아래에서 보인다.
- 복구/백업 명령은 **반드시 컨테이너 안(coder 사용자)** 에서 실행한다.
  호스트에서 실행하려면: `sudo docker exec -it -u coder <컨테이너> bash ...`

---

## 3. 평상시 복구 (컨테이너·DB가 살아 있는 경우)

가장 간단하게, 드라이브에서 **바로 스트리밍 복원**한다.

```bash
# (컨테이너 안에서)
bash ~/db-backups/restore.sh          # 드라이브 백업 목록 보기
bash ~/db-backups/restore.sh latest   # 가장 최근 백업으로 복원 (yes 확인)
pm2 restart ledger-api                # 앱 반영
```

수동으로 하려면:
```bash
export PGPASSWORD=ledger
FILE=$(rclone lsf "gdrive:My Dev/Ledger" --files-only | grep '^ledger_.*\.sql\.gz$' | sort | tail -1)
psql -h localhost -U ledger -d ledger -c "DROP SCHEMA IF EXISTS ledger CASCADE;"
rclone cat "gdrive:My Dev/Ledger/$FILE" | gunzip | psql -h localhost -U ledger -d ledger
```

---

## 4. 🔥 재해 복구 (컨테이너가 완전히 사라진 경우 — 처음부터)

> 시나리오: 워크스페이스/컨테이너가 삭제되어 DB도 스크립트도 없다. 있는 것은 **구글 드라이브의 백업 파일뿐**.

### 4-1. PostgreSQL 준비
아무 PostgreSQL이나 되지만, 접속 정보가 앱의 `DATABASE_URL`과 맞아야 한다.
- 사용자 `ledger` / 비밀번호 `ledger` / DB `ledger`.

리포의 `docker-compose.yml`로 띄우는 방법(권장):
```bash
cd ledger                 # 리포 클론한 위치
docker compose up -d postgres    # postgres:18 컨테이너(ledger-postgres) 기동, 포트 5432
```
또는 직접 설치한 PostgreSQL에서:
```sql
CREATE USER ledger WITH PASSWORD 'ledger';
CREATE DATABASE ledger OWNER ledger;
```
> 새 DB에는 스키마가 없으므로, 아래 복원 시 덤프의 `CREATE SCHEMA ledger`가 스키마를 새로 만든다.

### 4-2. rclone + 드라이브 인증 준비
```bash
# 설치
curl https://rclone.org/install.sh | sudo bash     # 또는: sudo apt install -y rclone

# 리모트 'gdrive' 생성 (구글 계정 teddiyaki@gmail.com)
rclone config
#  n → name: gdrive → Storage: drive → client_id/secret: (Enter)
#  scope: drive.file → Use auto config?: n  (헤드리스면 반드시 No)
#  → 브라우저 있는 PC에서  rclone authorize "drive"  실행해 토큰 받아 붙여넣기
#  Shared Drive?: n → Keep?: y
rclone listremotes         # gdrive: 나오면 OK
```

### 4-3. 백업 받아 복원
```bash
export PGPASSWORD=ledger

# 가장 최근 백업 파일명 확인
rclone lsf "gdrive:My Dev/Ledger" --files-only | grep '^ledger_.*\.sql\.gz$' | sort
FILE=<위 목록에서 가장 최근 파일>

# 복원 (드라이브 → gunzip → psql)
rclone cat "gdrive:My Dev/Ledger/$FILE" | gunzip | psql -h localhost -U ledger -d ledger
```
> 이미 스키마가 있어 "already exists" 오류가 나면 먼저:
> `psql -h localhost -U ledger -d ledger -c "DROP SCHEMA IF EXISTS ledger CASCADE;"`

### 4-4. 앱 재구동 & 백업 자동화 재설정
```bash
# 앱 (예: pnpm 설치 후)
cd ledger && pnpm install
pnpm --filter @ledger/api build && pnpm --filter @ledger/web build
pm2 start ...     # 기존 방식대로 ledger-api / ledger-web 기동

# 백업 스크립트 재배치 (§6 원문 참고) 후 자동화 등록
mkdir -p ~/db-backups   # backup.sh, restore.sh 저장(아래 원문)
chmod +x ~/db-backups/*.sh
pm2 start ~/db-backups/backup.sh --name ledger-db-backup \
  --interpreter bash --no-autorestart --cron-restart "0 3 * * *"
pm2 save
```

---

## 5. 검증
```bash
export PGPASSWORD=ledger
# 테이블 개수 / 주요 데이터 확인
psql -h localhost -U ledger -d ledger -c "\dt ledger.*" | head
psql -h localhost -U ledger -d ledger -c "select count(*) from ledger.transaction;"
```
앱에 로그인해 거래·예상 화면이 정상인지 확인.

---

## 6. 스크립트 원문 (컨테이너가 없어도 그대로 재생성 가능)

### 6-1. `~/db-backups/backup.sh` — 백업 + 드라이브 업로드
```bash
#!/usr/bin/env bash
# Ledger DB 일일 백업(컨테이너 PM2 실행) — pg_dump → gzip, 로컬 최근 2개 + 구글 드라이브 업로드(최근 2개).
set -uo pipefail

DIR="/home/coder/db-backups"
DB_HOST="localhost"; DB_USER="ledger"; DB_NAME="ledger"
export PGPASSWORD="ledger"
KEEP=2
REMOTE="gdrive"
REMOTE_DIR="My Dev/Ledger"

mkdir -p "$DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$DIR/ledger_${TS}.sql.gz"
log() { echo "$(date '+%F %T')  $*" >> "$DIR/backup.log"; }

if pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$OUT"; then
  log "OK  $OUT ($(du -h "$OUT" | cut -f1))"
else
  log "FAIL  pg_dump 실패"; rm -f "$OUT"; exit 1
fi

ls -1t "$DIR"/ledger_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
  if rclone copy "$OUT" "${REMOTE}:${REMOTE_DIR}" --no-traverse 2>>"$DIR/backup.log"; then
    log "UP  ${REMOTE}:${REMOTE_DIR}/$(basename "$OUT")"
  else
    log "UPFAIL  드라이브 업로드 실패"
  fi
  rclone lsf "${REMOTE}:${REMOTE_DIR}" --files-only 2>/dev/null \
    | grep -E '^ledger_.*\.sql\.gz$' | sort | head -n -"$KEEP" \
    | while read -r f; do rclone deletefile "${REMOTE}:${REMOTE_DIR}/$f" 2>/dev/null; done
else
  log "SKIP  rclone 리모트('${REMOTE}') 미설정 — 로컬 백업만"
fi
```

### 6-2. `~/db-backups/restore.sh` — 드라이브에서 복구
```bash
#!/usr/bin/env bash
# Ledger DB 복구 — 구글 드라이브의 백업을 현재 DB로 복원(스트리밍).
#   bash restore.sh            # 목록
#   bash restore.sh latest     # 최근 백업 복원
#   bash restore.sh <파일명>
set -uo pipefail
REMOTE="gdrive"; REMOTE_DIR="My Dev/Ledger"
export PGPASSWORD="ledger"
psql_() { psql -h localhost -U ledger -d ledger "$@"; }

if [ $# -eq 0 ]; then
  echo "드라이브 백업 목록 (${REMOTE}:${REMOTE_DIR}):"
  rclone lsf "${REMOTE}:${REMOTE_DIR}" --files-only 2>/dev/null | grep -E '^ledger_.*\.sql\.gz$' | sort
  echo; echo "복원:  bash $0 <파일명>    또는    bash $0 latest"; exit 0
fi

FILE="$1"
if [ "$FILE" = "latest" ]; then
  FILE="$(rclone lsf "${REMOTE}:${REMOTE_DIR}" --files-only 2>/dev/null | grep -E '^ledger_.*\.sql\.gz$' | sort | tail -1)"
  [ -n "$FILE" ] || { echo "드라이브에 백업이 없습니다."; exit 1; }
fi

echo "복원 대상: ${REMOTE}:${REMOTE_DIR}/${FILE}"
echo "⚠ 현재 'ledger' 스키마를 삭제하고 이 백업으로 덮어씁니다(되돌릴 수 없음)."
printf "계속하려면 yes 를 입력: "; read -r ans
[ "$ans" = "yes" ] || { echo "취소됨."; exit 1; }

psql_ -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS ledger CASCADE;" >/dev/null || { echo "❌ 스키마 삭제 실패"; exit 1; }
if rclone cat "${REMOTE}:${REMOTE_DIR}/${FILE}" | gunzip | psql_ -v ON_ERROR_STOP=1 >/dev/null; then
  echo "✅ 복원 완료. 앱 반영: pm2 restart ledger-api"
else
  echo "❌ 복원 실패."; exit 1
fi
```

---

## 7. 빠른 치트시트

```bash
# 목록
rclone lsf "gdrive:My Dev/Ledger" --files-only | sort

# 즉시 백업 1회
bash ~/db-backups/backup.sh

# 최근 백업으로 복구
bash ~/db-backups/restore.sh latest && pm2 restart ledger-api

# 호스트에서 컨테이너 안 복구 실행
CID=$(sudo docker ps -q --filter volume=coder-9273aa84-f606-4ca6-9913-33836d844b98-home)
sudo docker exec -it -u coder "$CID" bash ~/db-backups/restore.sh latest
```

> 주의: 복구는 **현재 데이터를 백업 시점으로 덮어쓴다.** 실행 전 정말 그 시점으로 되돌릴지 확인할 것.
