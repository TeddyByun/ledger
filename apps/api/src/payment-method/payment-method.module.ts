import { Module } from '@nestjs/common';
import { PaymentMethodController } from './payment-method.controller.js';
import { PaymentMethodService } from './payment-method.service.js';

@Module({
  controllers: [PaymentMethodController],
  providers: [PaymentMethodService],
  exports: [PaymentMethodService],
})
export class PaymentMethodModule {}
