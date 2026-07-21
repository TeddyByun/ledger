#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Coder 워크스페이스 부팅 스크립트 — API(:4000)/웹(:3000) 상시 기동
#
# 이 컨테이너는 PID1 이 coder agent 라 systemd/cron 을 쓸 수 없다.
# 그래서 워크스페이스가 뜰 때 이 스크립트가 PM2 로 서비스를 올린다.
#
# 사용법 — Coder 템플릿(main.tf)의 coder_agent 리소스에 추가:
#   resource "coder_agent" "main" {
#     startup_script_behavior = "blocking"   # 선택
#     startup_script = <<-EOT
#       #!/usr/bin/env bash
#       bash /home/coder/ledger/scripts/coder-startup.sh
#     EOT
#   }
#
# 수동 실행도 가능:  bash ~/ledger/scripts/coder-startup.sh
# 로그:              ~/ledger/.pm2-logs/startup.log
# ══════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="${LEDGER_ROOT:-/home/coder/ledger}"
LOG_DIR="$ROOT/.pm2-logs"
LOG="$LOG_DIR/startup.log"
mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1
echo "───────── $(date -Is) startup 시작 ─────────"

# pm2 는 사용자 홈(~/.local)에 설치돼 있다. 비대화형 셸이라 PATH 를 직접 잡아준다.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_ENV=production

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── 1) pm2 준비 (없으면 설치) ────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  log "pm2 미설치 → ~/.local 에 설치"
  npm install -g --prefix "$HOME/.local" pm2 || { log "ERROR pm2 설치 실패"; exit 1; }
fi
log "pm2 $(pm2 --version 2>/dev/null)"

# ── 2) 의존 서비스(postgres) 대기 ────────────────────────────────
# DB 가 아직 안 떴는데 API 를 올리면 크래시 루프가 된다. 최대 60초 대기.
wait_tcp() {
  local host=$1 port=$2 tries=${3:-60}
  for _ in $(seq 1 "$tries"); do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then exec 3<&- 2>/dev/null; return 0; fi
    sleep 1
  done
  return 1
}
if wait_tcp 127.0.0.1 5432 60; then
  log "postgres:5432 준비됨"
else
  log "WARN postgres:5432 미도달 — API 가 재시도할 수 있음 (docker compose up -d 확인 필요)"
fi

# ── 3) 빌드 산출물 확인 (없으면 빌드) ────────────────────────────
if [ ! -f "$ROOT/apps/api/dist/main.js" ]; then
  log "api 빌드 산출물 없음 → 빌드"
  (cd "$ROOT/apps/api" && pnpm build) || log "ERROR api 빌드 실패"
fi
if [ ! -d "$ROOT/apps/web/.next" ]; then
  log "web 빌드 산출물 없음 → 빌드"
  (cd "$ROOT/apps/web" && pnpm build) || log "ERROR web 빌드 실패"
fi

# ── 4) PM2 기동 (멱등: 없으면 start, 있으면 restart) ─────────────
cd "$ROOT" || { log "ERROR $ROOT 없음"; exit 1; }
pm2 startOrRestart "$ROOT/ecosystem.config.cjs" || { log "ERROR pm2 기동 실패"; exit 1; }
pm2 save >/dev/null 2>&1

# ── 5) 헬스체크 ─────────────────────────────────────────────────
ok_api=0; ok_web=0
for _ in $(seq 1 30); do
  [ "$ok_api" -eq 0 ] && curl -fsS -o /dev/null "http://127.0.0.1:4000/api/v1/docs" 2>/dev/null && ok_api=1
  [ "$ok_web" -eq 0 ] && curl -fsS -o /dev/null "http://127.0.0.1:3000/" 2>/dev/null && ok_web=1
  [ "$ok_api" -eq 1 ] && [ "$ok_web" -eq 1 ] && break
  sleep 1
done
log "헬스체크 — api:$([ $ok_api -eq 1 ] && echo OK || echo FAIL) web:$([ $ok_web -eq 1 ] && echo OK || echo FAIL)"
pm2 status --no-color 2>/dev/null | sed 's/^/    /'
log "startup 완료"
