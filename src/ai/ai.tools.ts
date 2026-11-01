// Công cụ chỉ đọc dùng chung cho Trợ lý TMEC và endpoint MCP (tools/list, tools/call).
// Mỗi công cụ gọi service nghiệp vụ có sẵn với đúng người gọi, nên phạm vi dữ liệu theo RULE-RBAC-01.
// Số liệu, cảnh báo do code tính; model chỉ diễn giải (RULE-AI-01: không có công cụ ghi).
import { Injectable } from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/role.enum';
import { FinancialService } from '../financial/financial.service';
import { HorsesService } from '../horses/horses.service';
import { IncidentsService } from '../incidents/incidents.service';
import { InventoryService } from '../inventory/inventory.service';
import { HealthOverviewService } from '../medical/health-overview.service';
import { ShiftRostersService } from '../shift-rosters/shift-rosters.service';
import { WorkoutsService } from '../training/workouts.service';
import { shiftCovers, toMinutes } from '../daily-tasks/daily-schedule';
import { KnowledgeService } from './knowledge.service';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  roles: UserRole[] | 'ALL';
}

/** Kết quả chuẩn của công cụ dữ liệu: bảng + câu tóm tắt + cảnh báo, đều do code tính. */
export interface ToolData {
  tool: string;
  title: string;
  summary: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  alerts: { level: 'danger' | 'warn' | 'info'; text: string }[];
  route: string;
  asOf: string;
  domain?: 'medical' | 'financial';
}

const STAFF = [UserRole.CLUB_MANAGER, UserRole.HEAD_TRAINER, UserRole.VETERINARIAN, UserRole.GROOM];
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const DAYS_ARG = {
  type: 'object',
  properties: { days: { type: 'integer', minimum: 1, maximum: 14 } },
  additionalProperties: false,
};

export const TOOLS: ToolDef[] = [
  {
    name: 'search_docs',
    description:
      'Tìm đoạn hướng dẫn sử dụng TMEC theo vai trò của người gọi. Trả về đoạn trích kèm mã trích dẫn.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500 },
        k: { type: 'integer', minimum: 1, maximum: 8 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    roles: 'ALL',
  },
  {
    name: 'list_my_horses',
    description: 'Danh sách ngựa trong phạm vi quyền: tên, mã, trạng thái, khóa y tế, ô chuồng.',
    inputSchema: NO_ARGS,
    roles: 'ALL',
  },
  {
    name: 'medical_lock_status',
    description: 'Các ngựa đang bị Khóa huấn luyện (RULE-MED-01) trong phạm vi quyền.',
    inputSchema: NO_ARGS,
    roles: 'ALL',
  },
  {
    name: 'training_overview',
    description:
      'Buổi tập trong N ngày tới (mặc định 7): số buổi theo trạng thái, buổi bị chặn do khóa y tế.',
    inputSchema: DAYS_ARG,
    roles: [UserRole.CLUB_MANAGER, UserRole.HEAD_TRAINER, UserRole.GROOM, UserRole.HORSE_OWNER],
  },
  {
    name: 'groom_shifts',
    description:
      'Ca trực Groom trong N ngày tới (mặc định 7); Groom chỉ thấy ca của mình. Báo Groom bị trùng giờ.',
    inputSchema: DAYS_ARG,
    roles: [UserRole.CLUB_MANAGER, UserRole.GROOM],
  },
  {
    name: 'inventory_status',
    description: 'Tồn kho vật tư theo khu chuồng, đánh dấu mặt hàng dưới ngưỡng tối thiểu.',
    inputSchema: NO_ARGS,
    roles: STAFF,
  },
  {
    name: 'owner_costs',
    description:
      'Chi phí nuôi ngựa và hóa đơn: phí nuôi, y tế, huấn luyện, tiền thưởng trừ, số phải trả. Chủ ngựa chỉ thấy của mình.',
    inputSchema: NO_ARGS,
    roles: [UserRole.CLUB_MANAGER, UserRole.HORSE_OWNER],
  },
  {
    name: 'incident_reports',
    description: 'Sự cố chuồng trại gần nhất và số sự cố chưa xử lý.',
    inputSchema: NO_ARGS,
    roles: STAFF,
  },
  {
    name: 'herd_health',
    description: 'Tổng quan sức khỏe đàn: số ngựa theo nhóm, ngựa khóa y tế, lịch định kỳ quá hạn.',
    inputSchema: NO_ARGS,
    roles: 'ALL',
  },
];

export const toolsFor = (role: string) =>
  TOOLS.filter((t) => t.roles === 'ALL' || t.roles.includes(role as UserRole));

export class ToolInputError extends Error {}
export class ToolForbiddenError extends Error {}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Hoạt động',
  IN_TRAINING: 'Đang tập',
  UNDER_OBSERVATION: 'Theo dõi',
  INJURED: 'Chấn thương',
  ISOLATED: 'Cách ly',
  RESTING: 'Nghỉ',
  RETIRED: 'Ngừng quản lý',
  SCHEDULED: 'Đã lên lịch',
  COMPLETED: 'Hoàn thành',
  BLOCKED: 'Bị chặn',
  MISSED: 'Bỏ lỡ',
  CANCELLED: 'Đã hủy',
  REPORTED: 'Đã báo cáo',
  UNDER_REVIEW: 'Đang xem xét',
  RESOLVED: 'Đã xử lý',
  DISMISSED: 'Bỏ qua',
  DRAFT: 'Nháp',
  SENT: 'Đã gửi',
  PAID: 'Đã thanh toán',
  OVERDUE: 'Quá hạn',
  SUFFICIENT: 'Đủ',
  LOW_STOCK: 'Sắp hết',
  OUT_OF_STOCK: 'Hết hàng',
  MILD: 'Nhẹ',
  MODERATE: 'Trung bình',
  CRITICAL: 'Nghiêm trọng',
};
const label = (s?: string | null) => (s ? (STATUS_LABEL[s] ?? s) : '—');
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`;
const clubDate = (d: Date | string) =>
  new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const MAX_ROWS = 50;

@Injectable()
export class AiToolsService {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly horses: HorsesService,
    private readonly workouts: WorkoutsService,
    private readonly rosters: ShiftRostersService,
    private readonly inventory: InventoryService,
    private readonly financial: FinancialService,
    private readonly incidents: IncidentsService,
    private readonly health: HealthOverviewService,
  ) {}

  /** Kiểm tra quyền + tham số theo inputSchema rồi chạy. */
  async call(
    name: string,
    args: Record<string, unknown>,
    user: CurrentUserPayload,
  ): Promise<unknown> {
    const def = TOOLS.find((t) => t.name === name);
    if (!def) throw new ToolInputError(`Unknown tool: ${name}`);
    if (!toolsFor(user.role).includes(def))
      throw new ToolForbiddenError(`Tool ${name} is not available for role ${user.role}`);
    const allowed = Object.keys((def.inputSchema.properties as object) ?? {});
    const extra = Object.keys(args).filter((k) => !allowed.includes(k));
    if (extra.length) throw new ToolInputError(`Unexpected arguments: ${extra.join(', ')}`);

    if (name === 'search_docs') {
      const query = args.query;
      if (typeof query !== 'string' || !query.trim() || query.length > 500)
        throw new ToolInputError('query must be 1-500 chars');
      const k = args.k === undefined ? 4 : Number(args.k);
      if (!Number.isInteger(k) || k < 1 || k > 8) throw new ToolInputError('k must be 1-8');
      return this.knowledge.search(query, user.role, k).map((e) => ({
        evidenceId: e.evidenceId,
        documentId: e.documentId,
        headingPath: e.headingPath,
        content: e.content,
        score: e.score,
      }));
    }

    const days = args.days === undefined ? 7 : Number(args.days);
    if (!Number.isInteger(days) || days < 1 || days > 14)
      throw new ToolInputError('days must be 1-14');
    const asOf = new Date().toISOString();
    switch (name) {
      case 'list_my_horses':
      case 'medical_lock_status':
        return this.horseTool(name, user, asOf);
      case 'training_overview':
        return this.trainingTool(days, user, asOf);
      case 'groom_shifts':
        return this.shiftTool(days, user, asOf);
      case 'inventory_status':
        return this.inventoryTool(user, asOf);
      case 'owner_costs':
        return this.costTool(user, asOf);
      case 'incident_reports':
        return this.incidentTool(asOf);
      default:
        return this.herdTool(user, asOf);
    }
  }

  private async horseTool(name: string, user: CurrentUserPayload, asOf: string): Promise<ToolData> {
    const locks = name === 'medical_lock_status';
    const result = await this.horses.findAll(
      { page: 1, limit: 100, ...(locks ? { isMedicalLocked: 'true' } : {}) } as never,
      user,
    );
    const items = result.items as any[];
    const owner = user.role === UserRole.HORSE_OWNER;
    return {
      tool: name,
      title: locks ? 'Ngựa đang khóa huấn luyện' : 'Ngựa trong phạm vi của bạn',
      summary: locks
        ? items.length
          ? `Có ${items.length} ngựa đang bị Khóa huấn luyện trong phạm vi của bạn.`
          : 'Hiện không có ngựa nào bị Khóa huấn luyện trong phạm vi của bạn.'
        : `Bạn có ${items.length} ngựa trong phạm vi quyền, ${items.filter((h) => h.isMedicalLocked).length} con đang khóa y tế.`,
      columns: locks
        ? [
            { key: 'name', label: 'Ngựa' },
            { key: 'reason', label: 'Lý do khóa' },
            { key: 'lockedAt', label: 'Ngày khóa' },
          ]
        : [
            { key: 'name', label: 'Ngựa' },
            { key: 'status', label: 'Trạng thái' },
            { key: 'stall', label: 'Ô chuồng' },
            { key: 'lock', label: 'Khóa y tế' },
          ],
      rows: items.slice(0, MAX_ROWS).map((h): ToolData['rows'][number] => {
        const lock = h.medicalLocks?.[0];
        const name = h.horseCode ? `${h.name} (${h.horseCode})` : h.name;
        return locks
          ? {
              name,
              reason: lock?.lockReason ?? 'Đang khóa huấn luyện',
              lockedAt: lock?.lockedAt ? clubDate(lock.lockedAt) : null,
            }
          : {
              name,
              status: label(h.status),
              stall: h.stallCode ?? h.stallAllocations?.[0]?.stall?.code ?? null,
              lock: h.isMedicalLocked ? 'Có' : 'Không',
            };
      }),
      alerts: locks
        ? items.map((h) => ({
            level: 'danger' as const,
            text: `${h.name}: không xếp bài tập nặng, không đăng ký thi đấu (RULE-MED-01).`,
          }))
        : [],
      route: locks ? '/locks' : owner ? '/my-horses' : '/horses',
      asOf,
      domain: locks ? 'medical' : undefined,
    };
  }

  private async trainingTool(
    days: number,
    user: CurrentUserPayload,
    asOf: string,
  ): Promise<ToolData> {
    const from = clubDate(new Date());
    const to = clubDate(new Date(Date.now() + (days - 1) * 86400_000));
    const rows = (await this.workouts.findAllWorkouts({ from, to }, user)) as any[];
    const by = (s: string) => rows.filter((w) => w.status === s).length;
    const blocked = rows.filter((w) => w.status === 'BLOCKED');
    return {
      tool: 'training_overview',
      title: `Buổi tập ${from} → ${to}`,
      summary: `${days} ngày tới có ${rows.length} buổi tập: ${by('SCHEDULED')} đã lên lịch, ${by('COMPLETED')} hoàn thành, ${blocked.length} bị chặn.`,
      columns: [
        { key: 'date', label: 'Ngày' },
        { key: 'horse', label: 'Ngựa' },
        { key: 'distance', label: 'Cự ly (m)' },
        { key: 'status', label: 'Trạng thái' },
      ],
      rows: rows.slice(0, MAX_ROWS).map((w) => ({
        date: clubDate(w.scheduledDate),
        horse: w.horse?.name ?? '—',
        distance: w.distanceMeters ?? null,
        status: label(w.status),
      })),
      alerts: blocked.map((w) => ({
        level: 'warn' as const,
        text: `${w.horse?.name ?? 'Ngựa'} ngày ${clubDate(w.scheduledDate)} bị chặn${w.statusReason ? `: ${w.statusReason}` : ' do khóa y tế'}.`,
      })),
      route:
        user.role === UserRole.GROOM
          ? '/my-training'
          : user.role === UserRole.HORSE_OWNER
            ? '/progress'
            : '/training',
      asOf,
    };
  }

  private async shiftTool(days: number, user: CurrentUserPayload, asOf: string): Promise<ToolData> {
    const startDate = clubDate(new Date());
    const endDate = clubDate(new Date(Date.now() + (days - 1) * 86400_000));
    const mine = user.role === UserRole.GROOM;
    const raw = mine
      ? ((await this.rosters.getMyShifts(user, { startDate, endDate })) as any[]).map((r) => ({
          ...r,
          groom: { id: user.userId, fullName: user.fullName },
        }))
      : ((await this.rosters.findAll({ startDate, endDate })) as any[]);
    const rows = raw.map((r) => ({
      date: clubDate(r.date).slice(0, 10),
      dateKey: new Date(r.date).toISOString().slice(0, 10),
      shift: r.shift?.name ?? '—',
      zone: r.zone?.name ?? '—',
      groom: r.groom?.fullName ?? '—',
      groomId: r.groom?.id ?? '',
      shiftRef: r.shift,
    }));
    // Trùng giờ = cùng Groom, cùng ngày, hai ca khác nhau có giờ chồng nhau.
    const alerts: ToolData['alerts'] = [];
    const seen = new Set<string>();
    for (const a of rows) {
      for (const b of rows) {
        if (a === b || a.groomId !== b.groomId || a.dateKey !== b.dateKey) continue;
        if (a.shiftRef?.id === b.shiftRef?.id || !a.shiftRef || !b.shiftRef) continue;
        const overlap = shiftCovers(a.shiftRef, toMinutes(b.shiftRef.startTime));
        const key = [a.groomId, a.dateKey, ...[a.shift, b.shift].sort()].join('|');
        if (overlap && !seen.has(key)) {
          seen.add(key);
          alerts.push({
            level: 'warn',
            text: `${a.groom} trùng giờ ngày ${a.dateKey}: ${a.shift} và ${b.shift}.`,
          });
        }
      }
    }
    const grooms = new Set(rows.map((r) => r.groomId)).size;
    return {
      tool: 'groom_shifts',
      title: `Ca trực ${startDate} → ${endDate}`,
      summary: mine
        ? `${days} ngày tới bạn có ${rows.length} ca trực.`
        : `${days} ngày tới có ${rows.length} lượt phân ca cho ${grooms} Groom, ${alerts.length} trường hợp trùng giờ.`,
      columns: [
        { key: 'date', label: 'Ngày' },
        { key: 'shift', label: 'Ca' },
        { key: 'zone', label: 'Khu' },
        ...(mine ? [] : [{ key: 'groom', label: 'Groom' }]),
      ],
      rows: rows
        .slice(0, MAX_ROWS)
        .map(({ date, shift, zone, groom }) => ({ date, shift, zone, groom })),
      alerts,
      route: '/stable/shifts',
      asOf,
    };
  }

  private async inventoryTool(user: CurrentUserPayload, asOf: string): Promise<ToolData> {
    const res = (await this.inventory.findAllStock({} as never, user)) as any;
    const items = res.items as any[];
    const short = items.filter((i) => i.healthStatus !== 'SUFFICIENT');
    return {
      tool: 'inventory_status',
      title: 'Tồn kho theo khu',
      summary: `Có ${items.length} dòng tồn kho, ${res.lowStockCount} sắp hết và ${res.outOfStockCount} hết hàng.`,
      columns: [
        { key: 'zone', label: 'Khu' },
        { key: 'supply', label: 'Vật tư' },
        { key: 'quantity', label: 'Tồn' },
        { key: 'min', label: 'Ngưỡng' },
        { key: 'status', label: 'Tình trạng' },
      ],
      // Mặt hàng thiếu lên đầu để bảng trong khung chat luôn thấy.
      rows: [...short, ...items.filter((i) => i.healthStatus === 'SUFFICIENT')]
        .slice(0, MAX_ROWS)
        .map((i) => ({
          zone: i.zone?.name ?? i.zoneName ?? '—',
          supply: i.supply?.name ?? '—',
          quantity: `${i.quantity} ${i.supply?.unit ?? ''}`.trim(),
          min: i.minThreshold,
          status: label(i.healthStatus),
        })),
      alerts: short.map((i) => ({
        level: i.healthStatus === 'OUT_OF_STOCK' ? ('danger' as const) : ('warn' as const),
        text: `${i.supply?.name} tại ${i.zone?.name ?? 'khu'}: còn ${i.quantity}, ngưỡng ${i.minThreshold}.`,
      })),
      route: '/supplies/inventory',
      asOf,
    };
  }

  private async costTool(user: CurrentUserPayload, asOf: string): Promise<ToolData> {
    const owner = user.role === UserRole.HORSE_OWNER;
    const s = (await this.financial.getOwnerSummary(owner ? user.userId : undefined)) as any;
    const overdue = (s.invoices as any[]).filter((i) => i.status === 'OVERDUE');
    return {
      tool: 'owner_costs',
      title: owner ? 'Chi phí nuôi ngựa của bạn' : 'Chi phí nuôi ngựa toàn CLB',
      summary: `Tổng chi phí ${vnd(s.totalExpense)} (nuôi ${vnd(s.totalBoarding)}, y tế ${vnd(s.totalMedical)}, huấn luyện ${vnd(s.totalTraining)}), trừ thưởng ${vnd(s.totalPrizeCredit)}, còn phải trả ${vnd(s.totalNet)} trên ${s.invoiceCount} hóa đơn.`,
      columns: [
        { key: 'period', label: 'Kỳ' },
        { key: 'horse', label: 'Ngựa' },
        { key: 'net', label: 'Phải trả' },
        { key: 'status', label: 'Trạng thái' },
      ],
      rows: (s.invoices as any[]).slice(0, MAX_ROWS).map((i) => ({
        period: i.billingPeriod,
        horse: i.horse?.name ?? '—',
        net: vnd(i.netAmount),
        status: label(i.status),
      })),
      alerts: overdue.map((i) => ({
        level: 'danger' as const,
        text: `Hóa đơn kỳ ${i.billingPeriod} (${i.horse?.name ?? 'ngựa'}) quá hạn: ${vnd(i.netAmount)}.`,
      })),
      route: '/financial-reports',
      asOf,
      domain: 'financial',
    };
  }

  private async incidentTool(asOf: string): Promise<ToolData> {
    const res = (await this.incidents.findAll({ page: 1, limit: 20 } as never)) as any;
    const items = res.items as any[];
    const open = items.filter((i) => i.status === 'REPORTED' || i.status === 'UNDER_REVIEW');
    return {
      tool: 'incident_reports',
      title: 'Sự cố chuồng trại gần nhất',
      summary: `Có ${res.total} sự cố, ${open.length} trong 20 sự cố gần nhất chưa xử lý xong.`,
      columns: [
        { key: 'date', label: 'Ngày' },
        { key: 'horse', label: 'Ngựa' },
        { key: 'severity', label: 'Mức độ' },
        { key: 'status', label: 'Trạng thái' },
      ],
      rows: items.map((i) => ({
        date: clubDate(i.createdAt),
        horse: i.horse?.name ?? '—',
        severity: label(i.severity),
        status: label(i.status),
      })),
      alerts: open
        .filter((i) => i.severity === 'CRITICAL')
        .map((i) => ({
          level: 'danger' as const,
          text: `Sự cố nghiêm trọng của ${i.horse?.name ?? 'ngựa'} chưa xử lý xong.`,
        })),
      route: '/incidents',
      asOf,
      domain: 'medical',
    };
  }

  private async herdTool(user: CurrentUserPayload, asOf: string): Promise<ToolData> {
    const res = (await this.health.getHealthBoard({} as never, user)) as any;
    const s = res.summary;
    const attention = (res.data as any[]).filter(
      (h) => h.healthGroup !== 'QUALIFIED' || h.isMedicalLocked || h.hasOverduePreventive,
    );
    return {
      tool: 'herd_health',
      title: 'Sức khỏe đàn',
      summary: `${s.total} ngựa: ${s.qualifiedCount} đủ điều kiện, ${s.observationCount} theo dõi, ${s.injuredCount} chấn thương, ${s.isolatedCount} cách ly; ${s.lockedCount} đang khóa y tế, ${s.overdueCount} có lịch định kỳ quá hạn.`,
      columns: [
        { key: 'name', label: 'Ngựa' },
        { key: 'status', label: 'Trạng thái' },
        { key: 'lock', label: 'Khóa y tế' },
        { key: 'overdue', label: 'Định kỳ quá hạn' },
      ],
      rows: attention.slice(0, MAX_ROWS).map((h) => ({
        name: h.name,
        status: label(h.status),
        lock: h.isMedicalLocked ? 'Có' : 'Không',
        overdue: h.hasOverduePreventive ? 'Có' : 'Không',
      })),
      alerts: attention
        .filter((h) => h.hasOverduePreventive)
        .map((h) => ({
          level: 'warn' as const,
          text: `${h.name} có lịch chăm sóc định kỳ quá hạn.`,
        })),
      route: user.role === UserRole.HORSE_OWNER ? '/health' : '/herd',
      asOf,
      domain: 'medical',
    };
  }
}
