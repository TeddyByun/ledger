import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 은행 원천 거래 건별 수정 — 적요(내용)·분류 */
export class UpdateBankTxnDto {
  @ApiPropertyOptional({ description: '적요(내용). 빈 문자열이면 내용 없음으로.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: '분류 코드. 값 지정 시 미분류 행은 거래를 생성해 확정. 빈 문자열이면 분류 해제.',
  })
  @IsString()
  @IsOptional()
  categoryCode?: string;
}
