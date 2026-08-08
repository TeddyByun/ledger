#!/usr/bin/env bash
set -euo pipefail
shopt -s extglob

RST='\033[0m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'

json=$(cat)

# ── 성능 원칙 ──────────────────────────────────────────────────────────────
# statusline은 매 렌더마다 돈다. 그래서 외부 프로세스는 최소로만 쓴다:
#   jq 1회(모든 필드 한 번에) + stat 1회 + (burn 있을 때만) tail|jq 1쌍.
# 나머지 문자열 조립·폭 계산은 전부 bash 내장으로 처리하고, 헬퍼는 값을 echo
# 하지 않고 전역 REPLY에 담는다($(...)는 매번 fork라서).

col_for() {  # -> REPLY
  local p="$1"
  if (( p >= 80 )); then REPLY="$RED"
  elif (( p >= 50 )); then REPLY="$YELLOW"
  else REPLY="$GREEN"; fi
}

# n칸짜리 게이지(채움 비율 = pct). n=0이면 막대 없음.
barcells() {  # -> REPLY
  local pct="$1" n="$2" f e pad
  f=$(( (pct * n + 50) / 100 )); (( f > n )) && f=n; (( f < 0 )) && f=0  # 반올림(작은 막대도 살아있게)
  e=$(( n - f ))
  REPLY=""
  (( f > 0 )) && { printf -v pad '%*s' "$f" ''; REPLY+="${pad// /⣿}"; }
  (( e > 0 )) && { printf -v pad '%*s' "$e" ''; REPLY+="${pad// /⣀}"; }
  return 0   # set -e 주의: &&로 끝나면 조건이 거짓일 때 함수가 1을 반환해 스크립트가 죽는다
}

resets_in() {  # -> REPLY
  local ts="$1" now diff d h m
  REPLY=""
  [[ -z "$ts" || "$ts" == "null" ]] && return
  now=$EPOCHSECONDS; diff=$(( ts - now ))
  (( diff <= 0 )) && { REPLY="now"; return; }
  d=$(( diff/86400 )); h=$(( (diff%86400)/3600 )); m=$(( (diff%3600)/60 ))
  if (( d > 0 )); then REPLY="${d}d ${h}h"; elif (( h > 0 )); then REPLY="${h}h ${m}m"; else REPLY="${m}m"; fi
}

# 한 사용량 파트(raw 문자열; 색은 리터럴 \033 그대로 담아 마지막에 %b로 해석).
part() {  # -> REPLY
  local label="$1" pct="$2" reset="$3" n="$4" out
  col_for "$pct"; out="${REPLY}${label}"
  if (( n > 0 )); then barcells "$pct" "$n"; out+=" $REPLY"; fi
  out+=" ${pct}%"
  if [[ -n "$reset" ]]; then out+=" ${DIM}${reset}${RST}"; else out+="${RST}"; fi
  REPLY="$out"
}

SEP=" ${DIM}|${RST} "

# ── 입력 파싱: jq 1회로 전 필드를 US(0x1f) 구분자로 받는다 ─────────────────
# 구분자가 공백류면 read가 빈 필드를 뭉개므로 반드시 non-whitespace를 쓴다.
IFS=$'\x1f' read -r sid tp model five_h five_h_ts seven_d seven_d_ts ctx <<<"$(
  printf '%s' "$json" | jq -r '[
      .session_id // "x",
      .transcript_path // "",
      .model.display_name // "",
      .rate_limits.five_hour.used_percentage,
      .rate_limits.five_hour.resets_at,
      .rate_limits.seven_day.used_percentage,
      .rate_limits.seven_day.resets_at,
      .context_window.used_percentage
    ] | map(if . == null then "" else tostring end) | join("\u001f")' 2>/dev/null
)" || true

# ── burn(토큰 소모율) ──────────────────────────────────────────────────────
# 하니스가 burn을 안 줘서 transcript에 새로 쌓인 usage 토큰(캐시 제외 입력+출력) ÷ 경과시간으로 계산.
BURN_MIN_DT=8
fmt_burn() {  # -> REPLY
  local v="$1"
  if [[ -z "$v" ]]; then REPLY="—/h"
  elif (( v >= 1000000 )); then printf -v REPLY '%d.%dM/h' $(( v/1000000 )) $(( (v%1000000)/100000 ))
  elif (( v >= 1000 )); then printf -v REPLY '%dk/h' $(( v/1000 ))
  else REPLY="${v}/h"; fi
}

burn=""; arrow=""; have_burn=0
if [[ -n "$tp" && -f "$tp" ]]; then
  have_burn=1
  state="${TMPDIR:-/tmp}/claude_burn_${sid}"
  now=$EPOCHSECONDS
  sz=$(stat -c%s "$tp" 2>/dev/null || echo 0)
  if [[ -f "$state" ]]; then
    read -r p_ts p_off p_burn < "$state" || true
    [[ -z "${p_off:-}" ]] && p_off=$sz
    # 컨텍스트 압축 등으로 파일이 줄면 처음부터 다시 읽지 말고 기준점만 재동기화.
    # (예전엔 p_off=0으로 되돌려 26MB짜리를 통째로 재파싱 → 렌더 한 번에 450ms)
    if (( sz < p_off )); then
      echo "$now $sz ${p_burn:-}" > "$state"
      burn="${p_burn:-}"
      p_off=$sz; p_ts=$now
    fi
    dt=$(( now - p_ts ))
    if (( dt >= BURN_MIN_DT && sz >= p_off )); then
      # 줄 단위 스트리밍 파싱. -R -s 슬럽은 파일 전체를 문자열 하나로 올려서 느리다.
      dtok=$(tail -c "+$(( p_off + 1 ))" "$tp" 2>/dev/null \
        | jq -Rn '[ inputs | (fromjson? // empty) | .message.usage // empty | (.input_tokens//0)+(.output_tokens//0) ] | add // 0' 2>/dev/null || echo 0)
      [[ "$dtok" =~ ^[0-9]+$ ]] || dtok=0
      cur=$(( dtok * 3600 / dt ))
      if [[ -n "${p_burn:-}" && "$p_burn" =~ ^[0-9]+$ ]]; then
        if (( cur > p_burn )); then arrow="↑"; elif (( cur < p_burn )); then arrow="↓"; else arrow="·"; fi
      fi
      burn=$cur
      echo "$now $sz $cur" > "$state"
    else
      burn="${p_burn:-}"
    fi
  else
    echo "$now $sz" > "$state"
  fi
fi

# ── 사용량 값 ─────────────────────────────────────────────────────────────
# 값이 비었을 때 `[[ ]] && cmd`가 1을 반환해 set -e에 걸리지 않도록 전부 if로.
if [[ -n "$five_h" ]]; then printf -v five_h '%.0f' "$five_h"; fi
if [[ -n "$seven_d" ]]; then printf -v seven_d '%.0f' "$seven_d"; fi
if [[ -n "$ctx" ]]; then printf -v ctx '%.0f' "$ctx"; fi
five_h_reset=""; if [[ -n "$five_h_ts" ]]; then resets_in "$five_h_ts"; five_h_reset=$REPLY; fi
seven_d_reset=""; if [[ -n "$seven_d_ts" ]]; then resets_in "$seven_d_ts"; seven_d_reset=$REPLY; fi

burn_seg() {  # -> REPLY
  local acol="$DIM"
  [[ "$arrow" == "↑" ]] && acol="$RED"
  [[ "$arrow" == "↓" ]] && acol="$GREEN"
  fmt_burn "$burn"
  REPLY="${DIM}burn${RST} ${REPLY}${acol}${arrow}${RST}"
}

# 한 줄 조립: barN=막대칸수, sr=리셋시간표시, sm=model표시, sb=burn표시.
build() {  # -> REPLY
  local barN="$1" sr="$2" sm="$3" sb="$4"
  local segs=() s
  if (( sm )) && [[ -n "$model" ]]; then segs+=("${CYAN}${model% (*}${RST}"); fi
  if (( sb )) && (( have_burn )); then burn_seg; segs+=("$REPLY"); fi
  local r5="" r7=""
  (( sr )) && { r5="$five_h_reset"; r7="$seven_d_reset"; }
  if [[ -n "$five_h" ]]; then part "5h" "$five_h" "$r5" "$barN"; segs+=("$REPLY"); fi
  if [[ -n "$seven_d" ]]; then part "7d" "$seven_d" "$r7" "$barN"; segs+=("$REPLY"); fi
  if [[ -n "$ctx" ]]; then part "Ctx" "$ctx" "" "$barN"; segs+=("$REPLY"); fi
  local out="" first=1
  for s in "${segs[@]}"; do (( first )) || out+="$SEP"; first=0; out+="$s"; done
  REPLY="$out"
}

# 색(리터럴 \033[..m) 제거 후 표시 폭. ★ 브라유 막대문자(⣿·⣀)는 이 터미널에서 2칸 폭이라
# 문자 수 + 브라유 개수(칸당 +1)로 실제 표시폭을 잡는다(안 그러면 폭을 절반으로 과소평가 → Ctx 잘림).
vislen() {  # -> REPLY (정수)
  local s="${1//\\033\[*([0-9;])m/}" t
  t="${s//[⣿⣀]/}"
  REPLY=$(( ${#s} + ${#s} - ${#t} ))
}

cols=${COLUMNS:-100}; [[ "$cols" =~ ^[0-9]+$ ]] || cols=100; (( cols < 24 )) && cols=100
budget=$(( cols - 2 ))   # 화살표·em대시 등 폭 애매문자 여유 2칸

# 폭에 맞을 때까지 단계적으로 축소. 우선순위: 리셋시간은 최대한 지키고 **막대부터** 끝까지 줄인다(막대 10→…→0,
# 리셋 유지). 막대를 다 없애도 안 맞으면 그때 리셋시간 → model → burn 순으로 뺀다. Ctx 안 잘리는 게 최우선.
# (barN sr sm sb)
ladder=(
  "10 1 1 1" "8 1 1 1" "6 1 1 1" "5 1 1 1" "4 1 1 1" "3 1 1 1" "2 1 1 1" "1 1 1 1" "0 1 1 1"
  "0 0 1 1" "0 0 0 1" "0 0 0 0"
)
for combo in "${ladder[@]}"; do
  read -r a b c d <<< "$combo"
  build "$a" "$b" "$c" "$d"; line=$REPLY
  vislen "$line"
  if (( REPLY <= budget )); then
    printf '%b\n' "$line"; exit 0
  fi
done
# 다 안 맞으면 가장 축소된 형태라도 출력.
build 0 0 0 0
printf '%b\n' "$REPLY"
