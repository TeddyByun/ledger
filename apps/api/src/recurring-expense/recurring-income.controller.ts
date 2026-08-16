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

/**
 * 정기수입 — 정기지출과 같은 테이블(recurring_expense.flow='income')·같은 서비스를 공유하되
 * 방향만 수입으로 고정한다. 추천은 수입 거래 이력에서, 목록은 이번 달 입금 발생 상태를 계산.
 */
@ApiTags('recurring-incomes')
@Controller('recurring-incomes')
export class RecurringIncomeController {
  constructor(
    private readonly service: RecurringExpenseService,
    private readonly suggestions: SuggestionService,
  ) {}

  @Get()
  @ApiOperation({ summary: '확정 정기수입 목록(이번 달 발생 상태 포함)' })
  findAll() {
    return this.service.findAll('income');
  }

  @Get('suggestions')
  @ApiOperation({ summary: '정기수입 추천 후보(미등록만)' })
  getSuggestions() {
    return this.suggestions.suggest('income');
  }

  @Post()
  @ApiOperation({ summary: '정기수입 추가(추천 확정 또는 수기)' })
  create(@Body() dto: CreateRecurringExpenseDto) {
    return this.service.create(dto, 'income');
  }

  @Patch(':id')
  @ApiOperation({ summary: '정기수입 수정(금액·만기·활성 토글 등)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRecurringExpenseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '정기수입 삭제' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
