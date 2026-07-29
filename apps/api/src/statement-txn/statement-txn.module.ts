import { Module } from '@nestjs/common';
import { StatisticsModule } from '../statistics/statistics.module.js';
import { ClassificationModule } from '../ingestion/classification/classification.module.js';
import { ReconciliationModule } from '../ingestion/reconciliation/reconciliation.module.js';
import { StatementTxnController } from './statement-txn.controller.js';
import { StatementTxnService } from './statement-txn.service.js';

@Module({
  imports: [StatisticsModule, ClassificationModule, ReconciliationModule],
  controllers: [StatementTxnController],
  providers: [StatementTxnService],
})
export class StatementTxnModule {}
