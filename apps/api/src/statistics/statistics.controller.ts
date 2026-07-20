import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MethodType, TransactionType } from '@ledger/shared';
import { StatisticsService } from './statistics.service.js';

@ApiTags('statistics')
@Controller('stats')
export class StatisticsController {
  constructor(private readonly stats: StatisticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: '대시보드 — 올해 월별 계좌/카드/분류 집계' })
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  dashboard(@Query('year') year?: string) {
    const y = year ? Number(year) : new Date().getUTCFullYear();
    return this.stats.dashboard(y);
  }

  @Get('monthly-trend')
  @ApiOperation({ summary: '최근 N개월 월별 수입·지출 추이 (롤링)' })
  @ApiQuery({ name: 'months', required: false, example: 12 })
  monthlyTrend(@Query('months') months?: string) {
    const m = months ? Math.min(24, Math.max(1, Number(months))) : 12;
    return this.stats.monthlyTrend(m);
  }

  @Get('payment-trend')
  @ApiOperation({ summary: '결제수단별 월별 지출 추이 (롤링 N개월)' })
  @ApiQuery({ name: 'months', required: false, example: 12 })
  paymentTrend(@Query('months') months?: string) {
    const m = months ? Math.min(24, Math.max(1, Number(months))) : 12;
    return this.stats.paymentTrend(m);
  }

  @Get('monthly')
  @ApiOperation({ summary: '월 전체 요약 (ym 지정 또는 최근 N개월)' })
  @ApiQuery({ name: 'ym', required: false, example: '2026-03' })
  @ApiQuery({ name: 'recent', required: false, description: '최근 개월 수' })
  monthly(@Query('ym') ym?: string, @Query('recent') recent?: string) {
    if (ym) return this.stats.getSummary(ym);
    return this.stats.getRecent(recent ? Number(recent) : 6);
  }

  @Get('monthly/category')
  @ApiOperation({ summary: '월 × 분류별 집계' })
  @ApiQuery({ name: 'ym', required: true, example: '2026-03' })
  @ApiQuery({ name: 'type', enum: TransactionType, required: false })
  byCategory(@Query('ym') ym: string, @Query('type') type?: TransactionType) {
    return this.stats.getByCategory(ym, type);
  }

  @Get('monthly/source')
  @ApiOperation({ summary: '월 × 수입처별 집계' })
  @ApiQuery({ name: 'ym', required: true, example: '2026-03' })
  bySource(@Query('ym') ym: string) {
    return this.stats.getBySource(ym);
  }

  @Get('monthly/payment')
  @ApiOperation({ summary: '월 × 결제수단별 집계 (카드/은행)' })
  @ApiQuery({ name: 'ym', required: true, example: '2026-03' })
  @ApiQuery({ name: 'methodType', enum: MethodType, required: false })
  byPayment(
    @Query('ym') ym: string,
    @Query('methodType') methodType?: 'bank' | 'card',
  ) {
    return this.stats.getByPayment(ym, methodType);
  }

  @Post('monthly/:ym/rebuild')
  @ApiOperation({ summary: '월 요약 재집계 (거래 변경/업로드 후 호출)' })
  rebuild(@Param('ym') ym: string) {
    return this.stats.rebuild(ym);
  }
}
