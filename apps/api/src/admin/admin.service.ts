import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  runWithoutTenant,
  runWithTenant,
} from '../common/tenant/tenant-context.js';
import { HouseholdService } from '../household/household.service.js';
import type {
  CreateMemberDto,
  UpdateMemberDto,
} from '../household/dto/household.dto.js';
import { CreateHouseholdDto } from './dto/admin.dto.js';

/**
 * 전체 운영(플랫폼) 관리자 전용 서비스 — 가구 경계를 넘어 조회/생성/수정/삭제한다.
 * Household 는 테넌트 스코프 대상이 아니고(SCOPED_MODELS 제외), 스코프 모델의 교차 가구
 * 쓰기는 runWithoutTenant 로 미들웨어 자동 주입을 우회한다. 가구별 수정(이름·구성원)은
 * runWithTenant 로 대상 가구 컨텍스트를 씌워 기존 HouseholdService 로직을 그대로 재사용한다.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly household: HouseholdService,
  ) {}

  /** 대상 가구를 테넌트로 씌워 HouseholdService 를 실행(운영자는 owner 권한으로 취급). */
  private async asHousehold<T>(
    householdId: number,
    actorUserId: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const exists = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
    return runWithTenant(
      { userId: actorUserId, householdId, role: 'owner' },
      fn,
    );
  }

  /** 가구 이름 변경(임의 가구). */
  renameHousehold(id: number, name: string, actorUserId: number) {
    return this.asHousehold(id, actorUserId, () => this.household.rename(name));
  }

  /** 구성원 추가/수정/삭제(임의 가구) — 운영자는 owner 권한. */
  addMember(id: number, dto: CreateMemberDto, actorUserId: number) {
    return this.asHousehold(id, actorUserId, () =>
      this.household.createMember(dto, 'owner'),
    );
  }
  editMember(id: number, memberId: number, dto: UpdateMemberDto, actorUserId: number) {
    return this.asHousehold(id, actorUserId, () =>
      this.household.updateMember(memberId, dto, 'owner'),
    );
  }
  removeMember(id: number, memberId: number, actorUserId: number) {
    return this.asHousehold(id, actorUserId, () =>
      this.household.removeMember(memberId),
    );
  }

  /** 전체 가구 목록 + 가구별 구성원/거래 집계. */
  async listHouseholds() {
    const rows = await this.prisma.household.findMany({
      orderBy: { id: 'asc' },
      include: {
        _count: { select: { transactions: true } },
        householdMembers: {
          where: { useYn: 'Y' },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            isSuperAdmin: true,
            lastLoginAt: true,
          },
        },
      },
    });

    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      createdAt: h.createdAt,
      transactionCount: h._count.transactions,
      memberCount: h.householdMembers.length,
      members: h.householdMembers,
    }));
  }

  /** 신규 가구 생성 + (선택) 초기 소유자 계정. */
  async createHousehold(dto: CreateHouseholdDto) {
    return runWithoutTenant(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.owner) {
          const taken = await tx.householdMember.findUnique({
            where: { email: dto.owner.email },
            select: { id: true },
          });
          if (taken) throw new ConflictException('EMAIL_TAKEN');
        }

        const household = await tx.household.create({
          data: { name: dto.name.trim() },
        });

        if (dto.owner) {
          const passwordHash = await argon2.hash(dto.owner.password);
          await tx.householdMember.create({
            data: {
              householdId: household.id,
              name: dto.owner.displayName?.trim() || dto.owner.email,
              relation: 'self',
              isSelf: true,
              email: dto.owner.email,
              passwordHash,
              role: 'owner',
            },
          });
        }

        return { id: household.id, name: household.name };
      }),
    );
  }

  /**
   * 가구 완전 삭제(자식 행 포함 캐스케이드).
   * 안전장치: 관리자 본인 소속 가구·슈퍼관리자 포함 가구는 삭제 불가.
   */
  async deleteHousehold(id: number, actorHouseholdId: number) {
    if (id === actorHouseholdId) {
      throw new ForbiddenException('CANNOT_DELETE_OWN_HOUSEHOLD');
    }

    return runWithoutTenant(() =>
      this.prisma.$transaction(async (tx) => {
        const household = await tx.household.findUnique({
          where: { id },
          include: {
            householdMembers: { select: { id: true, isSuperAdmin: true } },
          },
        });
        if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
        if (household.householdMembers.some((m) => m.isSuperAdmin)) {
          throw new ForbiddenException('CONTAINS_SUPER_ADMIN');
        }

        const memberIds = household.householdMembers.map((m) => m.id);
        const w = { where: { householdId: id } };

        // 자식 → 부모 순서(FK 제약)
        await tx.cardTransaction.deleteMany(w);
        await tx.bankTransaction.deleteMany(w);
        await tx.transaction.deleteMany(w);
        await tx.installmentPlan.deleteMany(w);
        await tx.cardStatement.deleteMany(w);
        await tx.recurringExpense.deleteMany(w);
        await tx.monthlyCategoryStat.deleteMany(w);
        await tx.monthlySourceStat.deleteMany(w);
        await tx.monthlyPaymentStat.deleteMany(w);
        await tx.monthlySummary.deleteMany(w);
        await tx.importJob.deleteMany(w);
        await tx.counterparty.deleteMany(w);
        await tx.paymentMethod.deleteMany(w);
        if (memberIds.length) {
          await tx.refreshToken.deleteMany({
            where: { memberId: { in: memberIds } },
          });
          await tx.passwordResetToken.deleteMany({
            where: { memberId: { in: memberIds } },
          });
        }
        await tx.householdMember.deleteMany(w);
        await tx.household.delete({ where: { id } });

        return { deleted: true };
      }),
    );
  }
}
