import { SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';

/** 라우트에 요구 역할을 지정 (RolesGuard 가 검사). 예: @Roles('owner') */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
