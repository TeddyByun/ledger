import { Module } from '@nestjs/common';
import { ReconcilerService } from './reconciler.service.js';

/** ReconcilerService 를 공유 인스턴스로 제공(업로드 파이프라인·자동분류 공용). */
@Module({
  providers: [ReconcilerService],
  exports: [ReconcilerService],
})
export class ReconciliationModule {}
