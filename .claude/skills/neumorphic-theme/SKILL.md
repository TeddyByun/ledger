---
name: neumorphic-theme
description: 가계부(Ledger) 웹의 뉴모피즘/글래스모피즘 다크 테마 디자인 시스템. UI를 이 스타일(보라→청록 그라데이션 포인트, 부드러운 볼록/오목 그림자, 다크 보라 배경)로 만들거나 수정할 때 사용. 컴포넌트 스타일링, globals.css 토큰, 카드·버튼·입력·차트 표현 규칙을 정의한다.
---

# 뉴모피즘 다크 테마 (가계부 · Ledger)

이미지 레퍼런스("4 Key Types of Morphism") 기반의 **뉴모피즘 + 글래스모피즘 다크 테마**.
어두운 보라 배경 위에서 부드러운 이중 그림자로 표면을 볼록/오목하게 표현하고,
보라→청록 그라데이션을 브랜드 포인트로 쓴다.

- 살아있는 미리보기: `apps/web/public/neumorphic.html` (→ `http://localhost:3000/neumorphic.html`)
- 실제 적용 대상: `apps/web/src/app/globals.css` (전 화면이 공통 클래스 기반이라 토큰 교체로 일괄 반영)

## 핵심 원칙

1. **다크 중심.** 배경은 `#1b1832` + 좌상단 보라/우상단 청록 radial glow.
2. **뉴모피즘 = 이중 그림자.** 표면은 배경과 같은 계열 색 + `밝은 그림자(좌상)` & `어두운 그림자(우하)`.
   눌린/입력 요소는 `inset` 그림자(오목).
3. **그라데이션은 포인트만.** 보라→청록(`--grad`)은 활성 메뉴·주 버튼·토글 ON·로고·진행바에만.
   전체를 그라데이션으로 덮지 않는다.
4. **의미색 유지(가독성).** 금액의 **수입=파랑 `--income`**, **지출=빨강 `--expense`**는 절대 그라데이션/보라로 바꾸지 않는다. 색맹 안전 + 한눈 구분 목적.
5. **텍스트는 또렷하게.** 뉴모피즘의 약점(저대비)을 피하려 본문/금액/라벨은 명확한 잉크색으로,
   그림자는 표면(카드/버튼/입력)에만 준다. 텍스트에 그림자 금지.
6. **넉넉한 라운드.** 카드 `--r-lg:24px`, 기본 `--r:18px`, 소형 `--r-sm:12px`.
7. **포커스 링 유지.** `:focus` 시 `0 0 0 2px rgba(168,85,247,.4)`로 접근성 확보.

## 디자인 토큰 (다크)

```css
:root{
  --canvas:#1b1832; --surface:#241f42; --surface-2:#1e1a3a; --surface-3:#2a2550;
  --ink:#ECEAFB; --ink-2:#BBB5E4; --muted:#8B84BE; --faint:#655E92;
  --line:#332d5c; --line-2:#3d3668;
  --brand-a:#A855F7; --brand-b:#22D3EE; --brand:#9D6BF0; --brand-ink:#C9AEFF; --brand-soft:#2b2358;
  --income:#5E9BF0; --income-soft:#1b2748; --expense:#F26D5B; --expense-soft:#3a2033;
  --good:#34D399; --warn:#FBBF24;
  --grad:linear-gradient(135deg,var(--brand-a),var(--brand-b));
  --nm-out:-6px -6px 16px rgba(255,255,255,.045), 8px 8px 22px rgba(0,0,0,.5);
  --nm-out-sm:-3px -3px 8px rgba(255,255,255,.04), 4px 4px 12px rgba(0,0,0,.45);
  --nm-in:inset 3px 3px 8px rgba(0,0,0,.55), inset -3px -3px 8px rgba(255,255,255,.045);
  --nm-in-sm:inset 2px 2px 5px rgba(0,0,0,.5), inset -2px -2px 5px rgba(255,255,255,.04);
  --r-sm:12px; --r:18px; --r-lg:24px;
}
body{ background:
  radial-gradient(1200px 600px at 15% -10%, rgba(168,85,247,.18), transparent 60%),
  radial-gradient(1000px 500px at 100% 0%, rgba(34,211,238,.12), transparent 55%),
  var(--canvas); }
```

## 컴포넌트 매핑 규칙

| 요소 | 표현 |
|---|---|
| 카드 `.card` | `background:var(--surface)` + `box-shadow:var(--nm-out)`, `border-radius:var(--r-lg)` |
| 입력 `.input`/`.select` | `background:var(--surface-2)` + `box-shadow:var(--nm-in)` (오목) |
| 기본 버튼 `.btn` | 표면색 + `--nm-out-sm`, `:active`시 `--nm-in`(눌림) |
| 주 버튼 `.btn.primary` | `background:var(--grad)` + 보라 글로우 그림자, 텍스트 흰색 |
| 활성 메뉴 `.nav a.active` | `background:var(--grad)` + 글로우, 흰 텍스트 |
| 토글 ON | `background:var(--grad)`; OFF는 `--nm-in` 오목 트랙 |
| 진행/슬라이더 fill | `background:var(--grad)` + 은은한 글로우 |
| 태그/칩 `.tag` | 오목(`--nm-in-sm`) 알약 |
| 차트 막대 | 수입=`var(--income)`, 지출=`var(--expense)`, `rx:3~4` 둥근 상단 |

## 적용 절차

1. `apps/web/public/neumorphic.html`로 방향 확인(미리보기).
2. 승인되면 위 토큰 블록을 `globals.css`의 `:root`(및 다크 미디어쿼리)에 반영.
3. 기존 클래스(`.card`,`.btn`,`.nav`,`.input`,`.select`,`.hh`,`.logo` 등)의 `box-shadow`/`border`/`radius`를
   위 매핑 규칙대로 교체. 뷰(`*.tsx`)는 대부분 수정 불필요.
4. `--income`/`--expense`는 손대지 않는다.
5. `pnpm build`로 확인 후 웹 재기동.

## 하지 말 것

- 텍스트·금액을 그라데이션/보라로 칠하기 (가독성·의미색 훼손).
- 표면 그림자를 텍스트에 적용.
- 전체 배경을 강한 그라데이션으로 덮어 대비 저하.
- 라이트 모드를 기본으로 두기 (이 테마는 다크 중심).
