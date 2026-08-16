import { Module } from '@nestjs/common';
import { RecurringExpenseController } from './recurring-expense.controller.js';
import { RecurringIncomeController } from './recurring-income.controller.js';
import { RecurringExpenseService } from './recurring-expense.service.js';
import { SuggestionService } from './suggestion.service.js';

@Module({
  controllers: [RecurringExpenseController, RecurringIncomeController],
  providers: [RecurringExpenseService, SuggestionService],
  exports: [RecurringExpenseService],
})
export class RecurringExpenseModule {}
