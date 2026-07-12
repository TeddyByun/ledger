import { Injectable, NotFoundException } from '@nestjs/common';
import { MethodType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto.js';

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
    return this.prisma.paymentMethod.create({ data: dto });
  }

  async update(id: number, dto: UpdatePaymentMethodDto) {
    await this.findOne(id);
    return this.prisma.paymentMethod.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.paymentMethod.delete({ where: { id } });
    return { deleted: true };
  }
}
