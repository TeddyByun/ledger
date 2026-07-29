import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClassifierService } from '../ingestion/classification/classifier.service.js';
import {
  CreateMerchantRuleDto,
  UpdateMerchantRuleDto,
} from './dto/merchant-rule.dto.js';

/**
 * 자동분류 키워드 관리 — merchant_category_map CRUD.
 * 규칙은 전역 코드성 데이터(가구 무스코프)이며, 자동분류 버튼이 이 규칙을 '포함' 매칭에
 * 사용한다. 변경 시 ClassifierService 캐시를 무효화해 다음 자동분류에 즉시 반영한다.
 */
@Injectable()
export class MerchantRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: ClassifierService,
  ) {}

  /** 전체 키워드 목록(분류명 포함). 분류 → 우선순위 순. */
  async list() {
    const rows = await this.prisma.merchantCategoryMap.findMany({
      orderBy: [{ categoryCode: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
      include: { category: { select: { name: true } } },
    });
    return rows.map((r) => this.map(r));
  }

  async create(dto: CreateMerchantRuleDto) {
    const pattern = dto.pattern.trim();
    if (!pattern) throw new BadRequestException('키워드를 입력하세요.');
    await this.assertCategory(dto.categoryCode);

    const rule = await this.prisma.merchantCategoryMap.create({
      data: {
        pattern,
        categoryCode: dto.categoryCode,
        matchType: dto.matchType ?? 'contains',
        priority: dto.priority ?? 100,
      },
      include: { category: { select: { name: true } } },
    });
    this.classifier.invalidate();
    return this.map(rule);
  }

  async update(id: number, dto: UpdateMerchantRuleDto) {
    await this.findOne(id);
    const data: Prisma.MerchantCategoryMapUpdateInput = {};
    if (dto.pattern !== undefined) {
      const p = dto.pattern.trim();
      if (!p) throw new BadRequestException('키워드를 입력하세요.');
      data.pattern = p;
    }
    if (dto.categoryCode !== undefined) {
      await this.assertCategory(dto.categoryCode);
      data.category = { connect: { code: dto.categoryCode } };
    }
    if (dto.matchType !== undefined) data.matchType = dto.matchType;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.useYn !== undefined) data.useYn = dto.useYn;

    const rule = await this.prisma.merchantCategoryMap.update({
      where: { id },
      data,
      include: { category: { select: { name: true } } },
    });
    this.classifier.invalidate();
    return this.map(rule);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.merchantCategoryMap.delete({ where: { id } });
    this.classifier.invalidate();
    return { id, deleted: true };
  }

  private async findOne(id: number) {
    const r = await this.prisma.merchantCategoryMap.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('키워드를 찾을 수 없습니다.');
    return r;
  }

  private async assertCategory(code: string) {
    const c = await this.prisma.category.findUnique({ where: { code } });
    if (!c) throw new NotFoundException(`분류 ${code}를 찾을 수 없습니다.`);
  }

  private map(r: {
    id: number;
    pattern: string;
    matchType: string;
    categoryCode: string;
    priority: number;
    useYn: string;
    category?: { name: string } | null;
  }) {
    return {
      id: r.id,
      pattern: r.pattern,
      matchType: r.matchType,
      categoryCode: r.categoryCode,
      categoryName: r.category?.name ?? r.categoryCode,
      priority: r.priority,
      useYn: r.useYn,
    };
  }
}
