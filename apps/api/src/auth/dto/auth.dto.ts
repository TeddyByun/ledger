import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'teddy@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'super-secret-1234', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ example: '테디' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional({ example: '우리집', description: '기본 가구 이름' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  householdName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'teddy@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'super-secret-1234' })
  @IsString()
  password!: string;
}
