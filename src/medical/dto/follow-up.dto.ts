import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VitalsDto } from './create-medical-record.dto';

export class CreateFollowUpDto {
  @IsOptional()
  @IsString()
  visitDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  progressNotes: string;

  @IsOptional()
  @IsString()
  followUpDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(35)
  @Max(43)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(120)
  restingHeartRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(4)
  @Max(60)
  respiratoryRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adjustments?: string;
}
