import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';

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
}
