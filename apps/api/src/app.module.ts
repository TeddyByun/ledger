import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthController } from './health.controller.js';
import { CategoryModule } from './category/category.module.js';
import { PaymentMethodModule } from './payment-method/payment-method.module.js';
import { CounterpartyModule } from './counterparty/counterparty.module.js';
import { TransactionModule } from './transaction/transaction.module.js';
import { StatisticsModule } from './statistics/statistics.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 적재 파이프라인 큐 (Redis). REDIS_HOST/REDIS_PORT 환경변수 사용.
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    CategoryModule,
    PaymentMethodModule,
    CounterpartyModule,
    TransactionModule,
    StatisticsModule,
    IngestionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
