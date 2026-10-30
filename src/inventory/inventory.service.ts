import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationCategory, Prisma, RestockStatus, Role, SupplyCategory } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { apiError } from '../common/exceptions/api-error';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/role.enum';
import type { SupplyDeliveryGateway } from './supply-delivery.gateway';
import {
  AdjustStockDto,
  CreateRestockRequestDto,
  DeliverRestockRequestDto,
  QueryInventoryDto,
  QueryRestockRequestsDto,
  ReviewRestockRequestDto,
} from './dto/inventory.dto';

/**
 * R-4: Resolve the HMAC signing secret from the required environment variable JWT_SECRET.
 * Throws at startup if the secret is not configured — no hardcoded fallback is acceptable.
 */
function resolveCapabilitySecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required for supply capability signing but is not set.',
    );
  }
  return secret;
}

export type StockHealthStatus = 'SUFFICIENT' | 'LOW_STOCK' | 'OUT_OF_STOCK';

interface AckCapabilityPayload {
  purpose: 'SUPPLY_DELIVERY_ACK';
  requestId: string;
  dispatchedAt: number;
  expiresAt: number;
}

@Injectable()
export class InventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryService.name);
  private gateway: SupplyDeliveryGateway | null = null;
  private readonly deliveryTimers = new Map<string, NodeJS.Timeout>();
  /** R-2: Bounded periodic recovery sweep — runs every 60s throughout process lifetime without 24h cutoff */
  private recoverySweepTimer: NodeJS.Timeout | null = null;
  private readonly RECOVERY_SWEEP_INTERVAL_MS = 60_000;
  private isSweepRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  setGateway(gateway: SupplyDeliveryGateway) {
    this.gateway = gateway;
  }

  async onModuleInit() {
    await this.recoverPendingDeliveries();
    this.scheduleRecoverySweep();
  }

  onModuleDestroy() {
    if (this.recoverySweepTimer) {
      clearTimeout(this.recoverySweepTimer);
      this.recoverySweepTimer = null;
    }
    for (const timer of this.deliveryTimers.values()) {
      clearTimeout(timer);
    }
    this.deliveryTimers.clear();
  }

  /**
   * R-2: Periodic recovery sweep throughout process lifetime.
   * Runs after initial startup recovery and repeats every 60s to catch any in-memory
   * watchdog timers that failed silently. Prevents overlapping sweeps via isSweepRunning flag.
   */
  private scheduleRecoverySweep() {
    this.recoverySweepTimer = setTimeout(async () => {
      if (this.isSweepRunning) {
        this.logger.warn('Previous recovery sweep is still running, skipping overlapping sweep.');
      } else {
        this.isSweepRunning = true;
        try {
          await this.recoverPendingDeliveries();
        } catch (err: any) {
          this.logger.error(`Recovery sweep error: ${err?.message}`);
        } finally {
          this.isSweepRunning = false;
        }
      }
      this.scheduleRecoverySweep();
    }, this.RECOVERY_SWEEP_INTERVAL_MS);
  }

  generateAckCapability(requestId: string, dispatchedAt: Date): string {
    const secret = resolveCapabilitySecret();
    const dispatchedTime = dispatchedAt.getTime();
    const expiresAt = dispatchedTime + 20000;
    const payload: AckCapabilityPayload = {
      purpose: 'SUPPLY_DELIVERY_ACK',
      requestId,
      dispatchedAt: dispatchedTime,
      expiresAt,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${hmac}`;
  }

  verifyAckCapability(
    requestId: string,
    capability: string,
    now: Date = new Date(),
  ): { valid: boolean; reason?: string } {
    try {
      // R-4: Validate ACK field types before processing
      if (typeof requestId !== 'string' || !requestId.trim()) {
        return { valid: false, reason: 'INVALID_REQUEST_ID' };
      }
      if (typeof capability !== 'string' || !capability.trim()) {
        return { valid: false, reason: 'MALFORMED_CAPABILITY' };
      }
      const parts = capability.split('.');
      if (parts.length !== 2) {
        return { valid: false, reason: 'MALFORMED_CAPABILITY' };
      }
      const [payloadB64, hmac] = parts;
      if (!payloadB64 || !hmac) {
        return { valid: false, reason: 'MALFORMED_CAPABILITY' };
      }
      const secret = resolveCapabilitySecret();
      const expectedHmac = crypto
        .createHmac('sha256', secret)
        .update(payloadB64)
        .digest('base64url');
      if (
        Buffer.byteLength(hmac) !== Buffer.byteLength(expectedHmac) ||
        !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))
      ) {
        return { valid: false, reason: 'INVALID_SIGNATURE' };
      }
      const payload: AckCapabilityPayload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
      // R-4: Validate persisted request/dispatch binding in payload fields
      if (
        payload.purpose !== 'SUPPLY_DELIVERY_ACK' ||
        typeof payload.requestId !== 'string' ||
        typeof payload.dispatchedAt !== 'number' ||
        typeof payload.expiresAt !== 'number'
      ) {
        return { valid: false, reason: 'INVALID_PURPOSE' };
      }
      if (payload.requestId !== requestId) {
        return { valid: false, reason: 'REQUEST_ID_MISMATCH' };
      }
      const nowMs = now.getTime();
      if (nowMs < payload.dispatchedAt + 8000) {
        return { valid: false, reason: 'EARLY_ACK_REJECTED' };
      }
      if (nowMs > payload.expiresAt) {
        return { valid: false, reason: 'CAPABILITY_EXPIRED' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'VERIFICATION_ERROR' };
    }
  }

  async recoverPendingDeliveries(): Promise<void> {
    const now = new Date();
    try {
      const pendingDeliveries = await this.prisma.restockRequest.findMany({
        where: { status: RestockStatus.DELIVERING },
        include: { supply: true, zone: true },
      });
      for (const req of pendingDeliveries) {
        const reviewedTime = req.reviewedAt ? req.reviewedAt.getTime() : req.createdAt.getTime();
        const elapsed = now.getTime() - reviewedTime;
        if (elapsed >= 20000) {
          this.logger.log(
            `Startup recovery: request ${req.id} overdue (${elapsed}ms >= 20000ms), completing via FALLBACK`,
          );
          await this.completeDelivery(req.id, 'FALLBACK');
        } else {
          const remaining = 20000 - elapsed;
          this.logger.log(
            `Startup recovery: request ${req.id} has ${remaining}ms remaining, rescheduling timer`,
          );
          const timer = setTimeout(() => {
            this.completeDelivery(req.id, 'FALLBACK').catch((err) => {
              this.logger.error(`Watchdog recovery error for ${req.id}: ${err.message}`);
            });
          }, remaining);
          this.deliveryTimers.set(req.id, timer);
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to recover pending deliveries: ${err?.message}`);
    }
  }

  async handleSimulatorAck(
    requestId: string,
    ackCapability: string,
  ): Promise<{
    success: boolean;
    requestId?: string;
    error?: string;
    completed?: boolean;
    alreadyCompleted?: boolean;
    status?: string;
    resultingBalance?: number;
  }> {
    const verification = this.verifyAckCapability(requestId, ackCapability);
    if (!verification.valid) {
      this.logger.warn(`Rejected simulator ACK for request ${requestId}: ${verification.reason}`);
      return { success: false, error: verification.reason };
    }
    const result = await this.completeDelivery(requestId, 'ACK');
    return { success: true, requestId, ...result };
  }

  async completeDelivery(
    requestId: string,
    source: 'ACK' | 'FALLBACK',
  ): Promise<{
    completed: boolean;
    alreadyCompleted?: boolean;
    status?: string;
    resultingBalance?: number;
  }> {
    const request = await this.prisma.restockRequest.findUnique({
      where: { id: requestId },
      include: { supply: true, zone: true, reviewedBy: true },
    });

    if (!request) {
      return { completed: false, status: 'NOT_FOUND' };
    }

    if (request.status !== RestockStatus.DELIVERING) {
      return { completed: false, alreadyCompleted: true, status: request.status };
    }

    const now = new Date();
    const amountToAdd = Number(request.approvedQuantity || request.requestedQuantity);

    const txResult = await this.prisma.$transaction(async (tx) => {
      // R-1: Shared zone-row lock serializes with approvals, stock adjustments, and deliveries
      await tx.$queryRaw`SELECT id FROM "StallZone" WHERE id = ${request.zoneId} FOR UPDATE`;

      const updateResult = await tx.restockRequest.updateMany({
        where: { id: requestId, status: RestockStatus.DELIVERING },
        data: {
          status: RestockStatus.DELIVERED,
          deliveredAt: now,
        },
      });

      if (updateResult.count === 0) {
        return { completed: false };
      }

      const updatedBalance = await tx.stockBalance.upsert({
        where: {
          zoneId_supplyId: {
            zoneId: request.zoneId,
            supplyId: request.supplyId,
          },
        },
        create: {
          zoneId: request.zoneId,
          supplyId: request.supplyId,
          quantity: new Prisma.Decimal(amountToAdd),
          minThreshold: new Prisma.Decimal(10),
          lastInventoryDate: now,
          lastAdjustedById: request.reviewedById,
          notes: `Nhập kho từ phiếu đề xuất ${request.requestNumber} (${source})`,
        },
        update: {
          quantity: { increment: new Prisma.Decimal(amountToAdd) },
          lastInventoryDate: now,
          lastAdjustedById: request.reviewedById,
          notes: `Nhập kho từ phiếu đề xuất ${request.requestNumber} (${source})`,
        },
      });

      return {
        completed: true,
        resultingBalance: Number(updatedBalance.quantity),
      };
    });

    if (!txResult.completed) {
      return { completed: false, alreadyCompleted: true };
    }

    // R-2: Clear watchdog timer only AFTER the transaction has committed successfully
    const activeTimer = this.deliveryTimers.get(requestId);
    if (activeTimer) {
      clearTimeout(activeTimer);
      this.deliveryTimers.delete(requestId);
    }

    // R-2: Broadcast first — post-commit notification/audit failures must not prevent completion broadcast
    this.gateway?.broadcastDeliveryCompleted({
      requestId: request.id,
      zoneId: request.zoneId,
      supplyId: request.supplyId,
      status: 'DELIVERED',
      balance: txResult.resultingBalance!,
    });

    // Record audit log — isolated; failure logged but does not affect delivery result
    try {
      await this.auditService.record(
        request.reviewedBy
          ? { id: request.reviewedBy.id, name: request.reviewedBy.fullName }
          : { id: 'system', name: 'Hệ thống' },
        'RESTOCK_DELIVERED',
        `Phiếu đề xuất ${request.requestNumber} (${request.supply.name} - ${request.zone.name}) đã giao hàng thành công (${source}). Tồn kho mới: ${txResult.resultingBalance} ${request.supply.unit}.`,
        request.id,
        {
          entityName: 'RestockRequest',
          newValues: {
            status: RestockStatus.DELIVERED,
            source,
            resultingBalance: txResult.resultingBalance,
          },
        },
      );
    } catch (auditErr: any) {
      this.logger.error(
        `Post-commit audit failure for ${requestId} (${source}): ${auditErr?.message} — delivery already committed.`,
      );
    }

    // Notify Groom requester — isolated; failure logged but does not prevent broadcast
    try {
      await this.notificationsService.notifyUsers([request.requestedById], {
        type: 'RESTOCK_DELIVERED',
        category: NotificationCategory.SYSTEM,
        title: 'Vật tư đã được giao thành công',
        message: `Vật tư ${request.supply.name} (${amountToAdd} ${request.supply.unit}) đã được giao đến ${request.zone.name} thành công (${source}).`,
        link: '/supplies/requests',
        senderName: request.reviewedBy?.fullName || 'Hệ thống',
        params: { requestNumber: request.requestNumber || '' },
      });
    } catch (notifErr: any) {
      this.logger.warn(
        `Post-commit notification failure for ${requestId} (${source}): ${notifErr?.message} — delivery already committed.`,
      );
    }

    return {
      completed: true,
      resultingBalance: txResult.resultingBalance,
      status: RestockStatus.DELIVERED,
    };
  }

  async getActiveDeliveriesWithCapabilities() {
    const activeRequests = await this.prisma.restockRequest.findMany({
      where: { status: RestockStatus.DELIVERING },
      include: { supply: true, zone: true },
    });
    return activeRequests.map((req) => {
      const dispatched = req.reviewedAt || req.createdAt;
      return {
        requestId: req.id,
        requestNumber: req.requestNumber || '',
        zoneId: req.zoneId,
        supplyId: req.supplyId,
        supplyCode: req.supply.code,
        supplyName: req.supply.name,
        category: req.supply.category,
        unit: req.supply.unit,
        approvedQuantity: Number(req.approvedQuantity || req.requestedQuantity),
        dispatchedAt: dispatched.toISOString(),
        animationEndsAt: new Date(dispatched.getTime() + 8000).toISOString(),
        fallbackAt: new Date(dispatched.getTime() + 20000).toISOString(),
        ackCapability: this.generateAckCapability(req.id, dispatched),
      };
    });
  }

  async getSimulatorContext() {
    const [supplies, stockBalances, activeRequests] = await Promise.all([
      this.prisma.supplyCatalog.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          unit: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.stockBalance.findMany({
        include: {
          zone: { select: { id: true, code: true, name: true } },
          supply: { select: { id: true, code: true, name: true, unit: true, category: true } },
        },
      }),
      this.prisma.restockRequest.findMany({
        where: { status: RestockStatus.DELIVERING },
        include: {
          supply: { select: { id: true, code: true, name: true, unit: true, category: true } },
          zone: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    return {
      catalogue: supplies,
      stocks: stockBalances.map((sb) => ({
        id: sb.id,
        zoneId: sb.zoneId,
        zoneName: sb.zone.name,
        zoneCode: sb.zone.code,
        supplyId: sb.supplyId,
        supplyName: sb.supply.name,
        supplyCode: sb.supply.code,
        unit: sb.supply.unit,
        category: sb.supply.category,
        quantity: Number(sb.quantity),
        minThreshold: Number(sb.minThreshold),
        capacity: sb.capacity !== null ? Number(sb.capacity) : null,
        lastInventoryDate: sb.lastInventoryDate,
      })),
      activeDeliveries: activeRequests.map((req) => {
        const dispatched = req.reviewedAt || req.createdAt;
        return {
          requestId: req.id,
          requestNumber: req.requestNumber || '',
          zoneId: req.zoneId,
          supplyId: req.supplyId,
          supplyCode: req.supply.code,
          supplyName: req.supply.name,
          category: req.supply.category,
          unit: req.supply.unit,
          approvedQuantity: Number(req.approvedQuantity || req.requestedQuantity),
          dispatchedAt: dispatched.toISOString(),
          animationEndsAt: new Date(dispatched.getTime() + 8000).toISOString(),
          fallbackAt: new Date(dispatched.getTime() + 20000).toISOString(),
        };
      }),
    };
  }

  /**
   * TASK F4-06-BE: Lấy danh sách tồn kho vật tư theo Khu chuồng
   */
  async findAllStock(query: QueryInventoryDto, currentUser?: CurrentUserPayload) {
    const whereZone: Prisma.StallZoneWhereInput = { isActive: true };
    if (query.zoneId) whereZone.id = query.zoneId;

    const whereSupply: Prisma.SupplyCatalogWhereInput = { isActive: true };
    if (query.category) {
      const cat = query.category.toUpperCase().trim();
      if (cat === 'FEED') {
        whereSupply.category = { in: [SupplyCategory.FEED_HAY, SupplyCategory.FEED_GRAIN] };
      } else if (cat === 'MEDICINE') {
        whereSupply.category = {
          in: [
            SupplyCategory.MEDICINE,
            SupplyCategory.VACCINE,
            SupplyCategory.DEWORMER,
            SupplyCategory.SUPPLEMENT_VITAMIN,
            SupplyCategory.SUPPLEMENT_MINERAL,
            SupplyCategory.SUPPLEMENT_ELECTROLYTE,
            SupplyCategory.SUPPLEMENT_GENERAL,
          ],
        };
      } else if (cat === 'CARE') {
        whereSupply.category = {
          in: [
            SupplyCategory.SUPPLEMENT_VITAMIN,
            SupplyCategory.SUPPLEMENT_MINERAL,
            SupplyCategory.SUPPLEMENT_ELECTROLYTE,
            SupplyCategory.SUPPLEMENT_GENERAL,
          ],
        };
      } else if (cat === 'EQUIPMENT') {
        whereSupply.category = {
          in: [SupplyCategory.TOOL_EQUIPMENT, SupplyCategory.CLEANING_SUPPLY],
        };
      } else if (Object.values(SupplyCategory).includes(cat as SupplyCategory)) {
        whereSupply.category = cat as SupplyCategory;
      }
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      whereSupply.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [zones, supplies, stockBalances] = await Promise.all([
      this.prisma.stallZone.findMany({ where: whereZone, orderBy: { sortOrder: 'asc' } }),
      this.prisma.supplyCatalog.findMany({ where: whereSupply, orderBy: { category: 'asc' } }),
      this.prisma.stockBalance.findMany({
        where: {
          ...(query.zoneId ? { zoneId: query.zoneId } : {}),
        },
        include: {
          lastAdjustedBy: { select: { id: true, fullName: true, role: true } },
        },
      }),
    ]);

    const balanceMap = new Map<string, (typeof stockBalances)[0]>();
    for (const b of stockBalances) {
      balanceMap.set(`${b.zoneId}:${b.supplyId}`, b);
    }

    const result: Array<{
      id?: string;
      zoneId: string;
      zoneCode: string;
      zoneName: string;
      zone: { id: string; code: string; name: string };
      supplyId: string;
      supplyCode: string;
      supplyName: string;
      category: string;
      unit: string;
      supply: {
        id: string;
        code: string;
        name: string;
        category: string;
        unit: string;
        unitPrice: number | null;
      };
      quantity: number;
      minThreshold: number;
      capacity?: number | null;
      status: StockHealthStatus;
      healthStatus: StockHealthStatus;
      lastInventoryDate?: string | null;
      lastAdjustedBy?: { id: string; fullName: string; role: string } | null;
      notes?: string | null;
    }> = [];

    const isClubManager = currentUser?.role === UserRole.CLUB_MANAGER;

    for (const zone of zones) {
      for (const supply of supplies) {
        const key = `${zone.id}:${supply.id}`;
        const existing = balanceMap.get(key);

        const qty = existing ? Number(existing.quantity) : 0;
        const threshold = existing ? Number(existing.minThreshold) : 10;

        let healthStatus: StockHealthStatus = 'SUFFICIENT';
        if (qty <= 0) {
          healthStatus = 'OUT_OF_STOCK';
        } else if (qty < threshold) {
          healthStatus = 'LOW_STOCK';
        }

        if (query.lowStockOnly && healthStatus === 'SUFFICIENT') {
          continue;
        }

        result.push({
          id: existing?.id || `${zone.id}_${supply.id}`,
          zoneId: zone.id,
          zoneCode: zone.code,
          zoneName: zone.name,
          zone: { id: zone.id, code: zone.code, name: zone.name },
          supplyId: supply.id,
          supplyCode: supply.code,
          supplyName: supply.name,
          category: supply.category,
          unit: supply.unit,
          supply: {
            id: supply.id,
            code: supply.code,
            name: supply.name,
            category: supply.category,
            unit: supply.unit,
            unitPrice: isClubManager ? Number(supply.unitPrice) : null,
          },
          quantity: qty,
          minThreshold: threshold,
          capacity:
            existing?.capacity !== null && existing?.capacity !== undefined
              ? Number(existing.capacity)
              : null,
          status: healthStatus,
          healthStatus,
          lastInventoryDate: existing?.lastInventoryDate
            ? existing.lastInventoryDate.toISOString()
            : null,
          lastAdjustedBy: existing?.lastAdjustedBy,
          notes: existing?.notes,
        });
      }
    }

    const lowStockCount = result.filter((i) => i.healthStatus === 'LOW_STOCK').length;
    const outOfStockCount = result.filter((i) => i.healthStatus === 'OUT_OF_STOCK').length;

    return {
      items: result,
      total: result.length,
      lowStockCount,
      outOfStockCount,
      summary: {
        totalItems: result.length,
        sufficientCount: result.filter((i) => i.healthStatus === 'SUFFICIENT').length,
        lowStockCount,
        outOfStockCount,
      },
    };
  }

  /**
   * TASK F4-06-BE: Kiểm kê & Điều chỉnh số lượng tồn kho (Chỉ Club Manager)
   */
  async adjustStock(dto: AdjustStockDto, currentUser: CurrentUserPayload) {
    if (currentUser.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Quản lý CLB được quyền kiểm kê điều chỉnh tồn kho.',
      );
    }

    const [zone, supply] = await Promise.all([
      this.prisma.stallZone.findUnique({ where: { id: dto.zoneId } }),
      this.prisma.supplyCatalog.findUnique({ where: { id: dto.supplyId } }),
    ]);

    if (!zone) throw apiError(HttpStatus.NOT_FOUND, 'ZONE_NOT_FOUND', 'Khu chuồng không tồn tại.');
    if (!supply) throw apiError(HttpStatus.NOT_FOUND, 'SUPPLY_NOT_FOUND', 'Vật tư không tồn tại.');

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // R-1: Zone-row lock to serialize concurrent stock adjustments, approvals, and deliveries
      await tx.$queryRaw`SELECT id FROM "StallZone" WHERE id = ${dto.zoneId} FOR UPDATE`;

      const existingBalance = await tx.stockBalance.findUnique({
        where: {
          zoneId_supplyId: {
            zoneId: dto.zoneId,
            supplyId: dto.supplyId,
          },
        },
      });

      if (existingBalance?.capacity !== null && existingBalance?.capacity !== undefined) {
        const reservations = await tx.restockRequest.aggregate({
          where: {
            zoneId: dto.zoneId,
            supplyId: dto.supplyId,
            status: RestockStatus.DELIVERING,
          },
          _sum: { approvedQuantity: true },
        });
        const reservedQty = Number(reservations._sum.approvedQuantity || 0);
        const maxCap = Number(existingBalance.capacity);
        if (Number(dto.actualQuantity) + reservedQty > maxCap) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'CAPACITY_EXCEEDED',
            `Số lượng điều chỉnh (${dto.actualQuantity}) cộng lượng đang giao (${reservedQty}) vượt quá sức chứa (${maxCap} ${supply.unit}).`,
          );
        }
      }

      return tx.stockBalance.upsert({
        where: {
          zoneId_supplyId: {
            zoneId: dto.zoneId,
            supplyId: dto.supplyId,
          },
        },
        create: {
          zoneId: dto.zoneId,
          supplyId: dto.supplyId,
          quantity: new Prisma.Decimal(dto.actualQuantity),
          minThreshold:
            dto.minThreshold !== undefined
              ? new Prisma.Decimal(dto.minThreshold)
              : new Prisma.Decimal(10),
          lastInventoryDate: now,
          lastAdjustedById: currentUser.userId,
          notes: dto.notes || dto.reason,
        },
        update: {
          quantity: new Prisma.Decimal(dto.actualQuantity),
          ...(dto.minThreshold !== undefined
            ? { minThreshold: new Prisma.Decimal(dto.minThreshold) }
            : {}),
          lastInventoryDate: now,
          lastAdjustedById: currentUser.userId,
          notes: dto.notes || dto.reason,
        },
        include: {
          zone: { select: { id: true, code: true, name: true } },
          supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
          lastAdjustedBy: { select: { id: true, fullName: true, role: true } },
        },
      });
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      'STOCK_ADJUSTED',
      `Kiểm kê điều chỉnh tồn kho vật tư ${supply.name} tại ${zone.name}: ${dto.actualQuantity} ${supply.unit}. Lý do: ${dto.reason || 'Kiểm kê định kỳ'}`,
      updated.id,
      {
        entityName: 'StockBalance',
        newValues: {
          zoneId: dto.zoneId,
          supplyId: dto.supplyId,
          quantity: dto.actualQuantity,
        },
      },
    );

    return {
      ...updated,
      quantity: Number(updated.quantity),
      minThreshold: Number(updated.minThreshold),
    };
  }

  /**
   * Helper: Trừ kho tự động khi hoàn thành bữa ăn (FEEDING task)
   */
  async deductStockForFeeding(
    zoneId: string,
    items: Array<{ supplyId?: string; amount?: number }>,
  ) {
    if (!zoneId || !items || !Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      if (!item.supplyId || !item.amount || Number(item.amount) <= 0) continue;
      const amount = Number(item.amount);

      try {
        await this.prisma.stockBalance.upsert({
          where: {
            zoneId_supplyId: {
              zoneId,
              supplyId: item.supplyId,
            },
          },
          create: {
            zoneId,
            supplyId: item.supplyId,
            quantity: new Prisma.Decimal(-amount),
            minThreshold: new Prisma.Decimal(10),
          },
          update: {
            quantity: { decrement: new Prisma.Decimal(amount) },
          },
        });
      } catch (err) {
        console.error(`Failed to deduct stock for zone ${zoneId}, supply ${item.supplyId}:`, err);
      }
    }
  }

  /**
   * Helper: Hoàn lại số lượng tồn kho khi hoàn tác bữa ăn
   */
  async restoreStockForFeeding(
    zoneId: string,
    items: Array<{ supplyId?: string; amount?: number }>,
  ) {
    if (!zoneId || !items || !Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      if (!item.supplyId || !item.amount || Number(item.amount) <= 0) continue;
      const amount = Number(item.amount);

      try {
        await this.prisma.stockBalance.update({
          where: {
            zoneId_supplyId: {
              zoneId,
              supplyId: item.supplyId,
            },
          },
          data: {
            quantity: { increment: new Prisma.Decimal(amount) },
          },
        });
      } catch (err) {
        console.error(`Failed to restore stock for zone ${zoneId}, supply ${item.supplyId}:`, err);
      }
    }
  }

  /**
   * TASK F4-07-BE: Tạo phiếu đề xuất bổ sung vật tư (RestockRequest)
   */
  async createRestockRequest(dto: CreateRestockRequestDto, currentUser: CurrentUserPayload) {
    if (!dto.requestedQuantity || Number(dto.requestedQuantity) <= 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Số lượng yêu cầu phải lớn hơn 0.',
      );
    }

    const [zone, supply] = await Promise.all([
      this.prisma.stallZone.findUnique({ where: { id: dto.zoneId } }),
      this.prisma.supplyCatalog.findUnique({ where: { id: dto.supplyId } }),
    ]);

    if (!zone) throw apiError(HttpStatus.NOT_FOUND, 'ZONE_NOT_FOUND', 'Khu chuồng không tồn tại.');
    if (!supply) throw apiError(HttpStatus.NOT_FOUND, 'SUPPLY_NOT_FOUND', 'Vật tư không tồn tại.');

    const MAX_ZONE_SUPPLY_CAPACITY = 10000;
    const currentBalance = await this.prisma.stockBalance.findUnique({
      where: {
        zoneId_supplyId: {
          zoneId: dto.zoneId,
          supplyId: dto.supplyId,
        },
      },
    });
    const currentQty = currentBalance ? Number(currentBalance.quantity) : 0;
    if (currentQty + Number(dto.requestedQuantity) > MAX_ZONE_SUPPLY_CAPACITY) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CAPACITY_EXCEEDED',
        `Số lượng yêu cầu vượt quá sức chứa tối đa của khu chuồng (${MAX_ZONE_SUPPLY_CAPACITY} ${supply.unit}). Hiện tại đã có: ${currentQty} ${supply.unit}.`,
      );
    }

    const now = new Date();
    const count = await this.prisma.restockRequest.count();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const requestNumber = `REQ-${yy}${mm}-${(count + 1).toString().padStart(4, '0')}`;

    const created = await this.prisma.restockRequest.create({
      data: {
        requestNumber,
        zoneId: dto.zoneId,
        supplyId: dto.supplyId,
        requestedQuantity: new Prisma.Decimal(dto.requestedQuantity),
        urgencyReason: dto.urgencyReason,
        requestedById: currentUser.userId,
        status: RestockStatus.PENDING,
      },
      include: {
        zone: { select: { id: true, code: true, name: true } },
        supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    // Thông báo cho Club Manager
    await this.notificationsService.notifyRoles(
      [Role.CLUB_MANAGER],
      {
        type: 'RESTOCK_REQUEST_CREATED',
        category: NotificationCategory.SYSTEM,
        title: 'Phiếu đề xuất vật tư mới',
        message: `Nhân viên ${currentUser.fullName} đã đề xuất bổ sung ${dto.requestedQuantity} ${supply.unit} ${supply.name} cho ${zone.name}.`,
        link: '/supplies/requests',
        senderName: currentUser.fullName,
        params: { requestNumber, zoneName: zone.name, supplyName: supply.name },
        dedupeKey: `restock_${created.id}`,
      },
      currentUser.userId,
    );

    return {
      ...created,
      requestedQuantity: Number(created.requestedQuantity),
    };
  }

  /**
   * TASK F4-07-BE: Lấy danh sách phiếu đề xuất vật tư
   */
  async findAllRestockRequests(query: QueryRestockRequestsDto, currentUser?: CurrentUserPayload) {
    const where: Prisma.RestockRequestWhereInput = {};
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.status) where.status = query.status;

    // Nếu là Groom: chỉ xem phiếu của mình hoặc khu chuồng mình
    if (currentUser?.role === UserRole.GROOM) {
      where.requestedById = currentUser.userId;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { requestNumber: { contains: term, mode: 'insensitive' } },
        { supply: { name: { contains: term, mode: 'insensitive' } } },
        { supply: { code: { contains: term, mode: 'insensitive' } } },
        { urgencyReason: { contains: term, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.restockRequest.findMany({
        where,
        include: {
          zone: { select: { id: true, code: true, name: true } },
          supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
          requestedBy: { select: { id: true, fullName: true, role: true } },
          reviewedBy: { select: { id: true, fullName: true, role: true } },
          deliveredBy: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.restockRequest.count({ where }),
    ]);

    return {
      items: items.map((it) => ({
        ...it,
        requestedQuantity: Number(it.requestedQuantity),
        approvedQuantity: it.approvedQuantity ? Number(it.approvedQuantity) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOneRestockRequest(id: string) {
    const it = await this.prisma.restockRequest.findUnique({
      where: { id },
      include: {
        zone: { select: { id: true, code: true, name: true } },
        supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        reviewedBy: { select: { id: true, fullName: true, role: true } },
        deliveredBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    if (!it) {
      throw apiError(HttpStatus.NOT_FOUND, 'REQUEST_NOT_FOUND', 'Phiếu đề xuất không tồn tại.');
    }

    return {
      ...it,
      requestedQuantity: Number(it.requestedQuantity),
      approvedQuantity: it.approvedQuantity ? Number(it.approvedQuantity) : null,
    };
  }

  /**
   * TASK F4-07-BE: Phê duyệt hoặc từ chối phiếu đề xuất (Chỉ Club Manager)
   */
  async reviewRestockRequest(
    id: string,
    dto: ReviewRestockRequestDto,
    currentUser: CurrentUserPayload,
  ) {
    if (currentUser.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Quản lý CLB được quyền phê duyệt đề xuất vật tư.',
      );
    }

    const request = await this.prisma.restockRequest.findUnique({
      where: { id },
      include: { supply: true, zone: true },
    });

    if (!request) {
      throw apiError(HttpStatus.NOT_FOUND, 'REQUEST_NOT_FOUND', 'Phiếu đề xuất không tồn tại.');
    }

    if (request.status !== RestockStatus.PENDING) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS',
        'Chỉ phê duyệt được các phiếu đang chờ duyệt (PENDING).',
      );
    }

    let approvedQty = 0;
    if (dto.action === 'APPROVE') {
      approvedQty =
        dto.approvedQuantity !== undefined
          ? Number(dto.approvedQuantity)
          : Number(request.requestedQuantity);
      if (approvedQty <= 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_QUANTITY',
          'Số lượng phê duyệt phải lớn hơn 0.',
        );
      }
    }

    const now = new Date();
    const isApproved = dto.action === 'APPROVE';

    // R-1: Capacity validation moved inside transaction with SELECT FOR UPDATE advisory lock
    // to prevent two concurrent approvals from each reading stale reservations and both
    // over-reserving against the same capacity limit.
    const updateResult = await this.prisma.$transaction(async (tx) => {
      // R-1: Shared zone-row lock serializes concurrent approvals, adjustments, and completions
      await tx.$queryRaw`SELECT id FROM "StallZone" WHERE id = ${request.zoneId} FOR UPDATE`;

      if (isApproved) {
        // Read balance inside transaction (handles absent StockBalance row cleanly)
        const balance = await tx.stockBalance.findUnique({
          where: {
            zoneId_supplyId: {
              zoneId: request.zoneId,
              supplyId: request.supplyId,
            },
          },
        });

        if (balance?.capacity !== null && balance?.capacity !== undefined) {
          const currentQty = Number(balance.quantity || 0);
          const maxCap = Number(balance.capacity);
          // Count reservations inside the same transaction to avoid stale reads
          const reservations = await tx.restockRequest.aggregate({
            where: {
              zoneId: request.zoneId,
              supplyId: request.supplyId,
              status: RestockStatus.DELIVERING,
              id: { not: request.id },
            },
            _sum: { approvedQuantity: true },
          });
          const reservedQty = Number(reservations._sum.approvedQuantity || 0);
          if (currentQty + reservedQty + approvedQty > maxCap) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'CAPACITY_EXCEEDED',
              `Số lượng phê duyệt (${approvedQty}) cộng lượng đang giao (${reservedQty}) vượt quá sức chứa (${maxCap} ${request.supply.unit}).`,
            );
          }
        }
      }

      // Atomic update: only succeeds if status is still PENDING (prevents double-click/concurrency race)
      return tx.restockRequest.updateMany({
        where: { id, status: RestockStatus.PENDING },
        data: {
          status: isApproved ? RestockStatus.DELIVERING : RestockStatus.REJECTED,
          approvedQuantity: isApproved ? new Prisma.Decimal(approvedQty) : null,
          rejectionReason: !isApproved ? dto.rejectionReason : null,
          reviewedAt: now,
          reviewedById: currentUser.userId,
        },
      });
    });

    if (updateResult.count === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS',
        'Phiếu đã được xử lý bởi phiên làm việc khác hoặc không còn ở trạng thái PENDING.',
      );
    }

    const updated = await this.prisma.restockRequest.findUniqueOrThrow({
      where: { id },
      include: {
        zone: { select: { id: true, code: true, name: true } },
        supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        reviewedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      isApproved ? 'RESTOCK_APPROVED' : 'RESTOCK_REJECTED',
      `Phiếu đề xuất ${request.requestNumber} (${request.supply.name} - ${request.zone.name}) đã được ${isApproved ? 'DUYỆT VÀ BẮT ĐẦU GIAO HÀNG' : 'TỪ CHỐI'} bởi ${currentUser.fullName}.`,
      request.id,
      {
        entityName: 'RestockRequest',
        newValues: { status: updated.status, approvedQuantity: updated.approvedQuantity },
      },
    );

    // Bắn thông báo cho người tạo đề xuất
    try {
      await this.notificationsService.notifyUsers(
        [request.requestedById],
        {
          type: isApproved ? 'RESTOCK_APPROVED' : 'RESTOCK_REJECTED',
          category: NotificationCategory.SYSTEM,
          title: isApproved ? 'Đề xuất vật tư đã được phê duyệt' : 'Đề xuất vật tư bị từ chối',
          message: isApproved
            ? `Quản lý đã duyệt bổ sung ${updated.approvedQuantity} ${request.supply.unit} ${request.supply.name}. Đơn hàng đang được vận chuyển đến ${request.zone.name}.`
            : `Đề xuất ${request.requestNumber} bị từ chối. Lý do: ${dto.rejectionReason || 'Không phù hợp'}`,
          link: '/supplies/requests',
          senderName: currentUser.fullName,
          params: { requestNumber: request.requestNumber || '' },
        },
        currentUser.userId,
      );
    } catch (notifErr: any) {
      this.logger.warn(
        `Failed to send approval notification for ${request.id}: ${notifErr?.message}`,
      );
    }

    if (isApproved) {
      // Generate signed ACK capability and schedule 20s watchdog timer
      const ackCapability = this.generateAckCapability(request.id, now);
      const timer = setTimeout(() => {
        this.completeDelivery(request.id, 'FALLBACK').catch((err) => {
          this.logger.error(`Watchdog fallback error for ${request.id}: ${err.message}`);
        });
      }, 20000);
      this.deliveryTimers.set(request.id, timer);

      // Broadcast sys:supply_delivery_start to connected Simulator clients
      this.gateway?.broadcastDeliveryStart({
        requestId: request.id,
        requestNumber: request.requestNumber || '',
        zoneId: request.zoneId,
        supplyId: request.supplyId,
        supplyCode: request.supply.code,
        supplyName: request.supply.name,
        category: request.supply.category,
        unit: request.supply.unit,
        approvedQuantity: approvedQty,
        dispatchedAt: now.toISOString(),
        animationEndsAt: new Date(now.getTime() + 8000).toISOString(),
        fallbackAt: new Date(now.getTime() + 20000).toISOString(),
        ackCapability,
      });
    }

    return {
      ...updated,
      requestedQuantity: Number(updated.requestedQuantity),
      approvedQuantity: updated.approvedQuantity ? Number(updated.approvedQuantity) : null,
    };
  }

  /**
   * TASK F4-07-BE: Xác nhận nhận hàng / Nhập kho & TỰ ĐỘNG CỘNG TỒN KHO (Dành cho phiếu APPROVED cũ)
   */
  async deliverRestockRequest(
    id: string,
    dto: DeliverRestockRequestDto,
    currentUser: CurrentUserPayload,
  ) {
    if (currentUser.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Quản lý CLB được quyền xác nhận nhập kho.',
      );
    }

    const request = await this.prisma.restockRequest.findUnique({
      where: { id },
      include: { supply: true, zone: true },
    });

    if (!request) {
      throw apiError(HttpStatus.NOT_FOUND, 'REQUEST_NOT_FOUND', 'Phiếu đề xuất không tồn tại.');
    }

    if (request.status !== RestockStatus.APPROVED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS',
        'Chỉ xác nhận nhập kho đối với phiếu đã được duyệt (APPROVED).',
      );
    }

    const amountToAdd = Number(
      dto.receivedQuantity ?? request.approvedQuantity ?? request.requestedQuantity,
    );
    if (amountToAdd <= 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Số lượng nhập kho phải lớn hơn 0.',
      );
    }

    const now = new Date();

    // Transaction: cập nhật phiếu sang DELIVERED & cộng dồn vào StockBalance
    // Dùng interactive transaction có zone-row lock và updateMany where status == APPROVED để đảm bảo tính nguyên tử:
    // nếu 2 request deliver chạy đồng thời, chỉ đúng 1 request cập nhật thành công (count = 1),
    // request thứ 2 có count = 0 sẽ throw error và rollback, bảo vệ tồn kho không bị cộng 2 lần.
    const { updated } = await this.prisma.$transaction(async (tx) => {
      // R-1: Zone-row lock serializes concurrent approvals, adjustments, legacy receipts, and completions
      await tx.$queryRaw`SELECT id FROM "StallZone" WHERE id = ${request.zoneId} FOR UPDATE`;

      const currentBalance = await tx.stockBalance.findUnique({
        where: {
          zoneId_supplyId: {
            zoneId: request.zoneId,
            supplyId: request.supplyId,
          },
        },
      });
      const currentQty = currentBalance ? Number(currentBalance.quantity) : 0;
      if (currentBalance?.capacity !== null && currentBalance?.capacity !== undefined) {
        const reservations = await tx.restockRequest.aggregate({
          where: {
            zoneId: request.zoneId,
            supplyId: request.supplyId,
            status: RestockStatus.DELIVERING,
          },
          _sum: { approvedQuantity: true },
        });
        const reservedQty = Number(reservations._sum.approvedQuantity || 0);
        const maxCap = Number(currentBalance.capacity);
        if (currentQty + reservedQty + amountToAdd > maxCap) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'CAPACITY_EXCEEDED',
            `Số lượng nhập kho (${amountToAdd}) cộng lượng đang giao (${reservedQty}) vượt quá sức chứa (${maxCap} ${request.supply.unit}).`,
          );
        }
      }

      const updateResult = await tx.restockRequest.updateMany({
        where: { id, status: RestockStatus.APPROVED },
        data: {
          status: RestockStatus.DELIVERED,
          deliveredAt: now,
          deliveredById: currentUser.userId,
        },
      });

      if (updateResult.count === 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS',
          'Phiếu đề xuất đã được giao hàng hoặc không còn ở trạng thái APPROVED.',
        );
      }

      await tx.stockBalance.upsert({
        where: {
          zoneId_supplyId: {
            zoneId: request.zoneId,
            supplyId: request.supplyId,
          },
        },
        create: {
          zoneId: request.zoneId,
          supplyId: request.supplyId,
          quantity: new Prisma.Decimal(amountToAdd),
          minThreshold: new Prisma.Decimal(10),
          lastInventoryDate: now,
          lastAdjustedById: currentUser.userId,
          notes: `Nhập kho từ phiếu đề xuất ${request.requestNumber}`,
        },
        update: {
          quantity: { increment: new Prisma.Decimal(amountToAdd) },
          lastInventoryDate: now,
          lastAdjustedById: currentUser.userId,
          notes: `Nhập kho từ phiếu đề xuất ${request.requestNumber}`,
        },
      });

      const updatedRequest = await tx.restockRequest.findUniqueOrThrow({
        where: { id },
        include: {
          zone: { select: { id: true, code: true, name: true } },
          supply: { select: { id: true, code: true, name: true, category: true, unit: true } },
          requestedBy: { select: { id: true, fullName: true, role: true } },
          reviewedBy: { select: { id: true, fullName: true, role: true } },
          deliveredBy: { select: { id: true, fullName: true, role: true } },
        },
      });

      return { updated: updatedRequest };
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      'STOCK_RESTOCKED',
      `Xác nhận nhập kho thành công: +${amountToAdd} ${request.supply.unit} ${request.supply.name} tại ${request.zone.name}. Phiếu ${request.requestNumber}.`,
      request.id,
      {
        entityName: 'RestockRequest',
        newValues: { status: RestockStatus.DELIVERED, addedQuantity: amountToAdd },
      },
    );

    // Bắn thông báo cho người tạo đề xuất
    await this.notificationsService.notifyUsers(
      [request.requestedById],
      {
        type: 'RESTOCK_DELIVERED',
        category: NotificationCategory.SYSTEM,
        title: 'Vật tư đã được nhập kho',
        message: `Đơn đề xuất ${request.requestNumber} đã được xác nhận nhập kho (+${amountToAdd} ${request.supply.unit} ${request.supply.name}) tại ${request.zone.name}.`,
        link: '/supplies/inventory',
        senderName: currentUser.fullName,
        params: { requestNumber: request.requestNumber || '' },
      },
      currentUser.userId,
    );

    return {
      ...updated,
      requestedQuantity: Number(updated.requestedQuantity),
      approvedQuantity: updated.approvedQuantity ? Number(updated.approvedQuantity) : null,
    };
  }
}
