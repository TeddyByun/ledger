import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ImportJobStatus, Issuer } from '@ledger/shared';

/** 업로드 요청 메타 (파일은 multipart form-data 로 별도 전송) */
export class CreateImportDto {
  @ApiProperty({ enum: Issuer, description: '명세서 발급사 (파서 어댑터 선택)' })
  @IsEnum(Issuer)
  issuer!: Issuer;

  @ApiPropertyOptional({ description: '대상 결제수단 ID (미지정 시 파싱 중 매칭)' })
  @IsOptional()
  paymentMethodId?: number;
}

/** 업로드 잡 상태 응답 */
export class ImportJobDto {
  @ApiProperty({ example: 'imp_01HX...' })
  jobId!: string;

  @ApiProperty({ enum: ImportJobStatus })
  status!: ImportJobStatus;

  @ApiProperty({ enum: Issuer })
  issuer!: Issuer;

  @ApiPropertyOptional({ example: 77, description: '파싱된 행 수' })
  parsedRows?: number;

  @ApiPropertyOptional({ example: 12, description: '자동분류 실패(검토 대기) 건수' })
  pendingRows?: number;

  @ApiPropertyOptional({ description: '실패 시 사유' })
  error?: string;
}
