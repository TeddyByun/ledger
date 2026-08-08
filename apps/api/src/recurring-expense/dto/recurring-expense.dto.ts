import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export enum AmountType {
  fixed = 'fixed',
  variable = 'variable',
}

export enum RecurringCadence {
  monthly = 'monthly',
  annual = 'annual',
  schedule = 'schedule',
}

const YM = /^\d{4}-\d{2}$/;

export class CreateRecurringExpenseDto {
  @ApiProperty({ example: '넷플릭스' })
  @IsString()
  @Length(1, 60)
  label!: string;

  @ApiProperty({ example: '1201', description: '분류 코드' })
  @IsString()
  categoryCode!: string;

  @ApiPropertyOptional({ description: '결제수단 ID' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  paymentMethodId?: number;

  @ApiProperty({ example: 17000, description: '예상 금액(월액 또는 회당)' })
  @Type(() => Number)
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({
    enum: AmountType,
    default: AmountType.fixed,
    description: '금액 성격 — fixed(고정: 월세·구독·할부금) / variable(변동: 공과금·통신비 등, 예상금액은 평균치)',
  })
  @IsEnum(AmountType)
  @IsOptional()
  amountType?: AmountType;

  @ApiPropertyOptional({ enum: RecurringCadence, default: RecurringCadence.monthly })
  @IsEnum(RecurringCadence)
  @IsOptional()
  cadence?: RecurringCadence;

  @ApiPropertyOptional({ description: 'annual 발생 월(1~12) 목록', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  @IsOptional()
  months?: number[];

  @ApiPropertyOptional({ example: '2026-01', description: 'schedule 시작 년월' })
  @Matches(YM)
  @IsOptional()
  startYm?: string;

  @ApiPropertyOptional({
    example: '2027-05',
    description: '만기 년월. 지나면 예측 종료(주기 무관 — 할부·구독 등 모든 항목에 지정 가능). null/빈값 = 만기 해제',
    nullable: true,
  })
  @Transform(({ value }) => (value === '' || value === null ? null : value))
  @ValidateIf((_o, v) => v !== null)
  @Matches(YM)
  @IsOptional()
  endYm?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 31,
    nullable: true,
    description: '예상 지출일(1~31). null/빈값 = 미지정',
  })
  @Transform(({ value }) => (value === '' || value === null ? null : Number(value)))
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  dayOfMonth?: number | null;

  @ApiPropertyOptional({ description: '자동 매칭 키(추천 확정 시)' })
  @IsString()
  @IsOptional()
  matchKey?: string;

  @ApiPropertyOptional({ description: '추천 확정(auto) 여부 — 기본 manual' })
  @IsString()
  @IsOptional()
  source?: 'auto' | 'manual';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  memo?: string;
}

export class UpdateRecurringExpenseDto extends PartialType(CreateRecurringExpenseDto) {
  @ApiPropertyOptional({ description: '체크 상태(예측 포함) — Y/N' })
  @IsString()
  @IsOptional()
  isActive?: 'Y' | 'N';
}
