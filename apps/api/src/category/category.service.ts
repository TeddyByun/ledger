import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

export interface CategoryNode {
  code: string;
  name: string;
  type: string;
  depth: number;
  sortOrder: number;
  children: CategoryNode[];
}

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 사용중(use_yn='Y') 분류 평면 목록. type 지정 시 필터. */
  findAll(type?: TransactionType) {
    return this.prisma.category.findMany({
      where: { useYn: 'Y', ...(type ? { type } : {}) },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /** 대분류 → 소분류 트리 구조로 조립. */
  async findTree(type?: TransactionType): Promise<CategoryNode[]> {
    const rows = await this.findAll(type);
    const byCode = new Map<string, CategoryNode>();
    for (const r of rows) {
      byCode.set(r.code, {
        code: r.code,
        name: r.name,
        type: r.type,
        depth: r.depth,
        sortOrder: r.sortOrder,
        children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const r of rows) {
      const node = byCode.get(r.code)!;
      if (r.parentCode && byCode.has(r.parentCode)) {
        byCode.get(r.parentCode)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async findOne(code: string) {
    const category = await this.prisma.category.findUnique({ where: { code } });
    if (!category) throw new NotFoundException(`category ${code} not found`);
    return category;
  }

  /**
   * 분류 추가. parentCode 유무로 대/소분류를 판별하고 코드를 자동 채번한다.
   *  - 대분류(depth 1): 2자리 코드(01~99)
   *  - 소분류(depth 2): 상위코드 + 2자리(예: 07 → 0701)
   */
  async create(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('이름을 입력하세요.');

    if (dto.parentCode) {
      const parent = await this.prisma.category.findUnique({
        where: { code: dto.parentCode },
      });
      if (!parent) throw new NotFoundException(`상위 분류 ${dto.parentCode}를 찾을 수 없습니다.`);
      if (parent.depth !== 1) throw new BadRequestException('소분류 아래에는 더 만들 수 없습니다.');

      const siblings = await this.prisma.category.findMany({
        where: { parentCode: parent.code },
        select: { code: true, sortOrder: true },
      });
      const nextSuffix =
        siblings.reduce((mx, s) => Math.max(mx, Number(s.code.slice(parent.code.length)) || 0), 0) + 1;
      const code = `${parent.code}${String(nextSuffix).padStart(2, '0')}`;
      const sortOrder =
        dto.sortOrder ?? siblings.reduce((mx, s) => Math.max(mx, s.sortOrder), 0) + 1;

      return this.prisma.category.create({
        data: { code, parentCode: parent.code, name, type: parent.type, depth: 2, sortOrder },
      });
    }

    if (!dto.type) throw new BadRequestException('대분류는 유형(수입/지출)이 필요합니다.');
    const tops = await this.prisma.category.findMany({
      where: { depth: 1 },
      select: { code: true, sortOrder: true, type: true },
    });
    const nextCode =
      tops.reduce((mx, t) => Math.max(mx, Number(t.code) || 0), 0) + 1;
    if (nextCode > 99) throw new BadRequestException('대분류 코드가 가득 찼습니다.');
    const sameType = tops.filter((t) => t.type === dto.type);
    const sortOrder =
      dto.sortOrder ?? sameType.reduce((mx, t) => Math.max(mx, t.sortOrder), 0) + 1;

    return this.prisma.category.create({
      data: {
        code: String(nextCode).padStart(2, '0'),
        name,
        type: dto.type,
        depth: 1,
        sortOrder,
      },
    });
  }

  async update(code: string, dto: UpdateCategoryDto) {
    await this.findOne(code);
    const data: { name?: string; sortOrder?: number } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('이름을 입력하세요.');
      data.name = name;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.category.update({ where: { code }, data });
  }

  /**
   * 분류 삭제. 하위 분류가 있으면 거부한다.
   * 거래 등에서 사용 중이면 이력 보존을 위해 비활성(use_yn='N') 처리하고,
   * 사용 이력이 전혀 없으면 물리 삭제한다.
   */
  async remove(code: string) {
    await this.findOne(code);
    const childCount = await this.prisma.category.count({ where: { parentCode: code } });
    if (childCount > 0)
      throw new BadRequestException('하위 분류가 있어 삭제할 수 없습니다. 하위 분류를 먼저 삭제하세요.');

    const [txnCount, ruleCount, statCount] = await Promise.all([
      this.prisma.transaction.count({ where: { categoryCode: code } }),
      this.prisma.merchantCategoryMap.count({ where: { categoryCode: code } }),
      this.prisma.monthlyCategoryStat.count({ where: { categoryCode: code } }),
    ]);

    if (txnCount + ruleCount + statCount > 0) {
      const updated = await this.prisma.category.update({
        where: { code },
        data: { useYn: 'N' },
      });
      return { ...updated, deactivated: true };
    }
    await this.prisma.category.delete({ where: { code } });
    return { code, deleted: true };
  }
}
