import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginatedDto } from '../common/dto/pagination.dto.js';
import {
  CreateTransactionDto,
  TransactionQueryDto,
  UpdateTransactionDto,
} from './dto/transaction.dto.js';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: TransactionQueryDto) {
    const where = await this.buildWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: { category: true, counterparty: true, paymentMethod: true },
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return new PaginatedDto(items, total, query.page, query.pageSize);
  }

  async findOne(id: number) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: { category: true, counterparty: true, paymentMethod: true },
    });
    if (!tx) throw new NotFoundException(`transaction ${id} not found`);
    return tx;
  }

  create(dto: CreateTransactionDto) {
    return this.prisma.transaction.create({ data: this.toData(dto) });
  }

  async update(id: number, dto: UpdateTransactionDto) {
    await this.findOne(id);
    return this.prisma.transaction.update({
      where: { id },
      data: this.toData(dto),
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.transaction.delete({ where: { id } });
    return { deleted: true };
  }

  // ── helpers ──────────────────────────────────────────
  private toData(
    dto: CreateTransactionDto | UpdateTransactionDto,
  ): Prisma.TransactionUncheckedCreateInput {
    return {
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.categoryCode !== undefined && { categoryCode: dto.categoryCode }),
      ...(dto.paymentMethodId !== undefined && {
        paymentMethodId: dto.paymentMethodId,
      }),
      ...(dto.counterpartyId !== undefined && {
        counterpartyId: dto.counterpartyId,
      }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.amount !== undefined && { amount: dto.amount }),
      ...(dto.transactionDate !== undefined && {
        transactionDate: new Date(dto.transactionDate),
      }),
      ...(dto.settledDate !== undefined && {
        settledDate: new Date(dto.settledDate),
      }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.memo !== undefined && { memo: dto.memo }),
    } as Prisma.TransactionUncheckedCreateInput;
  }

  /** 분류코드가 대분류면 소분류까지 포함해 검색. */
  private async buildWhere(
    query: TransactionQueryDto,
  ): Promise<Prisma.TransactionWhereInput> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.paymentMethodId) where.paymentMethodId = query.paymentMethodId;

    if (query.categoryCode) {
      const children = await this.prisma.category.findMany({
        where: { parentCode: query.categoryCode },
        select: { code: true },
      });
      const codes = [query.categoryCode, ...children.map((c) => c.code)];
      where.categoryCode = { in: codes };
    }

    if (query.from || query.to) {
      where.transactionDate = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    if (query.q) {
      where.OR = [
        { description: { contains: query.q, mode: 'insensitive' } },
        { memo: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}
