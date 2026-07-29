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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantRuleService } from './merchant-rule.service.js';
import {
  CreateMerchantRuleDto,
  UpdateMerchantRuleDto,
} from './dto/merchant-rule.dto.js';

/** 자동분류 키워드 관리 (merchant_category_map) — /api/v1/classify-keywords */
@ApiTags('classify-keywords')
@Controller('classify-keywords')
export class MerchantRuleController {
  constructor(private readonly rules: MerchantRuleService) {}

  @Get()
  @ApiOperation({ summary: '자동분류 키워드 목록' })
  list() {
    return this.rules.list();
  }

  @Post()
  @ApiOperation({ summary: '키워드 추가 (단어 → 분류 매핑)' })
  create(@Body() dto: CreateMerchantRuleDto) {
    return this.rules.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '키워드 수정' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMerchantRuleDto) {
    return this.rules.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '키워드 삭제' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.rules.remove(id);
  }
}
