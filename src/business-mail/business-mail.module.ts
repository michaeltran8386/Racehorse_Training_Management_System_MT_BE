import { Global, Module } from '@nestjs/common';
import { BusinessMailService } from './business-mail.service';
import { BusinessMailScheduler } from './business-mail.scheduler';

/**
 * Module mail nghiệp vụ (nhắc nợ, cảnh báo, chứng từ) — global để mọi feature
 * (financial, stalls, incidents, medical, tournaments, complaints…) inject được
 * BusinessMailService mà không cần import module riêng.
 */
@Global()
@Module({
  providers: [BusinessMailService, BusinessMailScheduler],
  exports: [BusinessMailScheduler, BusinessMailService],
})
export class BusinessMailModule {}
