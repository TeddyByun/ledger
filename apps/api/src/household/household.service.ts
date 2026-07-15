import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import {
  CreateMemberDto,
  UpdateMemberDto,
} from './dto/household.dto.js';

@Injectable()
export class HouseholdService {
  constructor(private readonly prisma: PrismaService) {}

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
    });
  }

  async createMember(dto: CreateMemberDto) {
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
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async updateMember(id: number, dto: UpdateMemberDto) {
    await this.findMember(id);
    if (dto.isSelf) await this.clearSelf();
    const { password, ...rest } = dto;
    try {
      return await this.prisma.householdMember.update({
        where: { id },
        data: {
          ...rest,
          ...(password !== undefined && {
            passwordHash: await argon2.hash(password),
          }),
        },
      });
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
    // 소프트 삭제(거래 귀속 이력 보존) — useYn='N'
    await this.prisma.householdMember.update({
      where: { id },
      data: { useYn: 'N' },
    });
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
