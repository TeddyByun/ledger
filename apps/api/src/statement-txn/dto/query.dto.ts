import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 은행/카드 원천 거래 조회 공통 쿼리 — 커서(keyset) 페이지네이션. */
export class StatementTxnQueryDto {
  @ApiPropertyOptional({ description: '결제수단 ID (은행=계좌, 카드=카드)' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  paymentMethodId?: number;

  @ApiPropertyOptional({ description: '분류 코드 (대분류면 하위까지 포함)' })
  @IsString()
  @IsOptional()
  categoryCode?: string;

  @ApiPropertyOptional({ description: '거래 구분(txn_type_raw) 정확일치' })
  @IsString()
  @IsOptional()
  txnType?: string;

  @ApiPropertyOptional({ description: "할부 여부 필터: 'yes'(할부만) | 'no'(일시불만)" })
  @IsString()
  @IsOptional()
  installment?: string;

  @ApiPropertyOptional({ example: '2026-03-01', description: '기간 시작(포함)' })
  @Matches(DATE_RE)
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31', description: '기간 종료(포함)' })
  @Matches(DATE_RE)
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: '내용(적요/가맹점) 부분검색' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ description: '다음 페이지 커서(불투명 토큰)' })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: "정렬 스펙(우선순위 순): 'col:dir,col:dir' 예) 'withdrawal:desc,date:asc'",
  })
  @IsString()
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: '오프셋(건너뛸 건수)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset: number = 0;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 50;
}
