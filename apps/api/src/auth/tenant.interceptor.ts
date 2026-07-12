import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantStorage } from '../common/tenant/tenant-context.js';
import type { AuthUser } from './decorators/current-user.decorator.js';

/**
 * 인증된 요청의 { userId, householdId, role } 을 AsyncLocalStorage 에 채운다.
 * 가드(JwtAuthGuard) 이후 실행되므로 req.user 가 존재한다.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.householdId) return next.handle();

    return new Observable((subscriber) => {
      tenantStorage.run(
        { userId: user.userId, householdId: user.householdId, role: user.role },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}
