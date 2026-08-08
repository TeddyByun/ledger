import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller.js';
import { StatisticsService } from './statistics.service.js';
import { ForecastService } from './forecast.service.js';
import { CashflowService } from './cashflow.service.js';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, ForecastService, CashflowService],
  exports: [StatisticsService, ForecastService, CashflowService],
})
export class StatisticsModule {}
