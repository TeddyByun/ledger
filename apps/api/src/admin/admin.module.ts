import { Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [HouseholdModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
