import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller.js';
import { StatisticsService } from './statistics.service.js';
import { ForecastService } from './forecast.service.js';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, ForecastService],
  exports: [StatisticsService, ForecastService],
})
export class StatisticsModule {}
