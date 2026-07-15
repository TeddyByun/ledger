import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { MemberRole, Household, HouseholdMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenService } from './token.service.js';
import { SignupDto, LoginDto } from './dto/auth.dto.js';

export interface SessionResult {
  accessToken: string;
  refresh: { token: string; expiresAt: Date };
  user: { id: number; email: string | null; displayName: string | null };
  household: { id: number; name: string; role: MemberRole };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** 회원가입 → 가구 생성 + 가입자를 owner·본인 구성원으로 생성 (User/Member 통합). */
  async signup(dto: SignupDto, userAgent?: string): Promise<SessionResult> {
    const exists = await this.prisma.householdMember.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('EMAIL_TAKEN');

    const passwordHash = await argon2.hash(dto.password);
    const { member, household } = await this.prisma.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: { name: dto.householdName ?? `${dto.displayName ?? '나'}의 가구` },
      });
      const member = await tx.householdMember.create({
        data: {
          householdId: household.id,
          name: dto.displayName ?? dto.email,
          email: dto.email,
          passwordHash,
          role: 'owner',
          isSelf: true,
          relation: 'self',
        },
      });
      return { member, household };
    });

    return this.issueSession(member, household, 'owner', userAgent);
  }

  /** 로그인 → 로그인 가능한 구성원(email/passwordHash 보유) 검증. */
  async login(dto: LoginDto, userAgent?: string): Promise<SessionResult> {
    const member = await this.prisma.householdMember.findUnique({
      where: { email: dto.email },
      include: { household: true },
    });
    if (!member || !member.passwordHash || !member.isActive) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const ok = await argon2.verify(member.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('INVALID_CREDENTIALS');

    await this.prisma.householdMember.update({
      where: { id: member.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(member, member.household, member.role, userAgent);
  }

  /** Refresh 회전 → 새 Access + Refresh. */
  async refresh(token: string, userAgent?: string): Promise<SessionResult> {
    const rotated = await this.tokens.rotate(token, userAgent);
    const member = await this.prisma.householdMember.findUnique({
      where: { id: rotated.memberId },
      include: { household: true },
    });
    if (!member) throw new UnauthorizedException('UNAUTHENTICATED');

    const accessToken = await this.tokens.signAccess({
      sub: member.id,
      hid: member.householdId,
      role: member.role,
      email: member.email ?? undefined,
    });
    return {
      accessToken,
      refresh: { token: rotated.token, expiresAt: rotated.expiresAt },
      user: { id: member.id, email: member.email, displayName: member.name },
      household: {
        id: member.household.id,
        name: member.household.name,
        role: member.role,
      },
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.tokens.revoke(token);
  }

  /** 내 프로필 + 소속 가구/역할. */
  async me(memberId: number) {
    const member = await this.prisma.householdMember.findUnique({
      where: { id: memberId },
      include: { household: true },
    });
    if (!member) throw new UnauthorizedException('UNAUTHENTICATED');
    return {
      id: member.id,
      email: member.email,
      displayName: member.name,
      households: [
        {
          id: member.household.id,
          name: member.household.name,
          role: member.role,
        },
      ],
    };
  }

  private async issueSession(
    member: HouseholdMember,
    household: Household,
    role: MemberRole,
    userAgent?: string,
  ): Promise<SessionResult> {
    const accessToken = await this.tokens.signAccess({
      sub: member.id,
      hid: household.id,
      role,
      email: member.email ?? undefined,
    });
    const refresh = await this.tokens.issueRefresh(
      member.id,
      undefined,
      userAgent,
    );
    return {
      accessToken,
      refresh,
      user: { id: member.id, email: member.email, displayName: member.name },
      household: { id: household.id, name: household.name, role },
    };
  }
}
