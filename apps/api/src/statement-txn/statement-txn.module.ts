import { Module } from '@nestjs/common';
import { StatisticsModule } from '../statistics/statistics.module.js';
import { StatementTxnController } from './statement-txn.controller.js';
import { StatementTxnService } from './statement-txn.service.js';

@Module({
  imports: [StatisticsModule],
  controllers: [StatementTxnController],
  providers: [StatementTxnService],
})
export class StatementTxnModule {}
