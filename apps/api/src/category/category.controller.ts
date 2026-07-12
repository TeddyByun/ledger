import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TransactionType } from '@ledger/shared';
import { CategoryService } from './category.service.js';

class CategoryQueryDto {
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @IsOptional()
  tree?: string;
}

@ApiTags('categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @ApiOperation({ summary: '분류 목록 (평면 또는 트리)' })
  @ApiQuery({ name: 'type', enum: TransactionType, required: false })
  @ApiQuery({ name: 'tree', required: false, description: 'true 면 대/소분류 트리 반환' })
  find(@Query() query: CategoryQueryDto) {
    if (query.tree === 'true') return this.categories.findTree(query.type);
    return this.categories.findAll(query.type);
  }

  @Get(':code')
  @ApiOperation({ summary: '분류 단건 조회' })
  findOne(@Param('code') code: string) {
    return this.categories.findOne(code);
  }
}
