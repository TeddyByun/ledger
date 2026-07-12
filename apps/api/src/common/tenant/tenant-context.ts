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
