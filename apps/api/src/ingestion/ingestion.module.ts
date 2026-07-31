import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StatisticsModule } from '../statistics/statistics.module.js';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';
import { StorageService } from './storage/storage.service.js';
import { ParserRegistry } from './parsers/parser.registry.js';
import { ClassificationModule } from './classification/classification.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { StatementTxnModule } from '../statement-txn/statement-txn.module.js';
import { ImportPipelineService } from './pipeline/import-pipeline.service.js';
import { ImportProcessor } from './pipeline/import.processor.js';
import { IMPORT_QUEUE } from './pipeline/import.queue.js';

@Module({
  imports: [
    StatisticsModule,
    ClassificationModule,
    ReconciliationModule,
    StatementTxnModule,
    BullModule.registerQueue({ name: IMPORT_QUEUE }),
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    StorageService,
    ParserRegistry,
    ImportPipelineService,
    ImportProcessor,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
