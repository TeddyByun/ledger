import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** 페이지네이션 쿼리 (모든 목록 조회 공용) */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: '1-base 페이지 번호' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 20;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}

/** 페이지네이션 응답 래퍼 */
export class PaginatedDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ example: 137, description: '전체 건수' })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  constructor(items: T[], total: number, page: number, pageSize: number) {
    this.items = items;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
  }
}
