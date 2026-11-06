import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GenerateMonthlyDto {
  @ApiProperty({ example: '2026-10' })
  @IsString()
  @Matches(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/)
  billingPeriod: string;
}
