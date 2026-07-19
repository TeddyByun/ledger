import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionService } from './transaction.service.js';
import {
  CreateTransactionDto,
  TransactionQueryDto,
  UpdateTransactionDto,
} from './dto/transaction.dto.js';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly service: TransactionService) {}

  @Get()
  @ApiOperation({ summary: '거래 목록 (필터·검색·페이지네이션)' })
  findMany(@Query() query: TransactionQueryDto) {
    return this.service.findMany(query);
  }

  @Get('summary')
  @ApiOperation({ summary: '거래 합계 — 수입/지출/순액 (필터 동일)' })
  summary(@Query() query: TransactionQueryDto) {
    return this.service.summary(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '거래 단건 조회' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '거래 등록' })
  create(@Body() dto: CreateTransactionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '거래 수정' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '거래 삭제' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
