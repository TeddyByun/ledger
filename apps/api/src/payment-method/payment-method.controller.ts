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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MethodType } from '@ledger/shared';
import { PaymentMethodService } from './payment-method.service.js';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto.js';

@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly service: PaymentMethodService) {}

  @Get()
  @ApiOperation({ summary: '결제수단 목록 (카드/은행)' })
  @ApiQuery({ name: 'methodType', enum: MethodType, required: false })
  findAll(@Query('methodType') methodType?: MethodType) {
    return this.service.findAll(methodType);
  }

  @Get('detected-cards')
  @ApiOperation({ summary: '명세서에서 감지된 미등록 카드번호 (등록 추천)' })
  detectedCards() {
    return this.service.detectedUnregisteredCards();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '결제수단 등록' })
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
