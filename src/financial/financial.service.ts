import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
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

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

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
        owner: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
      },
    });

    if (!invoice) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', `Invoice ${id} not found`);
    }

    if (user.role === 'HORSE_OWNER' && invoice.ownerId !== user.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You can only view financial statements for your own horses.',
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
   * Tạo hóa đơn tài chính mới (Club Manager)
   */
  async create(dto: CreateInvoiceDto, user: FinancialActor) {
    const { start, end } = boardingMonth(dto.billingPeriod);
    if (end > new Date()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BILLING_PERIOD_NOT_CLOSED',
        'Only completed months can be billed.',
      );
    }
    let resolvedOwnerId = dto.ownerId;
    if (typeof this.prisma?.horse?.findUnique === 'function') {
      const horse = await this.prisma.horse.findUnique({
        where: { id: dto.horseId },
        select: { id: true, ownerId: true, name: true, status: true },
      });
      if (horse) {
        resolvedOwnerId = horse.ownerId || dto.ownerId;
        if (!resolvedOwnerId) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'HORSE_HAS_NO_OWNER',
            `Horse ${horse.name} does not have an assigned owner to bill.`,
          );
        }
        if (dto.ownerId && horse.ownerId && dto.ownerId !== horse.ownerId) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'OWNER_MISMATCH',
            `The specified ownerId ${dto.ownerId} does not match the horse's owner ${horse.ownerId}.`,
          );
        }
      }
    }

    const allocations = await this.prisma.stallAllocation.findMany({
      where: {
        horseId: dto.horseId,
        startDate: { lt: end },
        OR: [{ endDate: null }, { endDate: { gte: start } }],
      },
    });
    const calculated = calculateBoardingFee(dto.billingPeriod, allocations);
    const boardingFee = calculated.boardingFee.toNumber();
    const medicalFee = dto.medicalFee ?? 0;
    const trainingFee = dto.trainingFee ?? 0;
    const prizeCredit = dto.prizeCredit ?? 0;
    const netAmount = boardingFee + medicalFee + trainingFee - prizeCredit;

    const invoice = await this.prisma.financialInvoice.create({
      data: {
        horseId: dto.horseId,
        ownerId: resolvedOwnerId,
        billingPeriod: dto.billingPeriod,
        boardingDays: calculated.boardingDays,
        boardingMonthlyRate: BOARDING_MONTHLY_RATE,
        boardingFee,
        medicalFee,
        trainingFee,
        prizeCredit,
        netAmount,
        status: dto.status ?? InvoiceStatus.DRAFT,
        ...(dto.status === InvoiceStatus.SENT && { dueAt: new Date(Date.now() + 7 * 86400000) }),
        invoiceUrl: dto.invoiceUrl,
      },
      include: {
        horse: { select: { name: true } },
        owner: { select: { fullName: true } },
      },
    });

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_CREATED',
      `Created invoice for horse ${invoice.horse.name} (${invoice.billingPeriod}) - Net: ${netAmount.toLocaleString()} VND`,
      invoice.id,
      { entityName: 'FinancialInvoice', newValues: invoice },
    );

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
   * Cập nhật hóa đơn
   */
  async update(id: string, dto: UpdateInvoiceDto, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({ where: { id } });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', `Invoice ${id} not found`);
    }

    if (existing.status === InvoiceStatus.PAID) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVOICE_ALREADY_PAID',
        'Cannot modify an invoice that has already been marked as PAID.',
      );
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
        'The boarding fee and period are fixed by the stay calculation.',
      );
    }
    const medicalFee = dto.medicalFee !== undefined ? dto.medicalFee : Number(existing.medicalFee);
    const trainingFee =
      dto.trainingFee !== undefined ? dto.trainingFee : Number(existing.trainingFee);
    const prizeCredit =
      dto.prizeCredit !== undefined ? dto.prizeCredit : Number(existing.prizeCredit);
    const netAmount = boardingFee + medicalFee + trainingFee - prizeCredit;

    const updated = await this.prisma.financialInvoice.update({
      where: { id },
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
          !existing.dueAt && { dueAt: new Date(Date.now() + 7 * 86400000) }),
        ...(dto.invoiceUrl !== undefined && { invoiceUrl: dto.invoiceUrl }),
      },
    });

    if (dto.status === InvoiceStatus.OVERDUE) {
      await this.applyDebtImpoundToHorses([existing.horseId]);
      await this.applyBadDebtToOwners([existing.ownerId]);
    } else if (dto.status === InvoiceStatus.PAID) {
      await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);
    }

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_UPDATED',
      `Updated invoice ${id} (${updated.billingPeriod})`,
      id,
      { entityName: 'FinancialInvoice', oldValues: existing, newValues: updated },
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
   * Đổi trạng thái hóa đơn (DRAFT -> SENT -> PAID | OVERDUE | CANCELLED)
   */
  async changeStatus(id: string, status: InvoiceStatus, user: FinancialActor) {
    const existing = await this.prisma.financialInvoice.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', `Invoice ${id} not found`);
    }

    if (
      user.role === 'HORSE_OWNER' &&
      (status !== InvoiceStatus.PAID || existing.ownerId !== user.id)
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Horse owners can only pay for their own invoices',
      );
    }

    if (existing.status === InvoiceStatus.PAID && status !== InvoiceStatus.PAID) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVOICE_ALREADY_PAID',
        'Paid invoices cannot be modified.',
      );
    }

    const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
      [InvoiceStatus.DRAFT]: [InvoiceStatus.SENT, InvoiceStatus.CANCELLED],
      [InvoiceStatus.SENT]: [InvoiceStatus.PAID, InvoiceStatus.OVERDUE, InvoiceStatus.CANCELLED],
      [InvoiceStatus.OVERDUE]: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
      [InvoiceStatus.PAID]: [],
      [InvoiceStatus.CANCELLED]: [],
    };

    if (existing.status !== status) {
      const allowedNext = ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowedNext.includes(status)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_INVOICE_STATUS_TRANSITION',
          `Cannot transition invoice from ${existing.status} to ${status}. Allowed next states: ${allowedNext.join(', ') || 'none'}.`,
        );
      }
    }
    const updated = await this.prisma.financialInvoice.update({
      where: { id },
      data: {
        status,
        ...(status === InvoiceStatus.SENT &&
          existing.status === InvoiceStatus.DRAFT &&
          !existing.dueAt && {
            dueAt: new Date(Date.now() + 7 * 86400000),
          }),
      },
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
    } else if (status === InvoiceStatus.PAID) {
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
      throw apiError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', `Invoice ${id} not found`);
    }

    if (user.role === 'HORSE_OWNER' && existing.ownerId !== user.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You can only pay for your own horse invoice',
      );
    }

    if (existing.status !== InvoiceStatus.SENT && existing.status !== InvoiceStatus.OVERDUE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS',
        'Only sent or overdue invoices can be paid',
      );
    }
    if (Number(existing.netAmount) <= 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_AMOUNT',
        'Invoice has no positive balance to pay',
      );
    }

    const updated = await this.prisma.financialInvoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID },
    });

    await this.audit.record(
      { id: user.id, name: user.name },
      'INVOICE_PAID',
      `Invoice ${id} (${existing.billingPeriod}) for horse ${existing.horse.name} was paid via ${paymentData?.paymentMethod || 'VietQR'}`,
      id,
      {
        entityName: 'FinancialInvoice',
        oldValues: { status: existing.status },
        newValues: { status: InvoiceStatus.PAID, ...paymentData },
      },
    );

    await this.checkAndReleaseDebtSanctions(existing.horseId, existing.ownerId, user);

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
   * Tổng hợp báo cáo tài chính của Chủ ngựa (SC-5.06)
   */
  async getOwnerSummary(ownerId?: string) {
    await this.sweepOverdue();
    const where = ownerId ? { ownerId } : {};
    const invoices = await this.prisma.financialInvoice.findMany({
      where,
      include: {
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
      where: { status: InvoiceStatus.SENT, dueAt: { lt: new Date() }, netAmount: { gt: 0 } },
      select: { id: true, horseId: true, ownerId: true },
    });

    const { count } = await this.prisma.financialInvoice.updateMany({
      where: { status: InvoiceStatus.SENT, dueAt: { lt: new Date() }, netAmount: { gt: 0 } },
      data: { status: InvoiceStatus.OVERDUE },
    });

    if (overdueCandidates && overdueCandidates.length > 0) {
      const horseIds = Array.from(new Set(overdueCandidates.map((i) => i.horseId)));
      const ownerIds = Array.from(new Set(overdueCandidates.map((i) => i.ownerId)));
      await this.applyDebtImpoundToHorses(horseIds);
      await this.applyBadDebtToOwners(ownerIds);
    }

    return count;
  }

  async applyDebtImpoundToHorses(horseIds: string[]) {
    if (horseIds.length === 0 || !this.prisma.horse?.updateMany) return;
    await this.prisma.horse.updateMany({
      where: { id: { in: horseIds } },
      data: {
        isDebtImpounded: true,
        debtImpoundedAt: new Date(),
        debtImpoundReason: 'Quá hạn thanh toán chi phí nuôi dưỡng / lưu chuồng.',
      },
    });
  }

  async applyBadDebtToOwners(ownerIds: string[]) {
    if (ownerIds.length === 0 || !this.prisma.user?.updateMany) return;
    await this.prisma.user.updateMany({
      where: { id: { in: ownerIds } },
      data: {
        isBadDebtFlagged: true,
        badDebtFlaggedAt: new Date(),
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
    if (end > new Date()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BILLING_PERIOD_NOT_CLOSED',
        'Only completed months can be billed.',
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
                stallAllocations: {
                  some: {
                    startDate: { lt: end },
                    OR: [{ endDate: null }, { endDate: { gte: start } }],
                  },
                },
              },
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
              const { boardingDays, boardingFee } = calculateBoardingFee(
                billingPeriod,
                horse.stallAllocations,
              );
              if (boardingDays === 0) continue;
              const trainingFee = 4000000;
              await tx.financialInvoice.create({
                data: {
                  horseId: horse.id,
                  ownerId: horse.ownerId,
                  billingPeriod,
                  boardingDays,
                  boardingMonthlyRate: BOARDING_MONTHLY_RATE,
                  boardingFee: boardingFee.toNumber(),
                  medicalFee: 0,
                  trainingFee,
                  prizeCredit: 0,
                  netAmount: boardingFee.plus(trainingFee),
                  status: InvoiceStatus.DRAFT,
                },
              });
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
}
