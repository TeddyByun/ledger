import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TransactionType } from '@ledger/shared';
import { CategoryService } from './category.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

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

  @Post()
  @ApiOperation({ summary: '분류 추가 (대분류 또는 소분류)' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':code')
  @ApiOperation({ summary: '분류 수정 (이름/정렬)' })
  update(@Param('code') code: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(code, dto);
  }

  @Delete(':code')
  @ApiOperation({ summary: '분류 삭제 (사용 중이면 비활성 처리)' })
  remove(@Param('code') code: string) {
    return this.categories.remove(code);
  }
}
