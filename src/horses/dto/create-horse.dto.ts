import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { HORSE_GENDERS, HORSE_NAME_RE, normalizeName } from '../horse-rules';

export class AdmissionDocumentPhotoDto {
  @ApiProperty({ description: 'Tên loại giấy tờ pháp lý', example: 'Giấy chứng nhận sở hữu / Hộ chiếu ngựa' })
  @IsNotEmpty({ message: 'Vui lòng chọn hoặc nhập tên loại giấy tờ.' })
  @IsString({ message: 'Tên loại giấy tờ không hợp lệ.' })
  @MaxLength(120, { message: 'Tên loại giấy tờ tối đa 120 ký tự.' })
  label: string;

  @ApiProperty({ description: 'Ảnh giấy tờ (data URL hoặc đường dẫn ảnh)' })
  @IsNotEmpty({ message: 'Ảnh giấy tờ không được để trống.' })
  @IsString({ message: 'Dữ liệu ảnh giấy tờ không hợp lệ.' })
  @MaxLength(450_000, { message: 'Mỗi ảnh giấy tờ vượt quá dung lượng cho phép.' })
  url: string;
}

export class CreateHorseDto {
  @ApiProperty({ description: 'Horse name (2-100 characters)', example: 'Thunderbolt Swift' })
  @IsNotEmpty({ message: 'Horse name is required.' })
  @IsString({ message: 'Horse name must be a string.' })
  @Length(2, 100, { message: 'Horse name must be between 2 and 100 characters.' })
  @Transform(({ value }) => normalizeName(value))
  @Matches(HORSE_NAME_RE, {
    message: "Horse name can only contain letters (accents allowed), digits, spaces, and ' - .",
  })
  name: string;

  @ApiProperty({ description: 'Horse breed', example: 'Thoroughbred' })
  @IsNotEmpty({ message: 'Please select a horse breed.' })
  @IsString({ message: 'Invalid horse breed string.' })
  breed: string;

  @ApiProperty({ description: 'Date of birth (ISO 8601)', example: '2021-04-12' })
  @IsNotEmpty({ message: 'Date of birth is required.' })
  @IsISO8601({}, { message: 'Date of birth must follow YYYY-MM-DD format.' })
  dob: string;

  @ApiProperty({ description: 'Gender: Stallion, Mare, Gelding', example: 'Stallion' })
  @IsNotEmpty({ message: 'Please select a gender.' })
  @IsString({ message: 'Invalid gender string.' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const v = value.trim();
      if (v.toLowerCase() === 'colt') return 'Stallion';
      if (v.toLowerCase() === 'filly') return 'Mare';
      return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    }
    return value;
  })
  @IsIn(HORSE_GENDERS, { message: 'Please select a gender.' })
  gender: string;

  @ApiProperty({ description: 'Coat color', example: 'Bay Dark' })
  @IsNotEmpty({ message: 'Please select a coat color.' })
  @IsString({ message: 'Invalid coat color string.' })
  color: string;

  @ApiProperty({
    description: 'Microchip number (exactly 15 digits ISO standard)',
    example: '985141002341001',
  })
  @IsNotEmpty({ message: 'Microchip number is required.' })
  @IsString({ message: 'Microchip number must be a string.' })
  @Matches(/^\d{15}$/, { message: 'Microchip number must consist of exactly 15 digits.' })
  microchip: string;

  /** Bỏ qua: BE luôn lấy chủ ngựa từ tài khoản đang đăng nhập. */
  @ApiPropertyOptional({ description: 'Ignored, the owner is the signed-in Horse Owner' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({ description: 'Weight in kg (> 0)', example: 485.5 })
  @IsNumber({}, { message: 'Weight must be a number.' })
  @Min(0.01, { message: 'Weight must be greater than 0 kg.' })
  weightKg: number;

  @ApiPropertyOptional({ description: 'Link scan giấy tờ phả hệ, chuyển nhượng (tùy chọn)' })
  @IsOptional()
  @IsString()
  @MaxLength(450_000, { message: 'Ảnh giấy tờ vượt quá dung lượng cho phép.' })
  documentsUrl?: string;

  @ApiPropertyOptional({
    description: 'Bộ ảnh giấy tờ pháp lý chủ ngựa nộp (tối đa 3 ảnh)',
    type: [AdmissionDocumentPhotoDto],
  })
  @IsOptional()
  @IsArray({ message: 'Danh sách ảnh giấy tờ phải là mảng.' })
  @ArrayMaxSize(3, { message: 'Tối đa 3 ảnh giấy tờ pháp lý.' })
  @ValidateNested({ each: true })
  @Type(() => AdmissionDocumentPhotoDto)
  documentPhotos?: AdmissionDocumentPhotoDto[];

  @ApiPropertyOptional({
    description: 'Ghi chú / mong muốn của chủ ngựa gửi CLB (khung giờ mong muốn, lưu ý tính cách, mục tiêu)',
  })
  @IsOptional()
  @IsString({ message: 'Ghi chú chủ ngựa không hợp lệ.' })
  @MaxLength(1000, { message: 'Ghi chú mong muốn tối đa 1000 ký tự.' })
  ownerNotes?: string;
}
