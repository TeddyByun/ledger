import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MethodType } from '@ledger/shared';

export class CreatePaymentMethodDto {
  @ApiProperty({ example: '하나은행47307', description: '원문 표기(유니크)' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: MethodType, example: MethodType.BANK })
  @IsEnum(MethodType)
  methodType!: MethodType;

  @ApiPropertyOptional({ example: '하나은행' })
  @IsString()
  @IsOptional()
  issuer?: string;

  @ApiPropertyOptional({ example: '47307', description: '계좌 식별번호/카드 별칭' })
  @IsString()
  @IsOptional()
  identifier?: string;

  @ApiPropertyOptional({
    example: '5699-1020-1234-7322',
    description: '카드번호(카드만). 서버에서 뒤 4자리만 남기고 마스킹 저장',
  })
  @IsString()
  @IsOptional()
  cardNo?: string;

  @ApiPropertyOptional({ example: '569-910201-47307' })
  @IsString()
  @IsOptional()
  accountNo?: string;

  @ApiPropertyOptional({ example: '본인', description: '명의(본인/가족)' })
  @IsString()
  @IsOptional()
  owner?: string;

  @ApiPropertyOptional({ example: '연회비 12만원, 주유 3% 적립', description: '메모' })
  @IsString()
  @IsOptional()
  memo?: string;
}

export class UpdatePaymentMethodDto extends PartialType(CreatePaymentMethodDto) {}
