/**
 * 통합/e2e 스위트 1회 준비 (TEST_STRATEGY_DESIGN.md §3).
 *
 * 실제 PostgreSQL 을 쓴다(SQLite 대체 금지 — `ledger` 스키마·Decimal·PG 전용 동작 정합).
 * 운영/개발 DB 를 건드리지 않도록 **전용 TEST_DATABASE_URL 을 요구**한다.
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      [
        '통합/e2e 테스트에는 전용 테스트 DB 가 필요합니다.',
        '',
        '  # docker-compose 의 postgres 에 테스트 DB 를 하나 만든 뒤:',
        "  export TEST_DATABASE_URL='postgresql://ledger:ledger@localhost:5432/ledger_test?schema=ledger'",
        '',
        '개발 DB 를 그대로 쓰면 truncate 로 데이터가 날아가므로 의도적으로 막아둔 검사입니다.',
      ].join('\n'),
    );
  }

  // 개발/운영 DB 오지정 가드 — DB 이름에 test 가 없으면 거부한다.
  if (!/test/i.test(url)) {
    throw new Error(
      `TEST_DATABASE_URL 의 DB 이름에 'test' 가 없습니다: ${url}\n` +
        '실수로 개발/운영 DB 를 truncate 하는 것을 막기 위한 가드입니다.',
    );
  }

  // Prisma 가 이 URL 을 쓰도록 덮어쓴다(자식 프로세스와 테스트 워커 모두).
  process.env.DATABASE_URL = url;

  // 최신 스키마 적용 + 코드성 마스터 시드
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  execSync('pnpm exec tsx prisma/seed.ts', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
