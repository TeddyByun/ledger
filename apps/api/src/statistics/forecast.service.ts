import { Injectable } from '@nestjs/common';
import { CashflowService } from './cashflow.service.js';

/** 소비 예상도 현금흐름과 동일한 범위·정기 계획·원천 거래를 사용한다. */
@Injectable()
export class ForecastService {
  constructor(private readonly cashflow: CashflowService) {}

  async forecast(ym?: string) {
    const result = await this.cashflow.cashflow(ym);
    const s = result.spending;
    return {
      ...s, ym: result.ym,
      range: { low: s.actual + s.regularRemaining + Math.round(s.variableRemaining * 0.8), high: s.actual + s.regularRemaining + Math.round(s.variableRemaining * 1.25) },
      abc: { A: s.actual, B: s.regularRemaining, C: s.variableRemaining },
      progress: { day: s.actualUntil, days: result.daysInMonth },
      prev: { ym: result.prevYm, actual: result.consumptionPrevActual },
      breakdown: { actual: s.actual, fixedRemaining: s.regularRemaining, seasonalRemaining: 0, variableRemaining: s.variableRemaining },
      contributions: s.predictedItems.map((p) => ({ ...p, predicted: p.revised, dayOfMonth: p.day, group: p.planned ? 'fixed' : 'estimated' })),
    };
  }
}
