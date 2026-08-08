import { AsyncLocalStorage } from 'node:async_hooks';
import type { MemberRole } from '@prisma/client';

/**
 * 요청 스코프 테넌트 컨텍스트 (AUTH_DESIGN §4.3).
 * 인증된 요청의 { userId, householdId, role } 을 AsyncLocalStorage 로 전파한다.
 * Phase 2 에서 도메인 쿼리 스코핑(Prisma 확장)이 이 값을 읽어 householdId 를 자동 주입한다.
 */
export interface TenantContext {
  userId: number;
  householdId: number;
  role: MemberRole;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** 현재 테넌트(없으면 undefined — 공개 라우트/시스템 작업). */
export function getTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/** 현재 테넌트(없으면 예외 — 스코프가 반드시 필요한 경로). */
export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error('테넌트 컨텍스트가 없습니다 (인증이 필요한 작업).');
  }
  return ctx;
}

/**
 * 테넌트 스코프를 벗어나 콜백을 실행한다(전체 운영 관리자의 가구 경계 초월 작업 전용).
 * AsyncLocalStorage.exit 로 현재 스토어를 비워 getTenant()=undefined → Prisma 미들웨어의
 * householdId 자동 주입을 건너뛴다. 반드시 명시적 where/data 로 대상 가구를 지정할 것.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  return tenantStorage.exit(fn);
}

/**
 * 지정한 테넌트 컨텍스트로 콜백을 실행한다(시스템 운영자가 임의 가구를 대상으로 작업할 때).
 * 기존 가구 스코프 서비스(HouseholdService 등)를 대상 가구에 그대로 재사용할 수 있다.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}
