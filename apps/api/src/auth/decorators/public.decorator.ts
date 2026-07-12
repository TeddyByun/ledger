import { SetMetadata } from '@nestjs/common';

/** 인증 없이 접근 가능한 라우트 표시 (JwtAuthGuard 예외). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
