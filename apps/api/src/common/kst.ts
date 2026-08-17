/**
 * 한국 시간(KST, UTC+9) 기준 '지금'.
 *
 * 서버 프로세스는 UTC 로 도는데(PM2/컨테이너 기본), 코드는 `getUTC*` 로 날짜를 읽는다.
 * 그래서 `new Date()` 를 그대로 쓰면 **KST 00:00~09:00 사이에 하루(혹은 한 달) 밀린다.**
 * 예) KST 2026-09-01 07:00 → UTC 2026-08-31 22:00 → '이번 달'이 8월로 계산됨.
 *
 * 이 함수는 UTC+9 를 더한 Date 를 돌려주므로, 그 위에서 `getUTCFullYear()/getUTCMonth()/
 * getUTCDate()` 를 호출하면 **KST 기준 연·월·일**을 얻는다.
 *
 * ⚠️ 반환값은 "표시용 시각 좌표"다. **DB 조회 경계로 그대로 쓰지 말 것** —
 * 경계는 지금처럼 `Date.UTC(y, m, d)` 로 만들어 저장값(UTC)과 비교한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowKst(): Date {
  return new Date(Date.now() + KST_OFFSET_MS);
}

/** KST 기준 오늘의 'YYYY-MM' */
export function currentYmKst(): string {
  const d = nowKst();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
