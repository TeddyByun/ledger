import { Module } from '@nestjs/common';
import { StatementTxnController } from './statement-txn.controller.js';
import { StatementTxnService } from './statement-txn.service.js';

@Module({
  controllers: [StatementTxnController],
  providers: [StatementTxnService],
})
export class StatementTxnModule {}
