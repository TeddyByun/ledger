import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env.validation.js';
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
    ConfigModule.forRoot({
      isGlobal: true,
      // 모노레포: 루트 .env 를 사용(apps/api/.env 심링크로도 연결됨).
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    // 적재 파이프라인 큐 (Redis). REDIS_URL 을 host/port 로 파싱.
    BullModule.forRoot({
      connection: (() => {
        const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
        return { host: u.hostname, port: Number(u.port || 6379) };
      })(),
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
