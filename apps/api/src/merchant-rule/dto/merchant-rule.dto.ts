import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MATCH_TYPES = ['contains', 'exact', 'regex'] as const;
const YES_NO = ['Y', 'N'] as const;

export class CreateMerchantRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  pattern!: string;

  @IsString()
  @MinLength(1)
  categoryCode!: string;

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: (typeof MATCH_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;
}

export class UpdateMerchantRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  pattern?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryCode?: string;

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: (typeof MATCH_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsIn(YES_NO)
  useYn?: (typeof YES_NO)[number];
}
