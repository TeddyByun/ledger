import { Module } from '@nestjs/common';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';

class CreateCounterpartyDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  type?: string;
}

@Injectable()
export class CounterpartyService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(q?: string) {
    return this.prisma.counterparty.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateCounterpartyDto) {
    // findFirst: name 은 가구 내에서만 유일(복합 unique). 테넌트 스코프가 householdId 를 주입.
    const exists = await this.prisma.counterparty.findFirst({
      where: { name: dto.name },
    });
    if (exists) throw new ConflictException(`counterparty '${dto.name}' exists`);
    return this.prisma.counterparty.create({
      data: { ...dto, householdId: requireTenant().householdId },
    });
  }
}

@ApiTags('counterparties')
@Controller('counterparties')
export class CounterpartyController {
  constructor(private readonly service: CounterpartyService) {}

  @Get()
  @ApiOperation({ summary: '수입처/거래처 목록 (q 부분검색)' })
  findAll(@Query('q') q?: string) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({ summary: '수입처/거래처 등록' })
  create(@Body() dto: CreateCounterpartyDto) {
    return this.service.create(dto);
  }
}

@Module({
  controllers: [CounterpartyController],
  providers: [CounterpartyService],
  exports: [CounterpartyService],
})
export class CounterpartyModule {}
