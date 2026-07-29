import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard.js';
import {
  CurrentUser,
  type AuthUser,
} from '../auth/decorators/current-user.decorator.js';
import { AdminService } from './admin.service.js';
import { CreateHouseholdDto } from './dto/admin.dto.js';

/** 전체 운영(플랫폼) 관리자 전용 라우트 (GET/POST/DELETE /api/v1/admin/...). */
@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** 전체 가구 목록. */
  @Get('households')
  listHouseholds() {
    return this.admin.listHouseholds();
  }

  /** 신규 가구 생성 (+선택 초기 소유자). */
  @Post('households')
  createHousehold(@Body() dto: CreateHouseholdDto) {
    return this.admin.createHousehold(dto);
  }

  /** 가구 완전 삭제(캐스케이드). */
  @Delete('households/:id')
  deleteHousehold(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.deleteHousehold(id, user.householdId);
  }
}
