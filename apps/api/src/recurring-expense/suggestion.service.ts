import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { recurringKey } from '../common/fuzzy-key.js';
import { excludeCategoryCodes } from '../common/exclude-category.js';

const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export interface Suggestion {
  matchKey: string;
  label: string;
  categoryCode: string; // 대분류
  categoryName: string;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  amount: number; // 예상(중앙값)
  amountType: 'fixed' | 'variable'; // 금액 성격 — 월별 편차로 자동 판정
  cadence: 'monthly' | 'annual' | 'schedule';
  months: number[]; // annual 발생월
  dayOfMonth: number | null;
  monthsPresent: number; // 최근 12개월 중 등장 개월
  lastDate: string | null; // 마지막 지출일 (YYYY-MM-DD)
  lastAmount: number; // 마지막 지출일의 금액(같은 날 여러 건이면 합계)
  occurrences: number; // 최근 12개월 발생 건수
  basis: string;
  confidence: 'high' | 'med' | 'low';
  recentStart: boolean; // R8: 최근 2개월 내 최초 등장(신규)
}

const median = (a: number[]): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/**
 * 월별 금액의 편차로 고정/변동 판정.
 * 최대·최소 차이가 중앙값의 3% 이내면 '고정'(월세·구독·할부금),
 * 그보다 흔들리면 '변동'(공과금·통신비 등). 표본이 1개월이면 판단 보류 → 고정.
 */
const amountTypeOf = (monthly: number[]): 'fixed' | 'variable' => {
  const v = monthly.filter((x) => x > 0);
  if (v.length < 2) return 'fixed';
  const med = median(v);
  if (med <= 0) return 'fixed';
  const spread = (Math.max(...v) - Math.min(...v)) / med;
  return spread <= 0.03 ? 'fixed' : 'variable';
};
const mode = (a: number[]): number | null => {
  if (a.length === 0) return null;
  const c = new Map<number, number>();
  let best = a[0]!;
  let bestN = 0;
  for (const v of a) {
    const n = (c.get(v) ?? 0) + 1;
    c.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
};

@Injectable()
export class SuggestionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 최근 12개월 지출을 fuzzyKey+대분류로 그룹화해 반복 후보를 만든다.
   *  - monthly(R4): 최근 6개월 중 ≥3개월 등장
   *  - schedule(R7): 위 + 대분류 01(대출)/코드 0202(정기적금) → 만기 입력 유도
   *  - annual(R6): 12개월 중 1~2회, 금액 큼(≥5만), 계절/연례 성격
   *  - R8: 최근 3개월 연속 미발생 그룹은 제외(종료), 최근 2개월 최초 등장은 recentStart
   * 이미 등록된 matchKey(정기지출)는 제외.
   */
  async suggest(): Promise<Suggestion[]> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const endEx = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const curYm = ymOf(now);
    const recent3Start = ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
    const recent6Start = ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
    const recent2Start = ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

    const [txns, cats, existing] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          type: 'expense',
          transactionDate: { gte: start, lt: endEx },
        },
        select: {
          description: true,
          amount: true,
          transactionDate: true,
          categoryCode: true,
          paymentMethod: { select: { id: true, name: true } },
        },
      }),
      this.prisma.category.findMany({ select: { code: true, name: true, parentCode: true } }),
      this.prisma.recurringExpense.findMany({ select: { matchKey: true } }),
    ]);

    const excluded = new Set(await excludeCategoryCodes(this.prisma));
    const byCode = new Map(cats.map((c) => [c.code, c]));
    const topOf = (code: string) => {
      const c = byCode.get(code);
      if (!c) return { code, name: code };
      const t = (c.parentCode ? byCode.get(c.parentCode) : null) ?? c;
      return { code: t.code, name: t.name };
    };
    const registered = new Set(existing.map((e) => e.matchKey).filter(Boolean) as string[]);

    interface Grp {
      key: string;
      topCode: string;
      topName: string;
      label: string;
      pmId: number | null;
      pmName: string | null;
      perMonth: Map<string, number>;
      days: number[];
      amounts: number[];
      lastAt: Date | null; // 마지막 지출일
      lastAmount: number; // 그 날 금액(같은 날 여러 건이면 합계)
    }
    const groups = new Map<string, Grp>();
    for (const t of txns) {
      if (excluded.has(t.categoryCode)) continue;
      const amt = Number(t.amount ?? 0);
      if (amt <= 0) continue;
      const fk = recurringKey(t.description);
      if (!fk) continue;
      const top = topOf(t.categoryCode);
      const gkey = `${top.code}|${fk}`;
      let g = groups.get(gkey);
      if (!g) {
        g = {
          key: fk,
          topCode: top.code,
          topName: top.name,
          label: (t.description ?? fk).trim(),
          pmId: t.paymentMethod?.id ?? null,
          pmName: t.paymentMethod?.name ?? null,
          perMonth: new Map(),
          days: [],
          amounts: [],
          lastAt: null,
          lastAmount: 0,
        };
        groups.set(gkey, g);
      }
      const ym = ymOf(t.transactionDate);
      g.perMonth.set(ym, (g.perMonth.get(ym) ?? 0) + amt);
      g.days.push(t.transactionDate.getUTCDate());
      g.amounts.push(amt);
      // 마지막 지출일 갱신 — 같은 날 여러 건이면 그 날 합계
      const at = t.transactionDate;
      if (!g.lastAt || at > g.lastAt) {
        g.lastAt = at;
        g.lastAmount = amt;
      } else if (g.lastAt && at.getTime() === g.lastAt.getTime()) {
        g.lastAmount += amt;
      }
    }

    const out: Suggestion[] = [];
    for (const g of groups.values()) {
      if (registered.has(g.key)) continue;
      const yms = [...g.perMonth.keys()].sort();
      const monthsPresent = yms.length;
      const lastYm = yms[yms.length - 1]!;
      const firstYm = yms[0]!;
      // R8: 최근 3개월 연속 미발생 → 종료로 간주, 후보 제외
      if (lastYm < recent3Start) continue;

      const recent6 = yms.filter((y) => y >= recent6Start && y <= curYm);
      const monthlyLike = recent6.length >= 3;
      // schedule 후보: 대출(01) 또는 정기적금/청약/리볼빙 — 대분류·라벨로 근사
      const scheduleLike =
        g.topCode === '01' || /적금|청약|대출|상환|리볼빙/.test(g.label);

      // 최근 3개월 등장분의 중앙값(없으면 전체 중앙값)
      const recentAmts = yms.filter((y) => y >= recent3Start).map((y) => g.perMonth.get(y)!);
      const amount = Math.round(median(recentAmts.length ? recentAmts : g.amounts));
      const day = mode(g.days);
      const recentStart = firstYm >= recent2Start && monthsPresent <= 2;

      if (monthlyLike) {
        const cadence = scheduleLike ? 'schedule' : 'monthly';
        out.push({
          matchKey: g.key,
          label: g.label,
          categoryCode: g.topCode,
          categoryName: g.topName,
          paymentMethodId: g.pmId,
          paymentMethodName: g.pmName,
          amount,
          amountType: amountTypeOf([...g.perMonth.values()]),
          cadence,
          months: [],
          dayOfMonth: day,
          monthsPresent,
          lastDate: g.lastAt ? g.lastAt.toISOString().slice(0, 10) : null,
          lastAmount: Math.round(g.lastAmount),
          occurrences: g.amounts.length,
          basis: `최근 6개월 중 ${recent6.length}개월 등장${
            cadence === 'schedule' ? ' · 만기 입력 필요' : ''
          }`,
          confidence: recent6.length >= 5 ? 'high' : 'med',
          recentStart,
        });
      } else if (monthsPresent >= 1 && monthsPresent <= 2 && amount >= 50000) {
        // 이력이 아직 1~2개월뿐인 큰 금액 — 기본은 '매월'로 추천(연례는 사용자가 직접 변경).
        out.push({
          matchKey: g.key,
          label: g.label,
          categoryCode: g.topCode,
          categoryName: g.topName,
          paymentMethodId: g.pmId,
          paymentMethodName: g.pmName,
          amount,
          amountType: amountTypeOf([...g.perMonth.values()]),
          cadence: 'monthly',
          months: [],
          dayOfMonth: day,
          monthsPresent,
          lastDate: g.lastAt ? g.lastAt.toISOString().slice(0, 10) : null,
          lastAmount: Math.round(g.lastAmount),
          occurrences: g.amounts.length,
          basis: `최근 1년 중 ${monthsPresent}개월 등장`,
          confidence: 'low',
          recentStart,
        });
      }
    }

    // 큰 금액·신규 우선
    out.sort((a, b) => Number(b.recentStart) - Number(a.recentStart) || b.amount - a.amount);
    return out;
  }
}
