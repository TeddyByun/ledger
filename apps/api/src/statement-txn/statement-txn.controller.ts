import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatementTxnService } from './statement-txn.service.js';
import { StatementTxnQueryDto } from './dto/query.dto.js';

@ApiTags('statement-transactions')
@Controller()
export class StatementTxnController {
  constructor(private readonly service: StatementTxnService) {}

  @Get('bank-transactions')
  @ApiOperation({ summary: '은행 원천 거래 목록 (계좌·기간·분류·내용 검색)' })
  bank(@Query() query: StatementTxnQueryDto) {
    return this.service.findBank(query);
  }

  @Get('card-transactions')
  @ApiOperation({ summary: '카드 원천 거래 목록 (카드·기간·분류·가맹점 검색)' })
  card(@Query() query: StatementTxnQueryDto) {
    return this.service.findCard(query);
  }
}
