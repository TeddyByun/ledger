import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service.js';
import { ForecastService } from './forecast.service.js';
import { CashflowService } from './cashflow.service.js';
import { nowKst } from '../common/kst.js';

@ApiTags('statistics')
@Controller('stats')
export class StatisticsController {
  constructor(
    private readonly stats: StatisticsService,
    private readonly forecastSvc: ForecastService,
    private readonly cashflowSvc: CashflowService,
  ) {}

  @Get('cashflow')
  @ApiOperation({
    summary: '기준 통장 합산 현금흐름과 은행·카드 소비 기준 예상',
  })
  @ApiQuery({ name: 'ym', required: false, example: '2026-08' })
  @ApiQuery({
    name: 'accountId',
    required: false,
    description: '하위 호환용. 현재는 결제수단에서 집계 제외하지 않은 기준 통장을 모두 합산합니다.',
  })
  @ApiQuery({
    name: 'ignoreActual',
    required: false,
    description: '1이면 실적을 무시하고 월 전체를 예측(예측 정확도 검증용)',
  })
  cashflow(
    @Query('ym') ym?: string,
    @Query('accountId') accountId?: string,
    @Query('ignoreActual') ignoreActual?: string,
  ) {
    return this.cashflowSvc.cashflow(
      ym,
      accountId ? Number(accountId) : undefined,
      ignoreActual === '1' || ignoreActual === 'true',
    );
  }

  @Get('forecast')
  @ApiOperation({ summary: '소비 예상 지출 — 기준 통장 외부 출금(카드대금 제외) + 금월 카드 거래' })
  @ApiQuery({ name: 'ym', required: false, example: '2026-07' })
  forecast(@Query('ym') ym?: string) {
    return this.forecastSvc.forecast(ym);
  }

  @Get('dashboard')
  @ApiOperation({ summary: '대시보드 — 올해 월별 계좌/카드/분류 집계' })
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  dashboard(@Query('year') year?: string) {
    const y = year ? Number(year) : nowKst().getUTCFullYear();
    return this.stats.dashboard(y);
  }

  @Get('monthly-trend')
  @ApiOperation({ summary: '월별 수입·지출 추이 (기간 지정, 기본 올해)' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01', description: 'YYYY-MM(포함)' })
  @ApiQuery({ name: 'to', required: false, example: '2026-07', description: 'YYYY-MM(포함)' })
  monthlyTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.monthlyTrend(from, to);
  }

  @Get('payment-trend')
  @ApiOperation({ summary: '결제수단별 월별 지출 추이 (기간 지정, 기본 올해)' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01', description: 'YYYY-MM(포함)' })
  @ApiQuery({ name: 'to', required: false, example: '2026-07', description: 'YYYY-MM(포함)' })
  paymentTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.paymentTrend(from, to);
  }

}
