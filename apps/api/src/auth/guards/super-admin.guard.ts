import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/**
 * 전체 운영(플랫폼) 관리자 전용 가드.
 * JwtAuthGuard(전역) 이후 실행 — req.user.isSuperAdmin 이 true 인 경우에만 통과.
 * 가구 경계를 넘는 전역 조회/관리 라우트에 @UseGuards(SuperAdminGuard) 로 부착한다.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user || user.isSuperAdmin !== true) {
      throw new ForbiddenException('SUPER_ADMIN_ONLY');
    }
    return true;
  }
}
