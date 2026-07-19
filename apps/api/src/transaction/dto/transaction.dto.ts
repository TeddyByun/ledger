import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MethodType, TransactionStatus, TransactionType } from '@ledger/shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type!: TransactionType;

  @ApiProperty({ example: '0501', description: '분류 코드 (최하위)' })
  @IsString()
  categoryCode!: string;

  @ApiProperty({ example: 3, description: '결제수단 ID' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  paymentMethodId!: number;

  @ApiPropertyOptional({ example: 12, description: '수입처/거래처 ID' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  counterpartyId?: number;

  @ApiPropertyOptional({ example: 'METLIFE 선영' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 109440, description: '금액(정보성 행은 생략)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({ example: '2026-03-11', description: '거래 발생일 (YYYY-MM-DD)' })
  @Matches(DATE_RE)
  transactionDate!: string;

  @ApiPropertyOptional({ example: '2026-03-11', description: '입금/결제일' })
  @Matches(DATE_RE)
  @IsOptional()
  settledDate?: string;

  @ApiPropertyOptional({ enum: TransactionStatus, default: TransactionStatus.SETTLED })
  @IsEnum(TransactionStatus)
  @IsOptional()
  status?: TransactionStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  memo?: string;
}

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}

/** 목록 검색/필터 쿼리 — 커서(keyset) 페이지네이션 (API_CONVENTIONS §3.1) */
export class TransactionQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @ApiPropertyOptional({ description: '분류 코드 (대분류면 하위까지 포함)' })
  @IsString()
  @IsOptional()
  categoryCode?: string;

  @ApiPropertyOptional({ description: '결제수단 ID' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  paymentMethodId?: number;

  @ApiPropertyOptional({ enum: MethodType, description: '원천: 은행(bank)/카드(card)' })
  @IsEnum(MethodType)
  @IsOptional()
  methodType?: 'bank' | 'card';

  @ApiPropertyOptional({ example: '2026-03-01', description: '기간 시작(포함)' })
  @Matches(DATE_RE)
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31', description: '기간 종료(포함)' })
  @Matches(DATE_RE)
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'description/memo 부분검색' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ description: '다음 페이지 커서(불투명 토큰)' })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 50;
}
