import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 전체 운영(플랫폼) 관리자 전용 서비스 — 가구 경계를 넘어 조회한다.
 * Household 는 테넌트 스코프 대상이 아니므로(SCOPED_MODELS 제외) findMany 가 전체를 반환하고,
 * include/_count 는 미들웨어 스코핑을 타지 않아 가구별 집계도 전역으로 계산된다.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
}
