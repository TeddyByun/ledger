import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatementTxnService } from './statement-txn.service.js';
import { StatementTxnQueryDto } from './dto/query.dto.js';
import { UpdateBankTxnDto } from './dto/update-bank-txn.dto.js';
import { BulkClassifyDto, BulkIdsDto } from './dto/bulk.dto.js';

@ApiTags('statement-transactions')
@Controller()
export class StatementTxnController {
  constructor(private readonly service: StatementTxnService) {}

  @Get('bank-transactions')
  @ApiOperation({ summary: '은행 원천 거래 목록 (계좌·기간·분류·내용 검색)' })
  bank(@Query() query: StatementTxnQueryDto) {
    return this.service.findBank(query);
  }

  @Get('bank-transactions/types')
  @ApiOperation({ summary: '은행 거래 구분(txn_type_raw) 목록' })
  bankTypes() {
    return this.service.bankTypes();
  }

  @Get('bank-transactions/summary')
  @ApiOperation({ summary: '은행 조회 조건 합계 (출금·입금·건수)' })
  bankSummary(@Query() query: StatementTxnQueryDto) {
    return this.service.findBankSummary(query);
  }

  @Get('bank-transactions/export')
  @ApiOperation({ summary: '은행 조회 결과 엑셀(xlsx) 내보내기' })
  async bankExport(
    @Query() query: StatementTxnQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.service.exportBank(query);
    sendXlsx(res, buf, '은행거래');
  }

  @Get('card-transactions')
  @ApiOperation({ summary: '카드 원천 거래 목록 (카드·기간·분류·가맹점 검색)' })
  card(@Query() query: StatementTxnQueryDto) {
    return this.service.findCard(query);
  }

  @Get('card-transactions/summary')
  @ApiOperation({ summary: '카드 조회 조건 합계 (이용금액·결제금액·건수)' })
  cardSummary(@Query() query: StatementTxnQueryDto) {
    return this.service.findCardSummary(query);
  }

  @Get('card-transactions/export')
  @ApiOperation({ summary: '카드 조회 결과 엑셀(xlsx) 내보내기' })
  async cardExport(
    @Query() query: StatementTxnQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.service.exportCard(query);
    sendXlsx(res, buf, '카드거래');
  }

  @Post('card-transactions/bulk-classify')
  @ApiOperation({ summary: '카드 거래 분류 일괄 변경' })
  cardBulkClassify(@Body() dto: BulkClassifyDto) {
    return this.service.bulkClassifyCard(dto.ids, dto.categoryCode);
  }

  @Post('card-transactions/bulk-delete')
  @ApiOperation({ summary: '카드 거래 일괄 삭제' })
  cardBulkDelete(@Body() dto: BulkIdsDto) {
    return this.service.bulkDeleteCard(dto.ids);
  }

  @Patch('bank-transactions/:id')
  @ApiOperation({ summary: '은행 거래 건별 수정 (적요·분류)' })
  updateBank(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankTxnDto,
  ) {
    return this.service.updateBank(id, dto);
  }

  @Post('bank-transactions/auto-classify')
  @ApiOperation({
    summary: '은행 미분류 거래 일괄 자동분류 (이체·카드대금 제외 + 이력/규칙)',
  })
  autoClassify() {
    return this.service.autoClassifyBank();
  }

  @Post('bank-transactions/bulk-classify')
  @ApiOperation({ summary: '은행 거래 분류 일괄 변경' })
  bulkClassify(@Body() dto: BulkClassifyDto) {
    return this.service.bulkClassifyBank(dto.ids, dto.categoryCode);
  }

  @Post('bank-transactions/bulk-delete')
  @ApiOperation({ summary: '은행 거래 일괄 삭제' })
  bulkDelete(@Body() dto: BulkIdsDto) {
    return this.service.bulkDeleteBank(dto.ids);
  }
}

/** xlsx 버퍼를 다운로드 응답으로 전송. 한글 파일명은 filename*(UTF-8)로만. */
function sendXlsx(res: Response, buf: Buffer, base: string): void {
  const ymd = new Date().toISOString().slice(0, 10);
  const name = `${base}_${ymd}.xlsx`; // 예: 은행거래_2026-07-18.xlsx
  // filename= 은 ASCII만 허용 → 폴백은 ascii, 실제 한글명은 filename*(UTF-8 인코딩)
  const asciiFallback = base === '은행거래' ? 'bank' : 'card';
  res.set({
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${asciiFallback}_${ymd}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}
