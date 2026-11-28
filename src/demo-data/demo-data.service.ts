import { effectiveNow } from '../common/utils/demo-clock';
import { createRaceReady } from './fixtures/race-ready.fixture';
import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateDemoScenarioDto } from './demo-data.dto';
import { createAdmissionPending } from './fixtures/admission-pending.fixture';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { availableAdmissionStalls } from '../horses/admission-capacity';
import { DemoDataGuard } from './demo-data.guard';
import { DEMO_RECIPES, DemoArgs, DemoReceipt, normalizeDemoArgs } from './demo-data.catalog';

@Injectable()
export class DemoDataService {
  private readonly permitKey = randomBytes(32);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly guard: DemoDataGuard,
  ) {}

  async getContext() {
    this.guard.assertLocal();
    const [owners, catalogs, availableStalls] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'HORSE_OWNER', status: 'ACTIVE', isBadDebtFlagged: false },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
        take: 50,
      }),
      this.prisma.horseCatalogItem.findMany({
        where: { isActive: true },
        select: { type: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.stall.count({ where: availableAdmissionStalls }),
    ]);
    const reason = !owners.length
      ? 'Chưa có chủ ngựa đang hoạt động, không bị đánh dấu nợ xấu.'
      : !catalogs.some((c) => c.type === 'BREED') || !catalogs.some((c) => c.type === 'COLOR')
        ? 'Thiếu giống hoặc màu lông đang hoạt động trong danh mục.'
        : undefined;
    return {
      serverTime: effectiveNow().toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
      owners,
      availableStalls,
      defaultOwnerId: owners.length === 1 ? owners[0].id : undefined,
      aiConfigured: Boolean(
        this.config.get<string>('GEMINI_API_KEY')?.trim() &&
        this.config.get<string>('GEMINI_MODEL')?.trim(),
      ),
      recipes: DEMO_RECIPES.map((recipe) => ({
        ...recipe,
        reason:
          reason ??
          (recipe.id === 'RACE_READY' && !availableStalls
            ? 'Chưa có ô chuồng trống hợp lệ.'
            : undefined),
      })),
    };
  }

  private argsHash(args: DemoArgs): string {
    return createHash('sha256')
      .update(JSON.stringify(normalizeDemoArgs(args)))
      .digest('hex');
  }

  issuePermit(
    actor: CurrentUserPayload,
    generationId: string,
    sessionNonce: string,
    args: DemoArgs,
  ): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        purpose: 'demo-data:create',
        actorId: actor.userId,
        generationId,
        sessionNonce,
        argsHash: this.argsHash(args),
        expiresAt: Date.now() + 60_000,
      }),
    ).toString('base64url');
    return `${payload}.${createHmac('sha256', this.permitKey).update(payload).digest('hex')}`;
  }

  verifyPermit(actor: CurrentUserPayload, dto: CreateDemoScenarioDto): void {
    const invalid = () =>
      apiError(
        HttpStatus.FORBIDDEN,
        'DEMO_PERMIT_INVALID',
        'Quyền thực thi không hợp lệ hoặc đã hết hạn. Kiểm tra kết quả trước khi gửi lại.',
      );
    if (typeof dto.permit !== 'string' || dto.permit.length > 2048) throw invalid();
    const parts = dto.permit.split('.');
    if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) throw invalid();
    const signature = createHmac('sha256', this.permitKey).update(parts[0]).digest();
    if (!timingSafeEqual(signature, Buffer.from(parts[1], 'hex'))) throw invalid();
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Record<string, unknown>;
    } catch {
      throw invalid();
    }
    const args = normalizeDemoArgs({
      scenario: dto.scenario,
      horseName: dto.horseName,
      ownerId: dto.ownerId,
    });
    if (
      !claims ||
      claims.v !== 1 ||
      claims.purpose !== 'demo-data:create' ||
      claims.actorId !== actor.userId ||
      claims.generationId !== dto.generationId ||
      claims.sessionNonce !== dto.sessionNonce ||
      claims.argsHash !== this.argsHash(args) ||
      typeof claims.expiresAt !== 'number' ||
      claims.expiresAt <= Date.now()
    )
      throw invalid();
  }

  private async storedGeneration(client: Prisma.TransactionClient | PrismaService, id: string) {
    return client.auditLog.findFirst({
      where: { entityName: 'DemoDataBatch', entityId: id, action: 'DEMO_DATA_CREATED' },
      orderBy: { timestamp: 'desc' },
    });
  }

  private readSnapshot(value: string | null): {
    version: number;
    argsHash: string;
    receipt: DemoReceipt;
  } {
    try {
      const snapshot = JSON.parse(value ?? 'null')?.values;
      if (
        snapshot?.version !== 1 ||
        snapshot.receipt?.status !== 'CREATED' ||
        typeof snapshot.argsHash !== 'string'
      )
        throw new Error('Invalid receipt');
      return snapshot;
    } catch {
      throw apiError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'DEMO_RESULT_UNKNOWN',
        'Chưa xác minh được biên nhận. Không tạo bộ mới; hãy liên hệ quản lý.',
      );
    }
  }

  async getReceipt(actor: CurrentUserPayload, generationId: string): Promise<DemoReceipt> {
    this.guard.assertLocal();
    const stored = await this.storedGeneration(this.prisma, generationId);
    if (!stored)
      throw apiError(
        HttpStatus.NOT_FOUND,
        'DEMO_GENERATION_NOT_FOUND',
        'Chưa có biên nhận cho yêu cầu này.',
      );
    if (stored.userId !== actor.userId)
      throw apiError(
        HttpStatus.FORBIDDEN,
        'DEMO_FORBIDDEN',
        'Bạn không có quyền xem biên nhận này.',
      );
    return this.readSnapshot(stored.newValuesJson).receipt;
  }

  async createScenario(
    actor: CurrentUserPayload,
    dto: CreateDemoScenarioDto,
  ): Promise<DemoReceipt> {
    this.guard.assertLocal();
    this.verifyPermit(actor, dto);
    const args = normalizeDemoArgs({
      scenario: dto.scenario,
      horseName: dto.horseName,
      ownerId: dto.ownerId,
    });
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.generationId}, 0))::text`;
        const existing = await this.storedGeneration(tx, dto.generationId);
        if (existing) {
          const snapshot = this.readSnapshot(existing.newValuesJson);
          if (existing.userId !== actor.userId || snapshot.argsHash !== this.argsHash(args))
            throw apiError(
              HttpStatus.CONFLICT,
              'DEMO_GENERATION_CONFLICT',
              'Mã yêu cầu đã được dùng với người tạo hoặc tham số khác.',
            );
          return snapshot.receipt;
        }
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${actor.userId}, ${args.ownerId}) ORDER BY "id" FOR SHARE`;
        const manager = await tx.user.findUnique({ where: { id: actor.userId } });
        if (manager?.role !== 'CLUB_MANAGER' || manager.status !== 'ACTIVE')
          throw apiError(
            HttpStatus.FORBIDDEN,
            'DEMO_FORBIDDEN',
            'Tài khoản quản lý không còn đủ quyền.',
          );
        if (await tx.horse.findUnique({ where: { id: dto.generationId } }))
          throw apiError(
            HttpStatus.CONFLICT,
            'DEMO_GENERATION_CONFLICT',
            'Mã yêu cầu trùng với một hồ sơ đã có.',
          );
        const now = effectiveNow();
        const result =
          args.scenario === 'ADMISSION_PENDING'
            ? await createAdmissionPending(tx, args, dto.generationId, actor, now)
            : await createRaceReady(tx, args, dto.generationId, actor, now);
        const receipt: DemoReceipt = {
          generationId: dto.generationId,
          scenario: args.scenario,
          status: 'CREATED',
          createdAt: now.toISOString(),
          ...result,
        };
        await this.audit.record(
          { id: actor.userId, name: actor.fullName },
          'DEMO_DATA_CREATED',
          '[DEMO] Tạo bộ dữ liệu mẫu theo yêu cầu quản lý.',
          dto.generationId,
          {
            entityName: 'DemoDataBatch',
            newValues: JSON.parse(
              JSON.stringify({ version: 1, argsHash: this.argsHash(args), receipt }),
            ),
          },
          tx,
        );
        return receipt;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  }
}
