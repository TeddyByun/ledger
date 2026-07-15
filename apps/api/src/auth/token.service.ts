import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AccessClaims {
  sub: number;
  hid: number;
  role: MemberRole;
  email?: string;
}

/** 초 단위로 '15m' / '30d' / '3600' 같은 표기를 파싱. */
function durationToMs(v: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(v.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const mult = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[unit]!;
  return n * mult;
}

/**
 * 토큰 발급/검증 (AUTH_DESIGN §2).
 * - Access: JWT 서명(무상태)
 * - Refresh: 불투명 랜덤 문자열, DB 에 sha256 해시 저장, 회전 + 재사용 감지
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 새 Refresh 토큰 발급(+DB 저장). familyId 미지정 시 새 회전 체인 시작. */
  async issueRefresh(
    memberId: number,
    familyId?: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(48).toString('base64url');
    const ttl =
      durationToMs(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d') ||
      30 * 86400e3;
    const expiresAt = new Date(Date.now() + ttl);
    await this.prisma.refreshToken.create({
      data: {
        memberId,
        tokenHash: this.hash(token),
        familyId: familyId ?? randomUUID(),
        expiresAt,
        userAgent,
      },
    });
    return { token, expiresAt };
  }

  /** 회전: 기존 토큰 폐기 + 새 토큰 발급. 재사용(이미 폐기된 토큰) 시 family 전체 무효화. */
  async rotate(
    token: string,
    userAgent?: string,
  ): Promise<{ memberId: number; token: string; expiresAt: Date }> {
    const rec = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!rec) throw new UnauthorizedException('UNAUTHENTICATED');

    if (rec.revokedAt) {
      // 재사용 감지 → 탈취 방어: 체인 전체 폐기
      await this.prisma.refreshToken.updateMany({
        where: { familyId: rec.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('TOKEN_REUSE_DETECTED');
    }
    if (rec.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('UNAUTHENTICATED');
    }

    await this.prisma.refreshToken.update({
      where: { id: rec.id },
      data: { revokedAt: new Date() },
    });
    const next = await this.issueRefresh(rec.memberId, rec.familyId, userAgent);
    return { memberId: rec.memberId, ...next };
  }

  /** 로그아웃: 제출된 Refresh 폐기. */
  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  refreshTtlMs(): number {
    return (
      durationToMs(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d') ||
      30 * 86400e3
    );
  }
}
