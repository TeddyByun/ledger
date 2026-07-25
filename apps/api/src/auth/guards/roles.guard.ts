import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/** @Roles(...) 메타데이터와 요청 사용자 역할을 비교 (AUTH_DESIGN §4.2). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 안전한(읽기) 메서드 — @Roles 미지정 라우트에서 viewer 도 허용. */
  private static readonly READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MemberRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;

    // @Roles 명시 시: 해당 역할만 허용.
    if (required && required.length > 0) {
      if (!user || !required.includes(user.role)) {
        throw new ForbiddenException('FORBIDDEN');
      }
      return true;
    }

    // @Roles 미지정 기본 정책 — 쓰기(POST/PATCH/PUT/DELETE)는 viewer 거부(읽기 전용).
    // user 가 없으면 공개(@Public) 라우트다(JwtAuthGuard 가 이미 통과시킴) → 관여하지 않는다.
    if (user && user.role === 'viewer' && !RolesGuard.READ_METHODS.has(req.method)) {
      throw new ForbiddenException('READ_ONLY');
    }
    return true;
  }
}
