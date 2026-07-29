import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard.js';
import { AdminService } from './admin.service.js';

/** 전체 운영(플랫폼) 관리자 전용 라우트 (GET /api/v1/admin/...). */
@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** 전체 가구 목록. */
  @Get('households')
  listHouseholds() {
    return this.admin.listHouseholds();
  }
}
