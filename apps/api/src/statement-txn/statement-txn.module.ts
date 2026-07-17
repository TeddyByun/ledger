import { Module } from '@nestjs/common';
import { StatisticsModule } from '../statistics/statistics.module.js';
import { ClassifierService } from '../ingestion/classification/classifier.service.js';
import { StatementTxnController } from './statement-txn.controller.js';
import { StatementTxnService } from './statement-txn.service.js';

@Module({
  imports: [StatisticsModule],
  controllers: [StatementTxnController],
  providers: [StatementTxnService, ClassifierService],
})
export class StatementTxnModule {}
