import { z } from 'zod';

/**
 * 환경변수 스키마 — 부팅 시 1회 검증(fail-fast). INFRA_OPS_DESIGN §1.3.
 * 알 수 없는 키는 통과(process.env 에는 다수의 무관 변수가 존재).
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  // 인증 (Phase 1)
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // 저장소 (Phase 3 → 6)
  STORAGE_DRIVER: z.enum(['local', 'google']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

export type Env = z.infer<typeof envSchema>;

/** ConfigModule.forRoot({ validate }) 에 전달. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }
  return parsed.data;
}
