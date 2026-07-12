import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';

/** 인증된 요청 사용자 (JwtStrategy.validate 반환값). */
export interface AuthUser {
  userId: number;
  householdId: number;
  role: MemberRole;
  email?: string;
}

/** 컨트롤러에서 현재 사용자 주입: `@CurrentUser() user: AuthUser` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
