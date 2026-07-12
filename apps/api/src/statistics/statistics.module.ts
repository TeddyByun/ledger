import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller.js';
import { StatisticsService } from './statistics.service.js';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
