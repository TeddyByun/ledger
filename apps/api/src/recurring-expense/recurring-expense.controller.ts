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
import { RecurringExpenseService } from './recurring-expense.service.js';
import { SuggestionService } from './suggestion.service.js';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './dto/recurring-expense.dto.js';

@ApiTags('recurring-expenses')
@Controller('recurring-expenses')
export class RecurringExpenseController {
  constructor(
    private readonly service: RecurringExpenseService,
    private readonly suggestions: SuggestionService,
  ) {}

  @Get()
  @ApiOperation({ summary: '확정 정기지출 목록(이번 달 발생 상태 포함)' })
  findAll() {
    return this.service.findAll();
  }

  @Get('suggestions')
  @ApiOperation({ summary: '정기지출 추천 후보(R4·R6·R7, 미등록만)' })
  getSuggestions() {
    return this.suggestions.suggest();
  }

  @Post()
  @ApiOperation({ summary: '정기지출 추가(추천 확정 또는 수기)' })
  create(@Body() dto: CreateRecurringExpenseDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '정기지출 수정(금액·만기·활성 토글 등)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRecurringExpenseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '정기지출 삭제' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
