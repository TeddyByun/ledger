#!/usr/bin/env bash
#
# install-codex.sh - OpenAI Codex CLI 를 공식 설치 스크립트로 설치하고
#                    PATH 등록 + 단축 별칭(cdd / cdc)까지 설정합니다.
#
# 사용법:
#   ./install-codex.sh                 # 설치 (최신 버전)
#   ./install-codex.sh --version 0.153.4      # 특정 버전 설치
#   ./install-codex.sh --uninstall     # 제거 (별칭/PATH 블록까지 정리)
#   ./install-codex.sh --help
#
# 만들어지는 별칭:
#   cdd -> codex --yolo           (승인 없이 바로 실행)
#   cdc -> codex resume --yolo    (이전 세션 이어서 실행)
#
# 주의: --yolo 는 --dangerously-bypass-approvals-and-sandbox 의 별칭입니다.
#       샌드박스와 승인 절차를 모두 건너뛰므로 신뢰하는 환경에서만 쓰세요.
#
set -euo pipefail

INSTALL_URL="https://chatgpt.com/codex/install.sh"
BIN_DIR="${CODEX_INSTALL_DIR:-$HOME/.local/bin}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
ALIAS_FILE="$HOME/.bash_aliases"
BASHRC="$HOME/.bashrc"

ALIAS_BEGIN="# >>> codex aliases >>>"
ALIAS_END="# <<< codex aliases <<<"
PATH_BEGIN="# >>> codex path >>>"
PATH_END="# <<< codex path <<<"

VERSION="latest"
DO_UNINSTALL=0
PURGE=0

# ------------------------------------------------------------------ 로그 유틸
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RED=$(tput setaf 1); C_GRN=$(tput setaf 2); C_YLW=$(tput setaf 3)
  C_BLU=$(tput setaf 4); C_RST=$(tput sgr0)
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_RST=""
fi

info() { printf '%s==>%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s[!]%s  %s\n' "$C_YLW" "$C_RST" "$*" >&2; }
die()  { printf '%s[X]%s  %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

usage() { sed -n '3,17p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; exit 0; }

# ------------------------------------------------------------------ 인자 파싱
while [ $# -gt 0 ]; do
  case "$1" in
    --version)   VERSION="${2:-}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    --purge)     DO_UNINSTALL=1; PURGE=1; shift ;;
    -h|--help)   usage ;;
    *)           die "알 수 없는 옵션: $1  (--help 참고)" ;;
  esac
done

# ------------------------------------------------------------- 블록 삽입/제거
# 마커로 감싼 블록을 파일에서 지웁니다 (없으면 아무것도 안 함).
remove_block() {
  local file="$1" begin="$2" end="$3" tmp
  [ -f "$file" ] || return 0
  grep -qF "$begin" "$file" || return 0
  tmp="$(mktemp)"
  awk -v b="$begin" -v e="$end" '
    index($0, b) { skip = 1 }
    skip != 1    { print }
    index($0, e) { skip = 0 }
  ' "$file" > "$tmp"
  # 심볼릭 링크와 파일 권한을 유지하려고 mv 대신 덮어쓰기를 씁니다.
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# 블록을 파일 끝에 새로 씁니다. 기존 블록이 있으면 최신 내용으로 갈아끼웁니다.
write_block() {
  local file="$1" begin="$2" end="$3" lastchar
  shift 3
  touch "$file"
  remove_block "$file" "$begin" "$end"
  if [ -s "$file" ]; then
    lastchar="$(tail -c1 "$file" | od -An -c | tr -d ' \n')"
    [ "$lastchar" = '\n' ] || printf '\n' >> "$file"
    printf '\n' >> "$file"
  fi
  {
    printf '%s\n' "$begin"
    printf '%s\n' "$@"
    printf '%s\n' "$end"
  } >> "$file"
}

# ---------------------------------------------------------------- PATH / 별칭
# 공식 설치 스크립트도 PATH 를 등록하지만, 어느 rc 파일을 고를지는 환경에 따라
# 달라집니다. 대화형 셸(.bashrc)에서 확실히 잡히도록 여기서 한 번 더 보장합니다.
register_path() {
  if grep -qsF "\$HOME/.local/bin" "$BASHRC" && [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
    ok "PATH 이미 등록됨: $BASHRC"
    return
  fi
  write_block "$BASHRC" "$PATH_BEGIN" "$PATH_END" \
    'case ":$PATH:" in' \
    "  *\":$BIN_DIR:\"*) ;;" \
    "  *) export PATH=\"$BIN_DIR:\$PATH\" ;;" \
    'esac'
  ok "PATH 등록: $BASHRC"
}

register_aliases() {
  write_block "$ALIAS_FILE" "$ALIAS_BEGIN" "$ALIAS_END" \
    "# cdd: 승인/샌드박스 없이 바로 실행, cdc: 이전 세션 이어서 실행" \
    "alias cdd='codex --yolo'" \
    "alias cdc='codex resume --yolo'"
  ok "별칭 등록: $ALIAS_FILE  (cdd, cdc)"

  # 우분투 기본 .bashrc 는 ~/.bash_aliases 를 읽지만, 커스텀 환경이면 없을 수 있습니다.
  if ! grep -qsF '.bash_aliases' "$BASHRC"; then
    warn "$BASHRC 가 ~/.bash_aliases 를 읽지 않습니다. 다음 줄을 직접 추가하세요:"
    printf '      [ -f ~/.bash_aliases ] && . ~/.bash_aliases\n'
  fi
}

# ---------------------------------------------------------------------- 설치
install_codex() {
  local dl
  if command -v curl >/dev/null 2>&1; then
    dl="curl -fsSL $INSTALL_URL"
  elif command -v wget >/dev/null 2>&1; then
    dl="wget -qO- $INSTALL_URL"
  else
    die "curl 또는 wget 이 필요합니다: sudo apt-get install -y curl"
  fi

  info "공식 설치 스크립트 실행: $INSTALL_URL"
  # 공식 설치 스크립트는 설치를 마치고도 0이 아닌 코드로 끝날 때가 있습니다.
  # pipefail + set -e 조합에서 그대로 두면 여기서 스크립트가 죽어
  # 뒤따르는 PATH/별칭 등록이 통째로 건너뛰어집니다. 그래서 종료 코드를
  # 신뢰하지 않고, 실제로 바이너리가 생겼는지로 성공 여부를 판단합니다.
  local rc=0
  if [ "$VERSION" = "latest" ]; then
    $dl | sh || rc=$?
  else
    $dl | sh -s -- --release "$VERSION" || rc=$?
  fi

  if [ "$rc" -ne 0 ]; then
    if [ -x "$BIN_DIR/codex" ]; then
      warn "설치 스크립트가 코드 $rc 로 끝났지만 $BIN_DIR/codex 는 만들어졌습니다. 계속 진행합니다."
    else
      die "설치 스크립트가 코드 $rc 로 실패했고 $BIN_DIR/codex 도 없습니다."
    fi
  fi
}

# ---------------------------------------------------------------------- 제거
uninstall() {
  info "codex 제거를 진행합니다."

  if [ -e "$BIN_DIR/codex" ]; then
    rm -f "$BIN_DIR/codex" "$BIN_DIR/codex-code-mode-host"
    ok "삭제: $BIN_DIR/codex"
  fi

  # 공식 설치 스크립트가 넣은 블록과 이 스크립트가 넣은 블록을 모두 정리합니다.
  local f
  for f in "$BASHRC" "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    [ -f "$f" ] || continue
    remove_block "$f" "# >>> Codex installer >>>" "# <<< Codex installer <<<"
    remove_block "$f" "$PATH_BEGIN" "$PATH_END"
  done
  remove_block "$ALIAS_FILE" "$ALIAS_BEGIN" "$ALIAS_END"
  ok "PATH / 별칭 설정 제거"

  if [ "$PURGE" -eq 1 ]; then
    rm -rf "$CODEX_HOME_DIR"
    ok "삭제: $CODEX_HOME_DIR (로그인 토큰·세션 기록 포함)"
  else
    warn "설정 디렉터리($CODEX_HOME_DIR)는 남겨 두었습니다. 함께 지우려면 --purge 를 쓰세요."
  fi

  ok "제거 완료. 새 셸을 열거나 'exec \$SHELL -l' 을 실행하세요."
  exit 0
}

# ---------------------------------------------------------------------- 검증
verify() {
  # 이 스크립트 프로세스에도 즉시 반영해 아래 확인이 통과하도록 합니다.
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) export PATH="$BIN_DIR:$PATH" ;;
  esac
  hash -r 2>/dev/null || true

  [ -x "$BIN_DIR/codex" ] || die "설치가 끝났는데 $BIN_DIR/codex 를 찾지 못했습니다."
  ok "codex 실행 확인: $BIN_DIR/codex - $("$BIN_DIR/codex" --version 2>/dev/null || echo '버전 확인 실패')"

  # --yolo 는 도움말에 안 나오는 숨은 별칭이라 실제로 받아들이는지 확인합니다.
  if "$BIN_DIR/codex" --yolo --version >/dev/null 2>&1; then
    ok "--yolo 플래그 확인"
  else
    warn "이 버전은 --yolo 를 받지 않습니다. 별칭을 다음으로 바꿔야 할 수 있습니다:"
    printf '      alias cdd=%s\n' "'codex --dangerously-bypass-approvals-and-sandbox'"
  fi
}

# ----------------------------------------------------------------------- main
main() {
  case "$(uname -s)" in
    Linux|Darwin) ;;
    *) die "이 스크립트는 Linux/macOS 전용입니다. 현재: $(uname -s)" ;;
  esac

  if [ "$(id -u)" -eq 0 ] && [ -z "${ALLOW_ROOT:-}" ]; then
    warn "root 로 실행 중입니다. codex 는 일반 사용자 계정에 설치하는 것을 권장합니다."
    die "그래도 계속하려면 ALLOW_ROOT=1 을 붙여 실행하세요."
  fi

  [ "$DO_UNINSTALL" -eq 1 ] && uninstall

  install_codex
  register_path
  register_aliases
  verify

  printf '\n%s설치가 끝났습니다.%s\n' "$C_GRN" "$C_RST"
  printf '  - 별칭 적용:  source ~/.bashrc   (또는 새 터미널)\n'
  printf '  - 로그인:     codex login   (ChatGPT 계정으로 로그인)\n'
  printf '  - 실행:       cdd           (= codex --yolo)\n'
  printf '  - 이어하기:   cdc           (= codex resume --yolo)\n'
  printf '  - 제거:       %s --uninstall  (설정까지: --purge)\n' "$0"
}

main "$@"
