import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import type { MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import {
  CreateMemberDto,
  UpdateMemberDto,
} from './dto/household.dto.js';

/** 응답에 내보내도 되는 구성원 필드 — passwordHash 는 절대 포함하지 않는다. */
const MEMBER_PUBLIC = {
  id: true,
  name: true,
  relation: true,
  isSelf: true,
  color: true,
  sortOrder: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.HouseholdMemberSelect;

@Injectable()
export class HouseholdService {
  constructor(private readonly prisma: PrismaService) {}

  /** 로그인 자격(email/password/role) 변경은 owner 만 가능. member 의 권한상승·계정탈취 차단. */
  private assertCredentialPermission(
    dto: CreateMemberDto | UpdateMemberDto,
    actorRole: MemberRole,
  ) {
    const touchesCredentials =
      dto.role !== undefined || dto.password !== undefined || dto.email !== undefined;
    if (touchesCredentials && actorRole !== 'owner') {
      throw new ForbiddenException('OWNER_ONLY_CREDENTIALS');
    }
  }

  /** 현재 가구 정보 + 구성원 목록. */
  async getCurrent() {
    const { householdId, role } = requireTenant();
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
    });
    const members = await this.listMembers();
    return {
      id: household?.id,
      name: household?.name,
      role,
      members,
    };
  }

  /** 가구 이름 변경 (owner). */
  async rename(name: string) {
    const { householdId } = requireTenant();
    return this.prisma.household.update({
      where: { id: householdId },
      data: { name },
    });
  }

  listMembers() {
    return this.prisma.householdMember.findMany({
      where: { useYn: 'Y' },
      orderBy: [{ isSelf: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: MEMBER_PUBLIC, // passwordHash 제외
    });
  }

  async createMember(dto: CreateMemberDto, actorRole: MemberRole) {
    this.assertCredentialPermission(dto, actorRole);
    // isSelf=true 로 새로 지정하면 기존 대표 해제(대표는 1명)
    if (dto.isSelf) await this.clearSelf();
    const { password, ...rest } = dto;
    try {
      return await this.prisma.householdMember.create({
        data: {
          ...rest,
          householdId: requireTenant().householdId,
          ...(password !== undefined && {
            passwordHash: await argon2.hash(password),
          }),
        },
        select: MEMBER_PUBLIC,
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async updateMember(id: number, dto: UpdateMemberDto, actorRole: MemberRole) {
    this.assertCredentialPermission(dto, actorRole);
    await this.findMember(id);
    if (dto.isSelf) await this.clearSelf();
    const { password, ...rest } = dto;
    try {
      const updated = await this.prisma.householdMember.update({
        where: { id },
        data: {
          ...rest,
          ...(password !== undefined && {
            passwordHash: await argon2.hash(password),
          }),
        },
        select: MEMBER_PUBLIC,
      });
      // 비밀번호가 바뀌면 해당 구성원의 기존 세션(refresh) 폐기
      if (password !== undefined) {
        await this.prisma.refreshToken.deleteMany({ where: { memberId: id } });
      }
      return updated;
    } catch (e) {
      throw this.mapError(e);
    }
  }

  private mapError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('EMAIL_TAKEN');
    }
    return e;
  }

  async removeMember(id: number) {
    await this.findMember(id);
    // 소프트 삭제(거래 귀속 이력 보존). 로그인 차단(isActive=false)과 세션 폐기까지 함께 처리.
    await this.prisma.$transaction([
      this.prisma.householdMember.update({
        where: { id },
        data: { useYn: 'N', isActive: false },
      }),
      this.prisma.refreshToken.deleteMany({ where: { memberId: id } }),
    ]);
    return { deleted: true };
  }

  private async findMember(id: number) {
    const m = await this.prisma.householdMember.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('MEMBER_NOT_FOUND');
    return m;
  }

  private async clearSelf() {
    await this.prisma.householdMember.updateMany({
      where: { isSelf: true },
      data: { isSelf: false },
    });
  }
}
