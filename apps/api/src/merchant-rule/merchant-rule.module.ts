import { Module } from '@nestjs/common';
import { ClassificationModule } from '../ingestion/classification/classification.module.js';
import { MerchantRuleController } from './merchant-rule.controller.js';
import { MerchantRuleService } from './merchant-rule.service.js';

@Module({
  imports: [ClassificationModule],
  controllers: [MerchantRuleController],
  providers: [MerchantRuleService],
})
export class MerchantRuleModule {}
