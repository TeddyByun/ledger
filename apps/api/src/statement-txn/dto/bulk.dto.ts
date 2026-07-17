import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsString } from 'class-validator';

/** 은행 거래 일괄 삭제 대상 */
export class BulkIdsDto {
  @ApiProperty({ type: [Number], description: '대상 은행거래 ID 목록' })
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];
}

/** 은행 거래 분류 일괄 변경 */
export class BulkClassifyDto extends BulkIdsDto {
  @ApiProperty({ example: '0501', description: '적용할 분류 코드' })
  @IsString()
  categoryCode!: string;
}
