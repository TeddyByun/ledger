import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { HouseholdService } from './household.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  CreateMemberDto,
  RenameHouseholdDto,
  UpdateMemberDto,
} from './dto/household.dto.js';

@ApiTags('household')
@ApiBearerAuth()
@Controller('household')
export class HouseholdController {
  constructor(private readonly service: HouseholdService) {}

  @Get()
  @ApiOperation({ summary: '현재 가구 정보 + 구성원' })
  getCurrent() {
    return this.service.getCurrent();
  }

  @Patch()
  @Roles('owner')
  @ApiOperation({ summary: '가구 이름 변경 (owner)' })
  rename(@Body() dto: RenameHouseholdDto) {
    return this.service.rename(dto.name);
  }

  @Get('members')
  @ApiOperation({ summary: '가족 구성원 목록' })
  listMembers() {
    return this.service.listMembers();
  }

  @Post('members')
  @Roles('owner', 'member')
  @ApiOperation({ summary: '가족 구성원 등록' })
  createMember(@Body() dto: CreateMemberDto) {
    return this.service.createMember(dto);
  }

  @Patch('members/:id')
  @Roles('owner', 'member')
  @ApiOperation({ summary: '가족 구성원 수정' })
  updateMember(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.service.updateMember(id, dto);
  }

  @Delete('members/:id')
  @Roles('owner', 'member')
  @ApiOperation({ summary: '가족 구성원 삭제' })
  removeMember(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeMember(id);
  }
}
