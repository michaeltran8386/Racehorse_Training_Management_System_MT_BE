import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { DemoClockController } from './demo-clock.controller';
import { DemoClockScheduler } from './demo-clock.scheduler';

it('resolves TimeControl and existing business schedulers without connecting to a database', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  expect(module.get(DemoClockController)).toBeDefined();
  expect(module.get(DemoClockScheduler)).toBeDefined();
  await module.close();
});
