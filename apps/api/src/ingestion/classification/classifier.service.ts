import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

interface Rule {
  pattern: string;
  matchType: string;
  categoryCode: string;
  priority: number;
}

/**
 * 가맹점명 → 분류 코드 자동 매핑 (merchant_category_map).
 * 규칙은 자주 바뀌지 않아 메모리에 캐시하고, 업로드 배치 단위로 재사용한다.
 */
@Injectable()
export class ClassifierService {
  private cache: Rule[] | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 규칙 캐시 로드(priority 오름차순). 규칙 변경 시 invalidate() 호출. */
  private async rules(): Promise<Rule[]> {
    if (!this.cache) {
      this.cache = await this.prisma.merchantCategoryMap.findMany({
        where: { useYn: 'Y' },
        orderBy: { priority: 'asc' },
        select: { pattern: true, matchType: true, categoryCode: true, priority: true },
      });
    }
    return this.cache;
  }

  invalidate() {
    this.cache = null;
  }

  /** 가맹점명/적요에 매칭되는 분류 코드. 없으면 null(→ 검토 대기). */
  async classify(text: string): Promise<string | null> {
    const target = (text ?? '').replace(/\s/g, '');
    for (const r of await this.rules()) {
      const p = r.pattern.replace(/\s/g, '');
      const hit =
        r.matchType === 'exact'
          ? target === p
          : r.matchType === 'regex'
            ? safeRegex(r.pattern, text)
            : target.includes(p);
      if (hit) return r.categoryCode;
    }
    return null;
  }
}

function safeRegex(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}
