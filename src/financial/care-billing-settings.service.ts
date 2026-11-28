import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { apiError } from '../common/exceptions/api-error';
import { CareBillingPolicyDto } from './dto/care-billing-policy.dto';
export class CareBillingSettingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private assertManager(actor: CurrentUserPayload) {
    if (actor.role !== 'CLUB_MANAGER')
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Manager permission required.');
  }
  async get(actor: CurrentUserPayload) {
    this.assertManager(actor);
    return this.db.careBillingPolicy.findUnique({ where: { id: 'club' } });
  }
  async configure(dto: CareBillingPolicyDto, actor: CurrentUserPayload) {
    this.assertManager(actor);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74203192)`;
      const prior = await tx.careBillingPolicy.findUnique({ where: { id: 'club' } });
      if (dto.cutoverPeriod && dto.cutoverPeriod !== prior?.cutoverPeriod) {
        const current = new Date(effectiveNow().getTime() + 7 * 3600000).toISOString().slice(0, 7);
        if (dto.cutoverPeriod < current || prior?.cutoverPeriod)
          throw apiError(
            HttpStatus.CONFLICT,
            'BILLING_CUTOVER_IMMUTABLE',
            'Set the cutover to this month or a future month once. Existing periods retain their billing method.',
          );
      }
      const result = await tx.careBillingPolicy.upsert({
        where: { id: 'club' },
        create: { id: 'club', ...dto, updatedById: actor.userId },
        update: { ...dto, updatedById: actor.userId },
      });
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'CARE_BILLING_POLICY_CHANGED',
        'Configured actual-usage billing and exam tariff',
        'club',
        { entityName: 'CareBillingPolicy', oldValues: prior ?? undefined, newValues: result },
        tx,
      );
      return result;
    });
  }
  async chargeExam(recordId: string, actor: CurrentUserPayload) {
    this.assertManager(actor);
    const source = await this.db.medicalRecord.findUnique({
      where: { id: recordId },
      select: { horseId: true },
    });
    if (!source) throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Record not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${source.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "MedicalRecord" WHERE "id" = ${recordId} FOR SHARE`;
      const operationKey = `${recordId}:EXAM`;
      const existing = await tx.careCostEntry.findUnique({ where: { operationKey } });
      if (existing) return existing;
      const record = await tx.medicalRecord.findUnique({
        where: { id: recordId },
        include: { veterinarian: { select: { fullName: true } } },
      });
      const policy = await tx.careBillingPolicy.findUnique({ where: { id: 'club' } });
      if (!record || record.status === 'DRAFT')
        throw apiError(
          HttpStatus.CONFLICT,
          'RECORD_NOT_FINALIZED',
          'Finalize the clinical record before recording a charge.',
        );
      if (!policy?.examUnitPrice || policy.examUnitPrice.lte(0))
        throw apiError(
          HttpStatus.CONFLICT,
          'EXAM_TARIFF_REQUIRED',
          'Configure an exam tariff before recording a charge.',
        );
      const entry = await tx.careCostEntry.create({
        data: {
          operationKey,
          horseId: record.horseId,
          medicalRecordId: record.id,
          performedAt: effectiveNow(),
          prescribedAt: record.examinationDate,
          quantity: 1,
          unit: 'EXAM',
          unitPriceSnapshot: policy.examUnitPrice,
          amount: policy.examUnitPrice,
          entryType: 'EXAM',
          actorId: actor.userId,
          supplyName: 'Clinical examination',
          recordNumber: record.recordNumber,
          veterinarianName: record.veterinarian.fullName,
        },
      });
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'EXAM_CHARGE_RECORDED',
        `Recorded exam charge for ${record.recordNumber ?? record.id}`,
        record.id,
        { entityName: 'CareCostEntry', newValues: entry },
        tx,
      );
      return entry;
    });
  }
  async reconciliation(actor: CurrentUserPayload) {
    this.assertManager(actor);
    const tasks = await this.db.dailyCareTask.findMany({
      where: { taskType: 'MEDICATION', isCompleted: false, cancelledAt: null },
      orderBy: { date: 'asc' },
      take: 500,
      select: { id: true, horseId: true, title: true, date: true, itemsSnapshotJson: true },
    });
    return {
      scanned: tasks.length,
      limit: 500,
      items: tasks
        .filter(
          (task) =>
            !Array.isArray(task.itemsSnapshotJson) ||
            !task.itemsSnapshotJson.length ||
            task.itemsSnapshotJson.some((raw) => {
              const item = raw as Record<string, unknown>;
              return (
                !item ||
                !item.supplyId ||
                !item.medicalRecordId ||
                !item.prescriptionId ||
                !item.unit
              );
            }),
        )
        .map((task) => ({
          ...task,
          reason:
            'Missing verified prescription, supply or inventory unit. Refresh from the current veterinary record; do not infer price from the medicine name.',
        })),
    };
  }
}
