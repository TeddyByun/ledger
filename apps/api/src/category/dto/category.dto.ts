import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { TransactionType } from '@ledger/shared';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 40)
  name!: string;

  /** 대분류 생성 시 필수, 소분류 생성 시에는 상위(parentCode)의 유형을 따름 */
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  /** 지정하면 소분류(depth 2), 없으면 대분류(depth 1) */
  @IsString()
  @IsOptional()
  parentCode?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsString()
  @Length(1, 40)
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
