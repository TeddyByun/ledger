/**
 * Jest — ESM + TypeScript(NestJS).
 *
 * apps/api 는 `"type": "module"` 이라 ESM 모드로 돌려야 한다. 따라서
 *   - `NODE_OPTIONS=--experimental-vm-modules` 가 필요하다(package.json 의 test 스크립트가 붙여준다)
 *   - 소스가 ESM 규약대로 `../x.js` 로 import 하므로 moduleNameMapper 로 `.js` 를 벗겨 `.ts` 를 찾게 한다
 *
 * 테스트 종류는 `projects` 로 나눈다 — 단위는 DB 없이 즉시, 통합/e2e 는 테스트 DB 필요.
 * (TEST_STRATEGY_DESIGN.md §1·§5)
 */

/** 소스의 ESM 확장자(.js) → TS 소스 해석 + 워크스페이스 패키지 매핑 */
const moduleNameMapper = {
  '^@ledger/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  '^(\\.{1,2}/.*)\\.js$': '$1',
};

const transform = {
  '^.+\\.tsx?$': [
    'ts-jest',
    {
      useESM: true,
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: {
        // TS151002: module=NodeNext 에 isolatedModules 를 권고하는 경고.
        // 실제로 켜면 emitDecoratorMetadata 와 충돌해(TS1272) Nest 컨트롤러가
        // 컴파일되지 않으므로 경고만 끈다.
        ignoreCodes: [151002],
      },
    },
  ],
};

const common = {
  rootDir: '.',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper,
  transform,
  moduleFileExtensions: ['ts', 'js', 'json'],
  // 결정성: 시간대를 KST 로 고정한다(TEST_STRATEGY §3 결정성).
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};

export default {
  // 커버리지는 루트 설정에서만 집계한다(projects 별로 쪼개지 않도록).
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/dto/**',
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  // 핵심 모듈 임계값 — TEST_STRATEGY §1. 커버리지가 채워지는 대로 단계적으로 올린다.
  coverageThreshold: {
    // 전역 게이트는 테스트가 쌓이기 전까지 두지 않는다(0 으로 두면 리포트만 남는다).
    global: { lines: 0 },
  },
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      // 테스트 DB truncate/재시드 훅
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
      setupFilesAfterEnv: ['<rootDir>/test/integration/setup-db.ts'],
      maxWorkers: 1,
    },
    {
      ...common,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
      setupFilesAfterEnv: ['<rootDir>/test/integration/setup-db.ts'],
      maxWorkers: 1,
    },
  ],
};
