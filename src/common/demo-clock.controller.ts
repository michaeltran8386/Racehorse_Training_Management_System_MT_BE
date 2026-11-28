import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { apiError } from './exceptions/api-error';
import { getDemoClockState, setDemoClock } from './utils/demo-clock';
import { DemoClockScheduler } from './demo-clock.scheduler';

export class SetDemoClockDto {
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  at: string | null;
}

@Controller('demo-clock')
export class DemoClockController {
  constructor(private readonly scheduler: DemoClockScheduler) {}

  private assertDevelopment() {
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
      throw apiError(
        HttpStatus.FORBIDDEN,
        'DEMO_DISABLED',
        'TimeControl chỉ dùng trong môi trường phát triển.',
      );
  }

  @Get()
  state() {
    this.assertDevelopment();
    return getDemoClockState();
  }

  @Post()
  async set(@Body() dto: SetDemoClockDto) {
    this.assertDevelopment();
    if (this.scheduler.isBusy)
      throw apiError(
        HttpStatus.CONFLICT,
        'CLOCK_BUSY',
        'Đang xử lý mốc giờ trước. Vui lòng chờ rồi thử lại.',
      );
    const at = dto.at === null ? null : new Date(dto.at);
    if (at && !Number.isFinite(+at))
      throw apiError(HttpStatus.BAD_REQUEST, 'INVALID_DEMO_TIME', 'Ngày giờ không hợp lệ.');
    setDemoClock(at);
    await this.scheduler.tick();
    return getDemoClockState();
  }
}
