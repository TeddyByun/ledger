import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenService } from './token.service.js';
import { SignupDto, LoginDto } from './dto/auth.dto.js';

export interface SessionResult {
  accessToken: string;
  refresh: { token: string; expiresAt: Date };
  user: { id: number; email: string; displayName: string | null };
  household: { id: number; name: string; role: MemberRole };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** 회원가입 → 기본 가구 생성(owner) → 세션 발급 (AUTH_DESIGN §5). */
  async signup(dto: SignupDto, userAgent?: string): Promise<SessionResult> {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('EMAIL_TAKEN');

    const passwordHash = await argon2.hash(dto.password);
    const { user, household } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? null,
        },
      });
      const household = await tx.household.create({
        data: { name: dto.householdName ?? `${dto.displayName ?? '나'}의 가구` },
      });
      await tx.membership.create({
        data: { userId: user.id, householdId: household.id, role: 'owner' },
      });
      return { user, household };
    });

    return this.issueSession(user, household, 'owner', userAgent);
  }

  /** 로그인 → 활성 가구(첫 멤버십)로 세션 발급. */
  async login(dto: LoginDto, userAgent?: string): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { memberships: { include: { household: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('INVALID_CREDENTIALS');

    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException('NO_HOUSEHOLD');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(
      user,
      membership.household,
      membership.role,
      userAgent,
    );
  }

  /** Refresh 회전 → 새 Access + Refresh. */
  async refresh(token: string, userAgent?: string): Promise<SessionResult> {
    const rotated = await this.tokens.rotate(token, userAgent);
    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
      include: { memberships: { include: { household: true } } },
    });
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException('NO_HOUSEHOLD');

    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      hid: membership.householdId,
      role: membership.role,
      email: user.email,
    });
    return {
      accessToken,
      refresh: { token: rotated.token, expiresAt: rotated.expiresAt },
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      household: {
        id: membership.household.id,
        name: membership.household.name,
        role: membership.role,
      },
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.tokens.revoke(token);
  }

  /** 내 프로필 + 소속 가구/역할 (AUTH_DESIGN §5 /auth/me). */
  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { household: true } } },
    });
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      households: user.memberships.map((m) => ({
        id: m.household.id,
        name: m.household.name,
        role: m.role,
      })),
    };
  }

  private async issueSession(
    user: { id: number; email: string; displayName: string | null },
    household: { id: number; name: string },
    role: MemberRole,
    userAgent?: string,
  ): Promise<SessionResult> {
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      hid: household.id,
      role,
      email: user.email,
    });
    const refresh = await this.tokens.issueRefresh(user.id, undefined, userAgent);
    return {
      accessToken,
      refresh,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      household: { id: household.id, name: household.name, role },
    };
  }
}
