import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 신규 가구의 초기 소유자(선택) — 주면 로그인 가능한 owner 구성원을 함께 생성한다. */
export class AdminOwnerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  displayName?: string;
}

export class CreateHouseholdDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminOwnerDto)
  owner?: AdminOwnerDto;
}
