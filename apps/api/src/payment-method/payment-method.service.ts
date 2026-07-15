import { Injectable, NotFoundException } from '@nestjs/common';
import { MethodType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto.js';

/**
 * 카드번호 마스킹 — 전체 번호를 받아 뒤 4자리만 남기고 저장(금융정보 at-rest 보호).
 * 예: '5699-1020-1234-7322' → '•••• •••• •••• 7322'
 */
export function maskCardNo(input?: string | null): string | undefined {
  if (!input) return undefined;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

@Injectable()
export class PaymentMethodService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(methodType?: MethodType) {
    return this.prisma.paymentMethod.findMany({
      where: methodType ? { methodType } : {},
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: number) {
    const pm = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!pm) throw new NotFoundException(`payment method ${id} not found`);
    return pm;
  }

  create(dto: CreatePaymentMethodDto) {
    return this.prisma.paymentMethod.create({
      data: {
        ...dto,
        cardNo: maskCardNo(dto.cardNo),
        householdId: requireTenant().householdId,
      },
    });
  }

  async update(id: number, dto: UpdatePaymentMethodDto) {
    await this.findOne(id);
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { ...dto, ...(dto.cardNo !== undefined && { cardNo: maskCardNo(dto.cardNo) }) },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.paymentMethod.delete({ where: { id } });
    return { deleted: true };
  }
}
