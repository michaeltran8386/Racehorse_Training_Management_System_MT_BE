import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

function normalizeCareInstructions(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? trimmed : null;
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const activity = typeof obj.activity === 'string' ? obj.activity.trim() : '';
        if (!activity) return null;
        const parsedFreq = Number(obj.frequencyPerDay ?? obj.frequency);
        const frequencyPerDay =
          !Number.isNaN(parsedFreq) && parsedFreq > 0
            ? Math.min(3, Math.max(1, Math.floor(parsedFreq)))
            : undefined;
        return {
          activity,
          ...(typeof obj.frequency === 'string' && obj.frequency.trim()
            ? { frequency: obj.frequency.trim() }
            : {}),
          ...(frequencyPerDay !== undefined ? { frequencyPerDay } : {}),
          ...(typeof obj.notes === 'string' && obj.notes.trim() ? { notes: obj.notes.trim() } : {}),
        };
      }
      return null;
    })
    .filter((item) => item !== null);
}

export class CreateTreatmentPhaseDto {
  @IsString()
  @MinLength(2)
  phaseName: string;

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  allowedActivityLevel?: string;

  @IsOptional()
  @IsString()
  allowedActivity?: string;

  @IsOptional()
  @Transform(({ obj, key }) => normalizeCareInstructions(obj?.[key]))
  @IsArray()
  careInstructions?: any[];
}

export class UpdateTreatmentPhaseDto {
  @IsOptional()
  @IsString()
  phaseName?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  allowedActivityLevel?: string;

  @IsOptional()
  @IsString()
  allowedActivity?: string;

  @IsOptional()
  @Transform(({ obj, key }) => normalizeCareInstructions(obj?.[key]))
  @IsArray()
  careInstructions?: any[];
}
