import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { apiError } from '../common/exceptions/api-error';
import { CreateStaffWorkDto, WorkRangeDto } from './dto/staff-work.dto';
import { assertStaffAvailable, workInterval } from './staff-work.rules';

const ROLES: Role[] = ['CLUB_MANAGER', 'VETERINARIAN', 'GROOM'];
export interface StaffWorkEvent {
  id: string;
  title: string;
  kind: string;
  userIds: string[];
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  location: string;
  link: string;
  sourceId?: string;
  notes?: string;
}

@Injectable()
export class StaffWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  members() {
    return this.prisma.user.findMany({
      where: { role: { in: ROLES }, status: 'ACTIVE' },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
  }

  async overview(range: WorkRangeDto, actor: CurrentUserPayload) {
    const from = new Date(`${range.from}T00:00:00+07:00`);
    const until = new Date(`${range.to}T00:00:00+07:00`);
    until.setTime(until.getTime() + 86400000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(until.getTime()) ||
      until <= from ||
      until.getTime() - from.getTime() > 31 * 86400000
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_WORK_RANGE',
        'Chọn khoảng thời gian từ 1 đến 31 ngày.',
      );
    }
    const manager = actor.role === 'CLUB_MANAGER';
    const own = manager ? {} : { id: actor.userId };
    const participants = manager
      ? {}
      : { OR: [{ managerUserId: actor.userId }, { veterinarianUserId: actor.userId }] };
    const dayFrom = new Date(`${range.from}T00:00:00Z`);
    const dayTo = new Date(`${range.to}T00:00:00Z`);
    const [members, admissions, work, shifts, tasks, preventives, records, openIncidents] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { ...own, role: { in: ROLES }, status: 'ACTIVE' },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: 'asc' },
        }),
        this.prisma.horseAdmissionRecord.findMany({
          where: {
            ...participants,
            appointmentDate: { gte: new Date(from.getTime() - 86400000), lt: until },
            status: { notIn: ['CANCELLED', 'REJECTED'] },
          },
          include: { horse: { select: { name: true } } },
        }),
        this.prisma.staffWorkItem.findMany({
          where: {
            ...(manager ? {} : { userId: actor.userId }),
            startsAt: { lt: until },
            endsAt: { gt: from },
            status: { not: 'CANCELLED' },
          },
        }),
        this.prisma.shiftRoster.findMany({
          where: {
            date: { gte: new Date(dayFrom.getTime() - 86400000), lte: dayTo },
            ...(manager ? {} : { groomUserId: actor.userId }),
          },
          include: { shift: true, zone: true },
        }),
        this.prisma.dailyCareTask.findMany({
          where: {
            date: { gte: new Date(dayFrom.getTime() - 86400000), lte: dayTo },
            cancelledAt: null,
            ...(manager ? {} : { assignedGroomUserId: actor.userId }),
          },
          include: { horse: { select: { name: true } }, stallZone: { select: { name: true } } },
        }),
        this.prisma.preventiveSchedule.findMany({
          where: {
            dueDate: { gte: from, lt: until },
            ...(manager ? {} : { veterinarianUserId: actor.userId }),
          },
          include: { horse: { select: { name: true } } },
        }),
        this.prisma.medicalRecord.findMany({
          where: {
            examinationDate: { gte: from, lt: until },
            status: { not: 'DRAFT' },
            ...(manager ? {} : { veterinarianUserId: actor.userId }),
          },
          include: { horse: { select: { name: true } } },
        }),
        manager
          ? this.prisma.incidentReport.count({
              where: { status: { in: ['REPORTED', 'UNDER_REVIEW'] }, parentIncidentId: null },
            })
          : Promise.resolve(0),
      ]);
    const events: StaffWorkEvent[] = [];
    const add = (e: StaffWorkEvent) => {
      if (new Date(e.endsAt) > from && new Date(e.startsAt) < until) events.push(e);
    };
    const allDay = (date: Date) => {
      const day = date.toISOString().slice(0, 10);
      const start = new Date(`${day}T00:00:00+07:00`);
      return {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 86400000).toISOString(),
        allDay: true,
      };
    };
    for (const a of admissions)
      if (a.appointmentDate)
        add({
          id: `admission:${a.id}`,
          title: `Thẩm định ${a.horse.name} · ${a.admissionCode}`,
          kind: 'ADMISSION',
          userIds: [a.managerUserId, a.veterinarianUserId].filter((id): id is string =>
            Boolean(id),
          ),
          startsAt: a.appointmentDate.toISOString(),
          endsAt: (
            a.appointmentEndDate ?? new Date(a.appointmentDate.getTime() + 3600000)
          ).toISOString(),
          allDay: false,
          status:
            a.status === 'APPROVED'
              ? 'COMPLETED'
              : a.status === 'INSPECTION_IN_PROGRESS'
                ? 'IN_PROGRESS'
                : 'PENDING',
          location: 'Cổng A',
          link: `${manager ? '/horses/admissions' : '/medical/admissions'}?inspection=${encodeURIComponent(a.id)}`,
        });
    for (const w of work)
      add({
        id: `work:${w.id}`,
        sourceId: w.id,
        title: w.title,
        kind: 'OTHER',
        userIds: [w.userId],
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        allDay: false,
        status: w.status,
        location: w.location ?? '',
        notes: w.notes ?? undefined,
        link: '/staff/schedule',
      });
    for (const s of shifts) {
      const day = s.date.toISOString().slice(0, 10);
      const start = new Date(`${day}T${s.shift.startTime.slice(0, 5)}:00+07:00`);
      const end = new Date(`${day}T${s.shift.endTime.slice(0, 5)}:00+07:00`);
      if (end <= start) end.setTime(end.getTime() + 86400000);
      const related = tasks.filter(
        (t) =>
          t.assignedGroomUserId === s.groomUserId &&
          t.shiftId === s.shiftId &&
          t.stallZoneId === s.zoneId &&
          t.date.getTime() === s.date.getTime(),
      );
      add({
        id: `shift:${s.id}`,
        title: `${s.shift.name} · ${s.zone.name}`,
        kind: 'SHIFT',
        userIds: [s.groomUserId],
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        status: related.length && related.every((t) => t.isCompleted) ? 'COMPLETED' : 'PENDING',
        location: s.zone.name,
        link: '/stable/shifts',
      });
    }
    for (const t of tasks) {
      const interval = allDay(t.date);
      if (t.scheduledTime) {
        interval.startsAt = new Date(
          `${t.date.toISOString().slice(0, 10)}T${t.scheduledTime.slice(0, 5)}:00+07:00`,
        ).toISOString();
      }
      add({
        id: `care:${t.id}`,
        title: `${t.title} · ${t.horse.name}`,
        kind: 'CARE',
        userIds: t.assignedGroomUserId ? [t.assignedGroomUserId] : [],
        ...interval,
        status: t.isCompleted ? 'COMPLETED' : 'PENDING',
        location: t.stallZone?.name ?? '',
        link: '/stable/tasks',
      });
    }
    for (const p of preventives)
      add({
        id: `preventive:${p.id}`,
        title: `Chăm sóc phòng ngừa · ${p.horse.name}`,
        kind: 'PREVENTIVE',
        userIds: p.veterinarianUserId ? [p.veterinarianUserId] : [],
        ...allDay(new Date(p.dueDate.getTime() + 7 * 3600000)),
        status: p.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
        location: '',
        link: '/medical/preventive',
      });
    for (const r of records)
      add({
        id: `medical:${r.id}`,
        title: `Bệnh án ${r.recordNumber ?? ''} · ${r.horse.name}`,
        kind: 'MEDICAL',
        userIds: [r.veterinarianUserId],
        ...allDay(new Date(r.examinationDate.getTime() + 7 * 3600000)),
        status: r.status === 'CLOSED' ? 'COMPLETED' : 'IN_PROGRESS',
        location: '',
        link: '/medical',
      });
    const now = effectiveNow().getTime();
    return {
      members,
      events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      openIncidents,
      summary: {
        total: events.length,
        completed: events.filter((e) => e.status === 'COMPLETED').length,
        inProgress: events.filter((e) => e.status === 'IN_PROGRESS').length,
        overdue: events.filter(
          (e) =>
            e.kind !== 'SHIFT' && e.status !== 'COMPLETED' && new Date(e.endsAt).getTime() < now,
        ).length,
        unassigned: events.filter(
          (e) => !e.userIds.length || (e.kind === 'ADMISSION' && e.userIds.length < 2),
        ).length,
      },
    };
  }

  async create(dto: CreateStaffWorkDto, actor: CurrentUserPayload) {
    const interval = workInterval(dto.startsAt, dto.endsAt);
    if (interval.startsAt <= effectiveNow())
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'WORK_IN_PAST',
        'Công việc mới phải bắt đầu trong tương lai.',
      );
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.user.findFirst({
        where: { id: dto.userId, role: { in: ROLES }, status: 'ACTIVE' },
      });
      if (!member)
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_WORK_ASSIGNEE',
          'Chọn Quản lý, bác sĩ hoặc nhân viên chăm sóc đang hoạt động.',
        );
      await assertStaffAvailable(tx, [dto.userId], interval.startsAt, interval.endsAt);
      const result = await tx.staffWorkItem.create({
        data: { ...dto, ...interval, createdById: actor.userId },
      });
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'STAFF_WORK_CREATED',
        dto.title,
        result.id,
        { entityName: 'StaffWorkItem', newValues: { ...dto } },
        tx,
      );
      return result;
    });
  }

  async changeStatus(id: string, status: string, actor: CurrentUserPayload) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.staffWorkItem.findUnique({ where: { id } });
      if (!item)
        throw apiError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Không tìm thấy công việc.');
      if (actor.role !== 'CLUB_MANAGER' && item.userId !== actor.userId)
        throw apiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Bạn chỉ được cập nhật công việc của mình.',
        );
      if (['COMPLETED', 'CANCELLED'].includes(item.status) && status !== item.status)
        throw apiError(
          HttpStatus.CONFLICT,
          'WORK_ALREADY_CLOSED',
          'Công việc đã kết thúc, không thể mở lại.',
        );
      const updated = await tx.staffWorkItem.update({
        where: { id, updatedAt: item.updatedAt },
        data: { status },
      });
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'STAFF_WORK_STATUS_CHANGED',
        item.title,
        id,
        { entityName: 'StaffWorkItem', oldValues: { status: item.status }, newValues: { status } },
        tx,
      );
      return updated;
    });
  }
}
