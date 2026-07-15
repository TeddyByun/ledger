import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RenameHouseholdDto {
  @ApiProperty({ example: '우리집' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}

export class CreateMemberDto {
  @ApiProperty({ example: '선영', description: '구성원 이름' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string;

  @ApiPropertyOptional({ example: 'spouse', description: 'self/spouse/child/parent 등' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  relation?: string;

  @ApiPropertyOptional({ description: '대표(본인) 여부' })
  @IsOptional()
  @IsBoolean()
  isSelf?: boolean;

  @ApiPropertyOptional({ example: '#0F766E', description: '색 태그' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  // ── 로그인(선택) — 값을 넣으면 앱에 로그인 가능한 구성원이 됨 ──
  @ApiPropertyOptional({ example: 'mom@example.com', description: '로그인 이메일(선택)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: '로그인 비밀번호(선택, 8자 이상)' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @ApiPropertyOptional({ enum: ['owner', 'member', 'viewer'], description: '앱 권한(로그인 구성원)' })
  @IsOptional()
  @IsIn(['owner', 'member', 'viewer'])
  role?: 'owner' | 'member' | 'viewer';
}

export class UpdateMemberDto extends PartialType(CreateMemberDto) {}
