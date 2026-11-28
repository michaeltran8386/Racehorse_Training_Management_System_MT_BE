import { CareBillingSettingsService } from './care-billing-settings.service';
import { CareBillingPolicyDto } from './dto/care-billing-policy.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { InvoiceLineItemsService } from './invoice-line-items.service';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InvoiceStatus, Prisma, RestockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveNow } from '../common/utils/demo-clock';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessMailService, BusinessMailEvent } from '../business-mail/business-mail.service';
import { PayOSService } from './payos.service';
import {
  invoiceIssued,
  invoicePaid,
  invoiceCancelled,
  dueSoon,
  overdueNow,
  paymentFailed,
  refundNotice,
  BillingInvoiceLike,
  HorseLike,
  OwnerLike,
} from '../business-mail/templates/billing-templates';
import { apiError } from '../common/exceptions/api-error';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { boardingMonth, calculateBoardingFee, BOARDING_MONTHLY_RATE } from './boarding-fee';

export interface FinancialActor {
  id: string | null;
  name: string;
  role: string;
}

const CLUB_OFFSET_MS = 7 * 3600000;
export const TRAINING_MONTHLY_RATE = 4_000_000;
export const MEDICAL_MONTHLY_PACKAGE_FEE = 1_000_000;
export const MEDICAL_EXAM_FEE = 3_000_000;
export const PREVENTIVE_CARE_FEE = 1_000_000;

const INVOICE_ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.SENT, InvoiceStatus.CANCELLED],
  [InvoiceStatus.SENT]: [InvoiceStatus.PAID, InvoiceStatus.OVERDUE, InvoiceStatus.CANCELLED],
  [InvoiceStatus.OVERDUE]: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PAID]: [],
  [InvoiceStatus.CANCELLED]: [],
};

function toClubBillingPeriod(date: Date): string {
  return new Date(date.getTime() + CLUB_OFFSET_MS).toISOString().slice(0, 7);
}

function serializeInvoice<
  T extends {
    boardingFee: unknown;
    boardingMonthlyRate?: unknown;
    medicalFee: unknown;
    trainingFee: unknown;
    prizeCredit: unknown;
    netAmount: unknown;
  },
>(inv: T) {
  return {
    ...inv,
    boardingFee: Number(inv.boardingFee),
    boardingMonthlyRate: inv.boardingMonthlyRate == null ? null : Number(inv.boardingMonthlyRate),
    medicalFee: Number(inv.medicalFee),
    trainingFee: Number(inv.trainingFee),
    prizeCredit: Number(inv.prizeCredit),
    netAmount: Number(inv.netAmount),
  };
}

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly businessMail: BusinessMailService,
    @Optional() private payosService?: PayOSService,
  ) {
    if (!this.payosService) {
      this.payosService = new PayOSService();
    }
  }

  getCareBillingPolicy(actor: CurrentUserPayload) {
    return new CareBillingSettingsService(this.prisma, this.audit).get(actor);
  }
  configureCareBilling(dto: CareBillingPolicyDto, actor: CurrentUserPayload) {
    return new CareBillingSettingsService(this.prisma, this.audit).configure(dto, actor);
  }
  chargeExam(recordId: string, actor: CurrentUserPayload) {
    return new CareBillingSettingsService(this.prisma, this.audit).chargeExam(recordId, actor);
  }
  usageReconciliation(actor: CurrentUserPayload) {
    return new CareBillingSettingsService(this.prisma, this.audit).reconciliation(actor);
  }

  /**
   * Gọi BusinessMailService.emit SAU khi ghi DB thành công. Lỗi mail không làm
   * hỏng giao dịch chính (Global Constraint NOTE.md §6.3).
   */
  private async emitMailSafe(event: BusinessMailEvent): Promise<boolean> {
    try {
      const mailings = await this.businessMail.emit(event);
      return mailings.some((mailing) => mailing.accepted);
    } catch (err) {
      this.logger.warn(`business-mail emit failed (${event.eventCode}): ${(err as Error).message}`);
      return false;
    }
  }

  /** Chuẩn hóa invoice + owner/horse → tham số templates billing. */
  private invoiceCtx<
    T extends {
      id: string;
      boardingFee?: unknown;
      medicalFee?: unknown;
      trainingFee?: unknown;
      prizeCredit?: unknown;
      netAmount?: unknown;
      dueAt?: unknown;
      status?: unknown;
      billingPeriod?: string;
    },
  >(
    inv: T,
    ownerId: string | null | undefined,
  ): { inv: BillingInvoiceLike; owner: OwnerLike; horse: HorseLike } {
    return {
      inv: {
        id: inv.id,
        billingPeriod: inv.billingPeriod ?? '',
        boardingFee: Number(inv.boardingFee ?? 0),
        medicalFee: inv.medicalFee == null ? undefined : Number(inv.medicalFee),
        trainingFee: inv.trainingFee == null ? undefined : Number(inv.trainingFee),
        prizeCredit: inv.prizeCredit == null ? undefined : Number(inv.prizeCredit),
        netAmount: Number(inv.netAmount ?? 0),
        dueAt: (inv.dueAt as Date | string | null) ?? null,
        status: String(inv.status ?? ''),
      },
      owner: { id: ownerId ?? '', fullName: '—' },
      horse: { id: '', name: '—' },
    };
  }

  private async emitInvoiceStatusMail(
    invoice: Prisma.FinancialInvoiceGetPayload<object>,
    previousStatus: InvoiceStatus | null,
    ownerId: string,
    horseName?: string,
  ): Promise<void> {
    const status = invoice.status;
    if (ownerId && previousStatus !== status) {
      const ctx = this.invoiceCtx(invoice, ownerId);
      ctx.owner.fullName = await this.ownerFullName(ownerId);
      ctx.horse.name = horseName ?? ctx.horse.name;
      if (status === InvoiceStatus.SENT) {
        await this.emitMailSafe({
          eventCode: 'INVOICE_ISSUED',
          recipients: [
            {
              userId: ownerId,
              body: { ...invoiceIssued(ctx.inv, ctx.horse, ctx.owner), refId: invoice.id },
            },
          ],
        });
      }
      if (status === InvoiceStatus.PAID) {
        await this.emitMailSafe({
          eventCode: 'INVOICE_PAID',
          recipients: [
            {
              userId: ownerId,
              body: {
                ...invoicePaid(ctx.inv, ctx.horse, ctx.owner, invoice.paymentRef ?? null),
                refId: invoice.id,
              },
            },
          ],
        });
      }
      if (status === InvoiceStatus.CANCELLED) {
        await this.emitMailSafe({
          eventCode: 'INVOICE_CANCELLED',
          recipients: [
            {
              userId: ownerId,
              body: { ...invoiceCancelled(ctx.inv, ctx.horse, ctx.owner), refId: invoice.id },
            },
          ],
        });
      }
      if (status === InvoiceStatus.OVERDUE) {
        await this.emitMailSafe({
          eventCode: 'INVOICE_OVERDUE',
          recipients: [
            {
              userId: ownerId,
              body: {
                ...overdueNow(ctx.inv, ctx.owner),
                milestone: 'overdue-now',
                refId: invoice.id,
              },
            },
          ],
        });
      }
    }
  }

  /** Tra tên chủ khi query hóa đơn chưa bao gồm owner. */
  private async ownerFullName(ownerId: string | null | undefined): Promise<string> {
    if (!ownerId) return '—';
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { fullName: true },
      });
      return u?.fullName ?? '—';
    } catch {
      return '—';
    }
  }

  /**
   * Lấy danh sách hóa đơn theo phân quyền
   * Chủ ngựa chỉ được xem hóa đơn đứng tên mình.
   */
  async findAll(query: QueryInvoiceDto, user: FinancialActor) {
    await this.sweepOverdue();
    const { page = 1, limit = 20, horseId, billingPeriod, status } = query;
    const skip = (page - 1) * limit;

    // Rào chắn phân quyền: HORSE_OWNER chỉ thấy hóa đơn của chính mình
    const ownerId = user.role === 'HORSE_OWNER' ? user.id : query.ownerId;

    const where: Prisma.FinancialInvoiceWhereInput = {
      ...(ownerId && { ownerId }),
      ...(horseId && { horseId }),
      ...(billingPeriod && { billingPeriod }),
      ...(status && { status }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ billingPeriod: 'desc' }, { createdAt: 'desc' }],
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              avatarUrl: true,
            },
          },
          owner: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      }),
      this.prisma.financialInvoice.count({ where }),
    ]);

    return {
      items: items.map((inv) => ({
        ...inv,
        boardingFee: Number(inv.boardingFee),
        boardingMonthlyRate:
          inv.boardingMonthlyRate == null ? null : Number(inv.boardingMonthlyRate),
        medicalFee: Number(inv.medicalFee),
        trainingFee: Number(inv.trainingFee),
        prizeCredit: Number(inv.prizeCredit),
        netAmount: Number(inv.netAmount),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Xem chi tiết hóa đơn
   */
  async findOne(id: string, user: FinancialActor) {
    await this.sweepOverdue();
    const invoice = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: {
        horse: true,
        lineItems: { orderBy: [{ performedAt: 'asc' }, { id: 'asc' }] },
        owner: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
      },
    });

    if (!invoice) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (user.role === 'HORSE_OWNER' && invoice.ownerId !== user.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn chỉ được xem bảng kê của ngựa mình sở hữu.',
      );
    }

    return {
      ...invoice,
      boardingFee: Number(invoice.boardingFee),
      boardingMonthlyRate:
        invoice.boardingMonthlyRate == null ? null : Number(invoice.boardingMonthlyRate),
      medicalFee: Number(invoice.medicalFee),
      trainingFee: Number(invoice.trainingFee),
      prizeCredit: Number(invoice.prizeCredit),
      netAmount: Number(invoice.netAmount),
    };
  }

  /**
   * Tự động tính phí y tế, huấn luyện và khấu trừ tiền thưởng cho ngựa trong kỳ thanh toán.
   */
  private async calculateAutomaticServiceFees(
    horseId: string,
    start: Date,
    end: Date,
    boardingDays: number,
    db: any = this.prisma,
  ): Promise<{ medicalFee: number; trainingFee: number; prizeCredit: number }> {
    const [examCount, preventiveCount, activePlanCount, workoutCount, settledResults] =
      await Promise.all([
        typeof db?.medicalRecord?.count === 'function'
          ? db.medicalRecord.count({
              where: {
                horseId,
                status: { not: 'DRAFT' },
                examinationDate: { gte: start, lt: end },
              },
            })
          : 0,
        typeof db?.preventiveSchedule?.count === 'function'
          ? db.preventiveSchedule.count({
              where: {
                horseId,
                status: 'COMPLETED',
                completedDate: { gte: start, lt: end },
              },
            })
          : 0,
        typeof db?.trainingPlan?.count === 'function'
          ? db.trainingPlan.count({
              where: {
                horseId,
                status: { in: ['ACTIVE', 'COMPLETED'] },
                startDate: { lt: end },
                endDate: { gte: start },
              },
            })
          : 0,
        typeof db?.workoutSession?.count === 'function'
          ? db.workoutSession.count({
              where: {
                horseId,
                status: { in: ['COMPLETED', 'SCHEDULED'] },
                scheduledDate: { gte: start, lt: end },
              },
            })
          : 0,
        typeof db?.tournamentResult?.findMany === 'function'
          ? db.tournamentResult.findMany({
              where: {
                settledAt: { gte: start, lt: end },
                registration: { horseId },
              },
              select: { netOwnerPayout: true, prizeMoneyWon: true },
            })
          : [],
      ]);

    const hasMedicalActivity = examCount > 0 || preventiveCount > 0;
    const medicalFee = hasMedicalActivity ? MEDICAL_MONTHLY_PACKAGE_FEE : 0;
    const hasTrainingActivity = boardingDays > 0 || activePlanCount > 0 || workoutCount > 0;
    const trainingFee = hasTrainingActivity ? TRAINING_MONTHLY_RATE : 0;
    const prizeCredit = Array.isArray(settledResults)
      ? settledResults.reduce(
          (sum: number, r: { netOwnerPayout?: unknown; prizeMoneyWon?: unknown }) =>
            sum + Number(r.netOwnerPayout ?? r.prizeMoneyWon ?? 0),
          0,
        )
      : 0;

    return { medicalFee, trainingFee, prizeCredit };
  }

  /**
   * Tạo hóa đơn tài chính mới (Club Manager)
   */
  async create(dto: CreateInvoiceDto, user: FinancialActor) {
    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${dto.horseId} FOR UPDATE`;
      return this.createInvoice(tx, dto, user);
    });
    try {
      await this.audit.record(
        { id: user.id, name: user.name },
        'INVOICE_CREATED',
        `Created invoice ${invoice.id}`,
        invoice.id,
        { entityName: 'FinancialInvoice', newValues: invoice },
      );
    } catch (error) {
      this.logger.warn(`Invoice committed; audit notification failed: ${String(error)}`);
    }
    await this.emitInvoiceStatusMail(invoice, null, invoice.ownerId, invoice.horse?.name);
    return serializeInvoice(invoice);
  }

  private async createInvoice(
    tx: Prisma.TransactionClient,
    dto: CreateInvoiceDto,
    _user: FinancialActor,
  ) {
    if (
      dto.status &&
      ![InvoiceStatus.DRAFT, InvoiceStatus.SENT].includes(dto.status as 'DRAFT' | 'SENT')
    )
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_INITIAL_INVOICE_STATUS',
        'New invoices must be draft or issued for payment.',
      );
    const { start, end } = boardingMonth(dto.billingPeriod);
    if (end > effectiveNow()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BILLING_PERIOD_NOT_CLOSED',
        'Chỉ được lập hóa đơn cho tháng đã kết thúc.',
      );
    }
    let resolvedOwnerId = dto.ownerId;
    if (typeof tx?.horse?.findUnique === 'function') {
      const horse = await tx.horse.findUnique({
        where: { id: dto.horseId },
        select: { id: true, ownerId: true, name: true, status: true },
      });
      if (!horse) {
        throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy ngựa.');
      }
      resolvedOwnerId = horse.ownerId || dto.ownerId;
      if (!resolvedOwnerId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'HORSE_HAS_NO_OWNER',
          `Ngựa ${horse.name} chưa có chủ để lập hóa đơn.`,
        );
      }
      if (dto.ownerId && horse.ownerId && dto.ownerId !== horse.ownerId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'OWNER_MISMATCH',
          'Chủ ngựa được chọn không khớp với chủ hiện tại của ngựa.',
        );
      }
    }
    if (!resolvedOwnerId) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_HAS_NO_OWNER',
        'Không thể lập hóa đơn khi ngựa chưa có chủ.',
      );
    }

    const allocations = await tx.stallAllocation.findMany({
      where: {
        horseId: dto.horseId,
        startDate: { lt: end },
        OR: [{ endDate: null }, { endDate: { gte: start } }],
      },
    });
    if (typeof tx?.financialInvoice?.findFirst === 'function') {
      const existingActive = await tx.financialInvoice.findFirst({
        where: {
          horseId: dto.horseId,
          billingPeriod: dto.billingPeriod,
          status: { not: InvoiceStatus.CANCELLED },
        },
        select: { id: true },
      });
      if (existingActive) {
        throw apiError(
          HttpStatus.CONFLICT,
          'DUPLICATE_INVOICE_FOR_PERIOD',
          `Ngựa này đã có bảng kê đang hiệu lực cho kỳ ${dto.billingPeriod}.`,
        );
      }
    }
    const calculated = calculateBoardingFee(dto.billingPeriod, allocations);
    const boardingFee = calculated.boardingFee.toNumber();
    const fees = await this.calculateAutomaticServiceFees(
      dto.horseId,
      start,
      end,
      calculated.boardingDays,
      tx,
    );
    const policy = await tx.careBillingPolicy.findUnique({ where: { id: 'club' } });
    const actualUsage = Boolean(policy?.cutoverPeriod && dto.billingPeriod >= policy.cutoverPeriod);
    const usage = actualUsage
      ? await new InvoiceLineItemsService().available(
          tx,
          dto.horseId,
          start,
          end,
          policy!.cutoverPeriod!,
        )
      : null;
    const medicalFee = usage ? usage.medicalFee.toNumber() : fees.medicalFee;
    const { trainingFee, prizeCredit } = fees;
    const netAmount = boardingFee + medicalFee + trainingFee - prizeCredit;

    const invoice = await tx.financialInvoice.create({
      data: {
        horseId: dto.horseId,
        ownerId: resolvedOwnerId,
        billingPeriod: dto.billingPeriod,
        boardingDays: calculated.boardingDays,
        boardingMonthlyRate: BOARDING_MONTHLY_RATE,
        boardingFee,
        medicalFee,
        billingMethod: actualUsage ? 'ACTUAL_USAGE' : 'LEGACY_PACKAGE',
        ...(usage && { lineItems: { create: usage.lines } }),
        trainingFee,
        prizeCredit,
        netAmount,
        status: dto.status ?? InvoiceStatus.DRAFT,
        ...(dto.status === InvoiceStatus.SENT && {
          dueAt: new Date(effectiveNow().getTime() + 7 * 86400000),
        }),
        invoiceUrl: dto.invoiceUrl,
      },
      include: {
        lineItems: true,
        horse: { select: { name: true } },
        owner: { select: { fullName: true } },
      },
    });

    if (actualUsage) await new InvoiceLineItemsService().claim(tx, invoice.id, usage!.entries);
    return invoice;
  }

  /**
   * Cập nhật hóa đơn
   */
  async update(id: string, dto: UpdateInvoiceDto, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({ where: { id } });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (existing.status === InvoiceStatus.PAID) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVOICE_ALREADY_PAID',
        'Không thể sửa hóa đơn đã thanh toán.',
      );
    }

    if (
      existing.billingMethod === 'ACTUAL_USAGE' &&
      (dto.medicalFee !== undefined || dto.billingPeriod !== undefined)
    )
      throw apiError(
        HttpStatus.CONFLICT,
        'USAGE_INVOICE_READ_ONLY',
        'Usage fees and billing period are immutable snapshots. Cancel and reissue, or create a ledger adjustment.',
      );
    const isEditingFees =
      dto.boardingFee !== undefined ||
      dto.medicalFee !== undefined ||
      dto.trainingFee !== undefined ||
      dto.prizeCredit !== undefined ||
      (dto.billingPeriod !== undefined && dto.billingPeriod !== existing.billingPeriod);

    if (existing.status && existing.status !== InvoiceStatus.DRAFT && isEditingFees) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVOICE_NOT_EDITABLE',
        'Chỉ sửa được phí dịch vụ khi hóa đơn còn ở trạng thái Chưa gửi.',
      );
    }

    if (dto.status !== undefined && existing.status && dto.status !== existing.status) {
      const allowedNext = INVOICE_ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowedNext.includes(dto.status)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_INVOICE_STATUS_TRANSITION',
          `Không thể chuyển hóa đơn từ ${existing.status} sang ${dto.status}. Trạng thái hợp lệ tiếp theo: ${allowedNext.join(', ') || 'không có'}.`,
        );
      }
    }

    const boardingFee =
      dto.boardingFee !== undefined ? dto.boardingFee : Number(existing.boardingFee);
    if (
      existing.boardingDays != null &&
      (boardingFee !== Number(existing.boardingFee) ||
        (dto.billingPeriod !== undefined && dto.billingPeriod !== existing.billingPeriod))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BOARDING_FEE_READ_ONLY',
        'Phí lưu chuồng và số ngày được tính tự động theo thời gian ngựa ở, không sửa tay.',
      );
    }
    const medicalFee = dto.medicalFee !== undefined ? dto.medicalFee : Number(existing.medicalFee);
    const trainingFee =
      dto.trainingFee !== undefined ? dto.trainingFee : Number(existing.trainingFee);
    const prizeCredit =
      dto.prizeCredit !== undefined ? dto.prizeCredit : Number(existing.prizeCredit);
    const netAmount = boardingFee + medicalFee + trainingFee - prizeCredit;

    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${existing.horseId} FOR UPDATE`;
        const changed = await tx.financialInvoice.update({
          where: { id, status: existing.status, updatedAt: existing.updatedAt },
          data: {
            ...(dto.billingPeriod && { billingPeriod: dto.billingPeriod }),
            boardingFee,
            medicalFee,
            trainingFee,
            prizeCredit,
            netAmount,
            ...(dto.status && { status: dto.status }),
            ...(dto.status === InvoiceStatus.SENT &&
              existing.status === InvoiceStatus.DRAFT &&
              !existing.dueAt && { dueAt: new Date(effectiveNow().getTime() + 7 * 86400000) }),
            ...(dto.invoiceUrl !== undefined && { invoiceUrl: dto.invoiceUrl }),
          },
          include: {
            horse: { select: { id: true, name: true, horseCode: true } },
            owner: { select: { id: true, fullName: true, email: true } },
          },
        });
        if (changed.status === InvoiceStatus.CANCELLED)
          await tx.careCostClaim.deleteMany({ where: { invoiceId: id } });
        return changed;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
          throw apiError(
            HttpStatus.CONFLICT,
            'INVOICE_CHANGED',
            'Invoice changed. Refresh before trying again.',
          );
        throw error;
      });

    if (dto.status === InvoiceStatus.OVERDUE) {
      await this.applyDebtImpoundToHorses([existing.horseId]);
      await this.applyBadDebtToOwners([existing.ownerId]);
    } else if (dto.status === InvoiceStatus.PAID || dto.status === InvoiceStatus.CANCELLED) {
      await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);
    }

    // Điều chỉnh / hoàn tiền (NOTE.md §6.2 dòng 347): khi số tiền chủ phải trả GIẢM
    // (điều chỉnh phí hoặc cấn trừ tiền thưởng tăng) → báo chủ bằng chứng từ thay thế.
    const oldNet = Number(existing.netAmount);
    const newNet = Number(updated.netAmount);
    if (newNet < oldNet) {
      const ctx = this.invoiceCtx(updated, existing.ownerId);
      ctx.owner.fullName = updated.owner?.fullName ?? ctx.owner.fullName;
      ctx.horse.name = updated.horse?.name ?? ctx.horse.name;
      await this.emitMailSafe({
        eventCode: 'REFUND_NOTIFIED',
        recipients: [
          {
            userId: existing.ownerId,
            body: {
              ...refundNotice(
                ctx.inv,
                oldNet,
                newNet,
                dto.notes || 'Điều chỉnh hóa đơn theo đối soát của Câu lạc bộ',
                ctx.owner,
              ),
              refId: id,
              milestone: updated.updatedAt.toISOString(),
            },
          },
        ],
      });
    }

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_UPDATED',
      `Updated invoice ${id} (${updated.billingPeriod})`,
      id,
      { entityName: 'FinancialInvoice', oldValues: existing, newValues: updated },
    );

    await this.emitInvoiceStatusMail(
      updated,
      existing.status,
      existing.ownerId,
      updated.horse?.name,
    );

    return serializeInvoice(updated);
  }

  /**
   * Đổi trạng thái hóa đơn (DRAFT -> SENT -> PAID | OVERDUE | CANCELLED)
   */
  async changeStatus(id: string, status: InvoiceStatus, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    // Chủ ngựa không tự đổi trạng thái (kể cả PAID): báo chuyển khoản qua POST :id/pay, CM đối soát.
    if (user.role === 'HORSE_OWNER') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'PAYMENT_NEEDS_RECONCILIATION',
        'Owners report a transfer; the Club Manager confirms the payment.',
      );
    }

    if (existing.status === InvoiceStatus.PAID && status !== InvoiceStatus.PAID) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVOICE_ALREADY_PAID',
        'Không thể sửa hóa đơn đã thanh toán.',
      );
    }

    if (existing.status !== status) {
      const allowedNext = INVOICE_ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowedNext.includes(status)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_INVOICE_STATUS_TRANSITION',
          `Không thể chuyển hóa đơn từ ${existing.status} sang ${status}. Trạng thái hợp lệ tiếp theo: ${allowedNext.join(', ') || 'không có'}.`,
        );
      }
    }
    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${existing.horseId} FOR UPDATE`;
        const changed = await tx.financialInvoice.update({
          where: { id, status: existing.status, updatedAt: existing.updatedAt },
          data: {
            status,
            ...(status === InvoiceStatus.PAID &&
              existing.status !== InvoiceStatus.PAID && {
                paidAt: effectiveNow(),
                paidConfirmedById: user.id,
                paidConfirmedByName: user.name,
              }),
            ...(status === InvoiceStatus.SENT &&
              existing.status === InvoiceStatus.DRAFT &&
              !existing.dueAt && {
                dueAt: new Date(effectiveNow().getTime() + 7 * 86400000),
              }),
          },
        });
        if (changed.status === InvoiceStatus.CANCELLED)
          await tx.careCostClaim.deleteMany({ where: { invoiceId: id } });
        return changed;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
          throw apiError(
            HttpStatus.CONFLICT,
            'INVOICE_CHANGED',
            'Invoice changed. Refresh before trying again.',
          );
        throw error;
      });

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_STATUS_CHANGED',
      `Changed invoice ${id} status from ${existing.status} to ${status}`,
      id,
      {
        entityName: 'FinancialInvoice',
        oldValues: { status: existing.status },
        newValues: { status },
      },
    );

    if (status === InvoiceStatus.OVERDUE) {
      await this.applyDebtImpoundToHorses([existing.horseId]);
      await this.applyBadDebtToOwners([existing.ownerId]);
    } else if (status === InvoiceStatus.PAID || status === InvoiceStatus.CANCELLED) {
      await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);
    }

    // Nếu gửi hóa đơn (SENT), gửi thông báo cho Chủ ngựa
    if (status === InvoiceStatus.SENT && existing.ownerId) {
      await this.notifications.notifyUsers(
        [existing.ownerId],
        {
          type: 'INVOICE_SENT',
          category: 'ACCOUNT',
          title: 'Sao kê chi phí & Tiền thưởng tháng mới',
          message: `Báo cáo tài chính kỳ ${existing.billingPeriod} cho ngựa ${existing.horse.name} đã được gửi.`,
          link: `/owner/financial-reports?highlight=${encodeURIComponent(id)}`,
          params: { billingPeriod: existing.billingPeriod, horseName: existing.horse.name },
        },
        user.id ?? undefined,
      );
    }

    await this.emitInvoiceStatusMail(
      updated,
      existing.status,
      existing.ownerId,
      existing.horse?.name,
    );

    return {
      ...updated,
      boardingFee: Number(updated.boardingFee),
      boardingMonthlyRate:
        updated.boardingMonthlyRate == null ? null : Number(updated.boardingMonthlyRate),
      medicalFee: Number(updated.medicalFee),
      trainingFee: Number(updated.trainingFee),
      prizeCredit: Number(updated.prizeCredit),
      netAmount: Number(updated.netAmount),
    };
  }

  /**
   * Thanh toán hóa đơn trực tuyến cho Chủ ngựa
   */
  async payInvoice(
    id: string,
    paymentData: { paymentMethod?: string; transactionRef?: string },
    user: FinancialActor,
  ) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (user.role === 'HORSE_OWNER' && existing.ownerId !== user.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn chỉ được thanh toán hóa đơn ngựa của mình.',
      );
    }

    if (existing.status !== InvoiceStatus.SENT && existing.status !== InvoiceStatus.OVERDUE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS',
        'Chỉ thanh toán được hóa đơn Đã gửi hoặc Quá hạn.',
      );
    }
    if (Number(existing.netAmount) <= 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_AMOUNT',
        'Hóa đơn không còn số dư dương để thanh toán.',
      );
    }

    const method = paymentData?.paymentMethod || 'BANK_TRANSFER';
    const ref = paymentData?.transactionRef?.trim().slice(0, 100) || null;

    // Chủ ngựa: chỉ báo đã chuyển khoản => "Chờ đối soát". Gửi lại = cập nhật mã tham chiếu, không đổi trạng thái.
    if (user.role === 'HORSE_OWNER') {
      const reported = await this.prisma.financialInvoice.update({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data: { paymentReportedAt: effectiveNow(), paymentMethod: method, paymentRef: ref },
      });
      await this.audit.record(
        { id: user.id, name: user.name },
        'INVOICE_PAYMENT_REPORTED',
        `Owner reported a ${method} payment for invoice ${id} (${existing.billingPeriod}); awaiting reconciliation`,
        id,
        { entityName: 'FinancialInvoice', newValues: { paymentMethod: method, paymentRef: ref } },
      );
      return serializeInvoice(reported);
    }

    // Club Manager đối soát: tiền đã vào => PAID, rồi đánh giá lại hạn chế do nợ.
    const updated = await this.prisma.financialInvoice.update({
      where: { id, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: effectiveNow(),
        paidConfirmedById: user.id,
        paidConfirmedByName: user.name,
        paymentMethod: existing.paymentMethod ?? method,
        paymentRef: existing.paymentRef ?? ref,
      },
    });

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_PAID',
      `Invoice ${id} (${existing.billingPeriod}) for horse ${existing.horse.name}: payment confirmed by ${user.name}`,
      id,
      {
        entityName: 'FinancialInvoice',
        oldValues: { status: existing.status },
        newValues: { status: InvoiceStatus.PAID, ...paymentData },
      },
    );

    await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);

    // Mail chứng từ PAID (chứng từ: số tiền, mã giao dịch, thời điểm) — NOTE.md §6.2
    if (existing.ownerId) {
      const ctx = this.invoiceCtx(updated, existing.ownerId);
      ctx.owner.fullName = await this.ownerFullName(existing.ownerId);
      ctx.horse.name = existing.horse?.name ?? ctx.horse.name;
      await this.emitMailSafe({
        eventCode: 'INVOICE_PAID',
        recipients: [
          {
            userId: existing.ownerId,
            body: {
              ...invoicePaid(ctx.inv, ctx.horse, ctx.owner, updated.paymentRef ?? ref),
              refId: id,
            },
          },
        ],
      });
    }

    return {
      ...updated,
      boardingFee: Number(updated.boardingFee),
      boardingMonthlyRate:
        updated.boardingMonthlyRate == null ? null : Number(updated.boardingMonthlyRate),
      medicalFee: Number(updated.medicalFee),
      trainingFee: Number(updated.trainingFee),
      prizeCredit: Number(updated.prizeCredit),
      netAmount: Number(updated.netAmount),
    };
  }

  /**
   * 6.2 dòng 346 — ghi nhận thanh toán THẤT BẠI khi CM đối soát phát hiện giao dịch lỗi.
   * Gửi mail PAYMENT_FAILED cho người thực hiện giao dịch (chủ ngựa); KHÔNG nói "đã thanh toán".
   */
  async recordPaymentFailure(
    id: string,
    detail: { txRef?: string; reason?: string },
    user: FinancialActor,
  ): Promise<void> {
    if (user.role !== 'CLUB_MANAGER') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Club Manager mới được ghi nhận thanh toán thất bại.',
      );
    }
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (
      ![InvoiceStatus.SENT, InvoiceStatus.OVERDUE].includes(
        existing.status as 'SENT' | 'OVERDUE',
      ) ||
      Number(existing.netAmount) <= 0
    ) {
      throw apiError(HttpStatus.BAD_REQUEST, 'INVALID_STATUS', 'Invoice has no payable balance.');
    }

    const ctx = this.invoiceCtx(existing, existing.ownerId);
    ctx.owner.fullName = await this.ownerFullName(existing.ownerId);
    ctx.horse.name = existing.horse?.name ?? ctx.horse.name;
    await this.emitMailSafe({
      eventCode: 'PAYMENT_FAILED',
      recipients: [
        {
          userId: existing.ownerId,
          body: {
            ...paymentFailed(ctx.inv, detail?.txRef ?? existing.paymentRef ?? null),
            refId: id,
          },
        },
      ],
    });
  }

  /**
   * Nhắc nợ THỦ CÔNG (nút [🔔 Nhắc nợ] của Club Manager — Task 8). Milestone 'manual'
   * riêng để không phá mốc tự động của cron (dedupeKey theo refId + milestone).
   */
  async remindInvoice(id: string, user: FinancialActor): Promise<{ sent: boolean }> {
    if (user.role !== 'CLUB_MANAGER') {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Chỉ Club Manager được nhắc nợ chủ ngựa.');
    }
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (
      ![InvoiceStatus.SENT, InvoiceStatus.OVERDUE].includes(
        existing.status as 'SENT' | 'OVERDUE',
      ) ||
      Number(existing.netAmount) <= 0
    ) {
      throw apiError(HttpStatus.BAD_REQUEST, 'INVALID_STATUS', 'Invoice has no payable balance.');
    }

    const ctx = this.invoiceCtx(existing, existing.ownerId);
    ctx.owner.fullName = await this.ownerFullName(existing.ownerId);
    ctx.horse.name = existing.horse?.name ?? ctx.horse.name;
    const sent = await this.emitMailSafe({
      eventCode: 'MANUAL_REMIND',
      recipients: [
        {
          userId: existing.ownerId,
          body: {
            ...(existing.status === InvoiceStatus.OVERDUE
              ? overdueNow(ctx.inv, ctx.owner)
              : dueSoon(ctx.inv, ctx.horse, ctx.owner)),
            milestone: 'manual',
            refId: id,
          },
        },
      ],
    });
    return { sent };
  }

  /**
   * Tổng hợp báo cáo tài chính của Chủ ngựa (SC-5.06)
   */
  async getOwnerSummary(ownerId?: string) {
    await this.sweepOverdue();
    const where = ownerId ? { ownerId } : {};
    const invoices = await this.prisma.financialInvoice.findMany({
      where,
      include: {
        lineItems: { orderBy: [{ performedAt: 'asc' }, { id: 'asc' }] },
        horse: { select: { id: true, name: true, horseCode: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { billingPeriod: 'desc' },
    });

    let totalBoarding = 0;
    let totalMedical = 0;
    let totalTraining = 0;
    let totalPrizeCredit = 0;
    let totalNet = 0;

    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;
      totalBoarding += Number(inv.boardingFee);
      totalMedical += Number(inv.medicalFee);
      totalTraining += Number(inv.trainingFee);
      totalPrizeCredit += Number(inv.prizeCredit);
      totalNet += Number(inv.netAmount);
    }

    return {
      totalBoarding,
      totalMedical,
      totalTraining,
      totalExpense: totalBoarding + totalMedical + totalTraining,
      totalPrizeCredit,
      totalNet,
      outstandingDebt: invoices.reduce(
        (sum, inv) =>
          inv.status === InvoiceStatus.SENT || inv.status === InvoiceStatus.OVERDUE
            ? sum + Math.max(0, Number(inv.netAmount))
            : sum,
        0,
      ),
      invoiceCount: invoices.length,
      invoices: invoices.map((inv) => ({
        ...inv,
        boardingFee: Number(inv.boardingFee),
        boardingMonthlyRate:
          inv.boardingMonthlyRate == null ? null : Number(inv.boardingMonthlyRate),
        medicalFee: Number(inv.medicalFee),
        trainingFee: Number(inv.trainingFee),
        prizeCredit: Number(inv.prizeCredit),
        netAmount: Number(inv.netAmount),
      })),
    };
  }

  async sweepOverdue(): Promise<number> {
    const overdueCandidates = await this.prisma.financialInvoice.findMany({
      where: { status: InvoiceStatus.SENT, dueAt: { lt: effectiveNow() }, netAmount: { gt: 0 } },
      select: {
        id: true,
        horseId: true,
        ownerId: true,
        billingPeriod: true,
        boardingFee: true,
        medicalFee: true,
        trainingFee: true,
        prizeCredit: true,
        netAmount: true,
        dueAt: true,
        status: true,
        horse: { select: { name: true } },
      },
    });

    const { count } = await this.prisma.financialInvoice.updateMany({
      where: { status: InvoiceStatus.SENT, dueAt: { lt: effectiveNow() }, netAmount: { gt: 0 } },
      data: { status: InvoiceStatus.OVERDUE },
    });

    if (overdueCandidates && overdueCandidates.length > 0) {
      const horseIds = Array.from(new Set(overdueCandidates.map((i) => i.horseId)));
      const ownerIds = Array.from(new Set(overdueCandidates.map((i) => i.ownerId)));
      await this.applyDebtImpoundToHorses(horseIds);
      await this.applyBadDebtToOwners(ownerIds);

      // Mốc vừa quá hạn tách riêng các mốc nhắc 3/7 ngày.
      for (const inv of overdueCandidates) {
        if (!inv.ownerId || Number(inv.netAmount) <= 0) continue;
        const ctx = this.invoiceCtx(inv, inv.ownerId);
        ctx.owner.fullName = await this.ownerFullName(inv.ownerId);
        ctx.horse.name = inv.horse?.name ?? ctx.horse.name;
        await this.emitMailSafe({
          eventCode: 'INVOICE_OVERDUE',
          recipients: [
            {
              userId: inv.ownerId,
              body: { ...overdueNow(ctx.inv, ctx.owner), milestone: 'overdue-now', refId: inv.id },
            },
          ],
        });
      }
    }

    return count;
  }

  async applyDebtImpoundToHorses(horseIds: string[]) {
    if (horseIds.length === 0 || !this.prisma.horse?.updateMany) return;
    await this.prisma.horse.updateMany({
      where: { id: { in: horseIds } },
      data: {
        isDebtImpounded: true,
        debtImpoundedAt: effectiveNow(),
        debtImpoundReason: 'Overdue boarding / stabling fees.',
      },
    });
  }

  async applyBadDebtToOwners(ownerIds: string[]) {
    if (ownerIds.length === 0 || !this.prisma.user?.updateMany) return;
    await this.prisma.user.updateMany({
      where: { id: { in: ownerIds } },
      data: {
        isBadDebtFlagged: true,
        badDebtFlaggedAt: effectiveNow(),
        badDebtReason: 'Có hóa đơn dịch vụ lưu chuồng quá hạn thanh toán.',
      },
    });
  }

  async checkAndReleaseDebtSanctions(horseId: string, ownerId: string, actor: FinancialActor) {
    if (!this.prisma.financialInvoice?.count) return;

    // 1. Kiểm tra xem ngựa này còn hóa đơn nào OVERDUE không
    const remainingHorseOverdue = await this.prisma.financialInvoice.count({
      where: { horseId, status: InvoiceStatus.OVERDUE, netAmount: { gt: 0 } },
    });
    if (remainingHorseOverdue === 0 && this.prisma.horse?.update) {
      await this.prisma.horse.update({
        where: { id: horseId },
        data: {
          isDebtImpounded: false,
          debtImpoundedAt: null,
          debtImpoundReason: null,
        },
      });
      await this.audit.record(
        { id: actor.id, name: actor.name },
        'HORSE_DEBT_RELEASED',
        `Horse ${horseId} was released from debt impound following full invoice payment`,
        horseId,
        { entityName: 'Horse', newValues: { isDebtImpounded: false } },
      );
    }

    // 2. Kiểm tra xem chủ ngựa còn hóa đơn nào OVERDUE trên bất kỳ ngựa nào không
    const remainingOwnerOverdue = await this.prisma.financialInvoice.count({
      where: { ownerId, status: InvoiceStatus.OVERDUE, netAmount: { gt: 0 } },
    });
    if (remainingOwnerOverdue === 0 && this.prisma.user?.update) {
      await this.prisma.user.update({
        where: { id: ownerId },
        data: {
          isBadDebtFlagged: false,
          badDebtFlaggedAt: null,
          badDebtReason: null,
        },
      });
      await this.audit.record(
        { id: actor.id, name: actor.name },
        'OWNER_BAD_DEBT_CLEARED',
        `Owner ${ownerId} bad debt flag was cleared following full invoice payment`,
        ownerId,
        { entityName: 'User', newValues: { isBadDebtFlagged: false } },
      );
    }
  }

  /** Closed months only: a payment settles its own period, never the next month. */
  async generateMonthlyDrafts(billingPeriod: string, user: FinancialActor) {
    const { start, end } = boardingMonth(billingPeriod);
    if (end > effectiveNow()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BILLING_PERIOD_NOT_CLOSED',
        'Chỉ được lập hóa đơn cho tháng đã kết thúc.',
      );
    }
    // Serializable retries prevent duplicate invoices when manual and scheduled runs overlap.
    let createdCount = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        createdCount = await this.prisma.$transaction(
          async (tx) => {
            const horses = await tx.horse.findMany({
              where: {
                ownerId: { not: null },
                OR: [
                  {
                    stallAllocations: {
                      some: {
                        startDate: { lt: end },
                        OR: [{ endDate: null }, { endDate: { gte: start } }],
                      },
                    },
                  },
                  {
                    careCostEntries: {
                      some: {
                        claim: { is: null },
                        performedAt: { lt: end },
                        OR: [
                          { performedAt: { gte: start } },
                          { entryType: 'REVERSAL', reversesEntry: { claim: { isNot: null } } },
                        ],
                      },
                    },
                  },
                ],
              },
              orderBy: { id: 'asc' },
              include: {
                stallAllocations: {
                  where: {
                    startDate: { lt: end },
                    OR: [{ endDate: null }, { endDate: { gte: start } }],
                  },
                },
              },
            });
            let count = 0;
            for (const horse of horses) {
              if (!horse.ownerId) continue;
              const existing = await tx.financialInvoice.findFirst({
                where: { horseId: horse.id, ownerId: horse.ownerId, billingPeriod },
              });
              if (existing) continue;
              await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${horse.id} FOR UPDATE`;
              await this.createInvoice(
                tx,
                {
                  horseId: horse.id,
                  ownerId: horse.ownerId,
                  billingPeriod,
                  status: InvoiceStatus.DRAFT,
                },
                user,
              );
              count++;
            }
            return count;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw err;
      }
    }

    await this.audit.record(
      { id: user.id, name: user.name },
      'MONTHLY_INVOICES_GENERATED',
      `Generated ${createdCount} unissued invoices for billing period ${billingPeriod}`,
      billingPeriod,
      { entityName: 'FinancialInvoice', newValues: { count: createdCount, billingPeriod } },
    );

    return {
      success: true,
      createdCount,
      billingPeriod,
    };
  }

  /**
   * Báo cáo sao kê công nợ 2 tầng cho Chủ ngựa (Executive Summary & Drill-down chi tiết)
   * Tránh quá tải thông tin theo nguyên tắc Progressive Disclosure
   */
  async getOwnerStatementBreakdown(ownerId?: string, billingPeriod?: string) {
    await this.sweepOverdue();
    const where: any = {};
    if (ownerId) where.ownerId = ownerId;
    if (billingPeriod) where.billingPeriod = billingPeriod;

    const invoices = await this.prisma.financialInvoice.findMany({
      where,
      include: {
        lineItems: { orderBy: [{ performedAt: 'asc' }, { id: 'asc' }] },
        horse: { select: { id: true, name: true, horseCode: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { billingPeriod: 'desc' },
    });

    let totalBoarding = 0;
    let totalMedical = 0;
    let totalTraining = 0;
    let totalPrizeCredit = 0;
    let totalNet = 0;

    for (const inv of invoices) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;
      totalBoarding += Number(inv.boardingFee);
      totalMedical += Number(inv.medicalFee);
      totalTraining += Number(inv.trainingFee);
      totalPrizeCredit += Number(inv.prizeCredit);
      totalNet += Number(inv.netAmount);
    }

    const totalExpense = totalBoarding + totalMedical + totalTraining;
    const finalBalanceDue = totalNet;

    const horseIds = Array.from(new Set(invoices.map((i) => i.horseId).filter(Boolean)));
    const raceResults =
      horseIds.length > 0
        ? await this.prisma.tournamentResult.findMany({
            where: {
              registration: {
                horseId: { in: horseIds },
                ...(ownerId && {
                  horse: { ownerId },
                }),
              },
            },
            include: {
              registration: {
                include: {
                  tournament: { select: { id: true, name: true, raceDate: true, location: true } },
                  horse: { select: { id: true, name: true, horseCode: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : [];

    const raceSettlements = raceResults.map((r: any) => ({
      tournamentId: r.registration?.tournament?.id,
      tournamentName: r.registration?.tournament?.name || 'Giải đua',
      raceDate: r.registration?.tournament?.raceDate,
      horseName: r.registration?.horse?.name || '-',
      finalRank: r.finalRank,
      grossPrize: Number(r.grossPrize || r.prizeMoneyWon || 0),
      trainerCut: Number(r.trainerCut || 0),
      jockeyCut: Number(r.jockeyCut || 0),
      entryFeeDeducted: Number(r.entryFeeDeducted || 0),
      netOwnerPayout: Number(r.netOwnerPayout || r.prizeMoneyWon || 0),
      settledAt: r.settledAt || r.createdAt,
    }));

    return {
      summary: {
        billingPeriod: billingPeriod || 'ALL',
        totalBoarding,
        totalMedical,
        totalTraining,
        totalExpense,
        totalRaceNet: totalPrizeCredit,
        finalBalanceDue,
        isSurplus: finalBalanceDue < 0,
        surplusAmount: finalBalanceDue < 0 ? Math.abs(finalBalanceDue) : 0,
        invoiceCount: invoices.length,
      },
      drilldown: {
        invoices: invoices.map((inv) => ({
          id: inv.id,
          billingPeriod: inv.billingPeriod,
          horseName: inv.horse?.name || '-',
          boardingFee: Number(inv.boardingFee),
          boardingDays: inv.boardingDays,
          billingMethod: inv.billingMethod,
          medicalLineItems: inv.lineItems,
          medicalFee: Number(inv.medicalFee),
          trainingFee: Number(inv.trainingFee),
          prizeCredit: Number(inv.prizeCredit),
          netAmount: Number(inv.netAmount),
          status: inv.status,
          dueAt: inv.dueAt,
        })),
        raceSettlements,
      },
    };
  }

  /**
   * Tổng hợp Thu – Chi nội bộ CLB cho Club Manager (Hóa đơn Chủ ngựa + Phiếu nhập vật tư DELIVERED)
   */
  async getClubCashflow(billingPeriod?: string) {
    const selectedPeriod =
      billingPeriod && billingPeriod !== 'ALL'
        ? (boardingMonth(billingPeriod), billingPeriod)
        : 'ALL';

    await this.sweepOverdue();

    const [invoices, restocks] = await Promise.all([
      this.prisma.financialInvoice.findMany({
        include: {
          horse: { select: { id: true, name: true, horseCode: true, breed: true } },
          owner: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: [{ billingPeriod: 'desc' }, { createdAt: 'desc' }],
      }),
      typeof (this.prisma as any).restockRequest?.findMany === 'function'
        ? (this.prisma as any).restockRequest.findMany({
            where: { status: RestockStatus.DELIVERED },
            include: {
              supply: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  unit: true,
                  category: true,
                  unitPrice: true,
                },
              },
              zone: { select: { id: true, code: true, name: true } },
              requestedBy: { select: { id: true, fullName: true } },
            },
            orderBy: [{ deliveredAt: 'desc' }, { createdAt: 'desc' }],
          })
        : Promise.resolve([]),
    ]);

    const mappedSupplyExpenses = (restocks as any[]).map((req) => {
      const effectiveDate = new Date(
        req.deliveredAt ?? req.updatedAt ?? req.createdAt ?? effectiveNow(),
      );
      const period = toClubBillingPeriod(effectiveDate);
      const quantity = Number(req.approvedQuantity ?? req.requestedQuantity ?? 0);
      const unitPrice = Number(req.supply?.unitPrice ?? 0);
      const totalCost = Math.round(quantity * unitPrice);
      return {
        id: req.id,
        requestNumber: req.requestNumber || req.id.slice(0, 8),
        billingPeriod: period,
        deliveredAt: req.deliveredAt ?? req.updatedAt ?? req.createdAt ?? null,
        zoneName: req.zone?.name || req.zone?.code || '—',
        zoneCode: req.zone?.code || null,
        supplyId: req.supplyId,
        supplyCode: req.supply?.code || '—',
        supplyName: req.supply?.name || '—',
        supplyCategory: req.supply?.category || null,
        unit: req.supply?.unit || '',
        quantity,
        unitPrice,
        totalCost,
        requestedByName: req.requestedBy?.fullName || null,
      };
    });

    const periods = Array.from(
      new Set([
        ...invoices.map((inv) => inv.billingPeriod),
        ...mappedSupplyExpenses.map((s) => s.billingPeriod),
      ]),
    )
      .filter(Boolean)
      .sort()
      .reverse();

    const filteredInvoices =
      selectedPeriod === 'ALL'
        ? invoices
        : invoices.filter((inv) => inv.billingPeriod === selectedPeriod);
    const filteredSupplyExpenses =
      selectedPeriod === 'ALL'
        ? mappedSupplyExpenses
        : mappedSupplyExpenses.filter((item) => item.billingPeriod === selectedPeriod);

    let actualRevenuePaid = 0;
    let pendingReceivable = 0;
    let draftBillingTotal = 0;
    let ownerSurplusPayoutExpense = 0;
    let paidInvoiceCount = 0;
    let pendingInvoiceCount = 0;
    let overdueInvoiceCount = 0;
    let draftInvoiceCount = 0;
    let cancelledInvoiceCount = 0;
    let surplusPayoutCount = 0;

    for (const inv of filteredInvoices) {
      const net = Number(inv.netAmount);
      if (inv.status === InvoiceStatus.CANCELLED) {
        cancelledInvoiceCount += 1;
        continue;
      }
      if (net < 0) {
        ownerSurplusPayoutExpense += Math.abs(net);
        surplusPayoutCount += 1;
      }
      if (inv.status === InvoiceStatus.PAID) {
        paidInvoiceCount += 1;
        if (net > 0) actualRevenuePaid += net;
      } else if (inv.status === InvoiceStatus.SENT || inv.status === InvoiceStatus.OVERDUE) {
        pendingInvoiceCount += 1;
        if (inv.status === InvoiceStatus.OVERDUE) overdueInvoiceCount += 1;
        if (net > 0) pendingReceivable += net;
      } else if (inv.status === InvoiceStatus.DRAFT) {
        draftInvoiceCount += 1;
        if (net > 0) draftBillingTotal += net;
      }
    }

    const supplyImportExpense = filteredSupplyExpenses.reduce(
      (sum, item) => sum + item.totalCost,
      0,
    );
    const totalActualExpense = supplyImportExpense + ownerSurplusPayoutExpense;
    const netCashflow = actualRevenuePaid - totalActualExpense;

    return {
      billingPeriod: selectedPeriod,
      periods,
      summary: {
        actualRevenuePaid,
        pendingReceivable,
        draftBillingTotal,
        supplyImportExpense,
        ownerSurplusPayoutExpense,
        totalActualExpense,
        netCashflow,
        deliveredRestockCount: filteredSupplyExpenses.length,
        paidInvoiceCount,
        pendingInvoiceCount,
        overdueInvoiceCount,
        draftInvoiceCount,
        cancelledInvoiceCount,
        surplusPayoutCount,
      },
      revenueItems: filteredInvoices.map((inv) => serializeInvoice(inv)),
      supplyExpenses: filteredSupplyExpenses,
    };
  }

  /**
   * Tạo link / mã QR thanh toán PayOS (kèm fallback VietQR)
   */
  async createPayOSLink(id: string, demoAmount: number | undefined, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (user.role === 'HORSE_OWNER' && existing.ownerId !== user.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn chỉ được thanh toán hóa đơn của mình.',
      );
    }

    return this.payosService!.createPaymentLink({
      invoiceId: existing.id,
      billingPeriod: existing.billingPeriod,
      netAmount: Number(existing.netAmount),
      demoAmount,
    });
  }

  /**
   * Kiểm tra trạng thái thanh toán từ PayOS và tự động chốt PAID nếu đã thanh toán
   */
  async verifyPayOSPayment(id: string, orderCode: number, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (existing.status === InvoiceStatus.PAID) {
      return { paid: true, status: 'PAID', invoice: serializeInvoice(existing) };
    }

    const statusCheck = await this.payosService!.getPaymentStatus(orderCode);
    if (statusCheck.status === 'PAID') {
      const updated = await this.prisma.financialInvoice.update({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: effectiveNow(),
          paidConfirmedById: user.id,
          paidConfirmedByName: user.name,
          paymentMethod: 'PAYOS',
          paymentRef: `PAYOS_${orderCode}`,
        },
      });

      await this.audit.record(
        { id: user.id, name: user.name },
        'INVOICE_PAID',
        `Invoice ${id} (${existing.billingPeriod}) confirmed paid via PayOS order ${orderCode}`,
        id,
        {
          entityName: 'FinancialInvoice',
          oldValues: { status: existing.status },
          newValues: {
            status: InvoiceStatus.PAID,
            paymentMethod: 'PAYOS',
            paymentRef: `PAYOS_${orderCode}`,
          },
        },
      );

      await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);

      // Mail chứng từ PAID
      if (existing.ownerId) {
        try {
          const ctx = this.invoiceCtx(updated, existing.ownerId);
          ctx.owner.fullName = await this.ownerFullName(existing.ownerId);
          ctx.horse.name = existing.horse?.name ?? ctx.horse.name;
          await this.emitMailSafe({
            eventCode: 'INVOICE_PAID',
            recipients: [
              {
                userId: existing.ownerId,
                body: {
                  ...invoicePaid(ctx.inv, ctx.horse, ctx.owner, `PAYOS_${orderCode}`),
                  refId: id,
                },
              },
            ],
          });
        } catch (e) {
          this.logger.warn(`Failed to send paid mail: ${(e as Error).message}`);
        }
      }

      return { paid: true, status: 'PAID', invoice: serializeInvoice(updated) };
    }

    return { paid: false, status: statusCheck.status };
  }

  /**
   * Giả lập thanh toán thành công 1-click (Demo fallback)
   */
  async simulateMockPaid(id: string, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn.');
    }

    if (existing.status === InvoiceStatus.PAID) {
      return serializeInvoice(existing);
    }

    const mockRef = `SIM_PAYOS_${Date.now().toString().slice(-6)}`;
    const updated = await this.prisma.financialInvoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: effectiveNow(),
        paidConfirmedById: user.id,
        paidConfirmedByName: user.name,
        paymentMethod: 'PAYOS_DEMO',
        paymentRef: mockRef,
      },
    });

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_PAID',
      `Invoice ${id} (${existing.billingPeriod}) demo simulated paid by ${user.name}`,
      id,
      {
        entityName: 'FinancialInvoice',
        oldValues: { status: existing.status },
        newValues: { status: InvoiceStatus.PAID, paymentMethod: 'PAYOS_DEMO', paymentRef: mockRef },
      },
    );

    await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);

    if (existing.ownerId) {
      try {
        const ctx = this.invoiceCtx(updated, existing.ownerId);
        ctx.owner.fullName = await this.ownerFullName(existing.ownerId);
        ctx.horse.name = existing.horse?.name ?? ctx.horse.name;
        await this.emitMailSafe({
          eventCode: 'INVOICE_PAID',
          recipients: [
            {
              userId: existing.ownerId,
              body: {
                ...invoicePaid(ctx.inv, ctx.horse, ctx.owner, mockRef),
                refId: id,
              },
            },
          ],
        });
      } catch (e) {
        this.logger.warn(`Failed to send mock paid mail: ${(e as Error).message}`);
      }
    }

    return serializeInvoice(updated);
  }
}
