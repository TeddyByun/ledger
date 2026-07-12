import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { MemberRole } from '@prisma/client';
import type { AuthUser } from './decorators/current-user.decorator.js';

interface AccessPayload {
  sub: number;
  hid: number;
  role: MemberRole;
  email?: string;
}

/** Access 토큰(Bearer) 검증 → req.user 로 { userId, householdId, role } 주입. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  validate(payload: AccessPayload): AuthUser {
    return {
      userId: payload.sub,
      householdId: payload.hid,
      role: payload.role,
      email: payload.email,
    };
  }
}
