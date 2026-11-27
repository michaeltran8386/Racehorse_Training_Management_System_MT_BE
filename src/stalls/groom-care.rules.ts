import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { onDutyGrooms, rosterDay } from '../shift-rosters/groom-zones';

export const MAX_CARE_STALLS = 6;

export async function lockCareAssignments(tx: Prisma.TransactionClient) {
  // A single club-level lock keeps roster edits and care allocations consistent.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74203211)`;
}

export async function assertPrimaryGroom(
  tx: Prisma.TransactionClient,
  zoneId: string | null,
  groomId: string,
  excludeAllocationId?: string,
) {
  const groom = await tx.user.findUnique({ where: { id: groomId } });
  if (!groom || groom.role !== 'GROOM' || groom.status !== 'ACTIVE')
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_GROOM',
      'Chọn nhân viên chăm sóc đang hoạt động.',
    );
  if (!zoneId)
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_ZONE_REQUIRED',
      'Ô chuồng phải thuộc một khu đang hoạt động để phân công Groom.',
    );
  if (groom.assignedBarnId && groom.assignedBarnId !== zoneId)
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_MULTI_ZONE_FORBIDDEN',
      'Groom chăm sóc chính chỉ phụ trách một khu chuồng.',
    );
  const where: Prisma.StallAllocationWhereInput = {
    assignedGroomUserId: groomId,
    isActive: true,
    ...(excludeAllocationId && { id: { not: excludeAllocationId } }),
  };
  if (
    await tx.stallAllocation.findFirst({ where: { ...where, stall: { zoneId: { not: zoneId } } } })
  )
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_MULTI_ZONE_FORBIDDEN',
      'Groom chăm sóc chính chỉ phụ trách một khu chuồng.',
    );
  if ((await tx.stallAllocation.count({ where })) >= MAX_CARE_STALLS)
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_MAX_STALLS_EXCEEDED',
      'Groom đã đủ 6 ô chuồng đang chăm sóc.',
    );
  return groom;
}

export async function assertReceivingGroom(
  tx: Prisma.TransactionClient,
  zoneId: string,
  groomId: string,
  horseId: string,
  at = new Date(),
  duty = 'HORSE_CARE',
) {
  const roster = (await onDutyGrooms(tx, zoneId, at)).find(
    (r) => r.groomUserId === groomId && (!r.dutyTypes || r.dutyTypes.includes(duty)),
  );
  if (!roster)
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_NOT_ON_DUTY',
      'Người nhận bàn giao phải đang trực chăm sóc tại khu của ô được chọn.',
    );
  const tasks = await tx.dailyCareTask.findMany({
    where: {
      assignedGroomUserId: groomId,
      date: roster.date,
      shiftId: roster.shiftId,
      cancelledAt: null,
    },
    select: { horseId: true },
    distinct: ['horseId'],
  });
  const horses = new Set(tasks.map((t) => t.horseId));
  if (!horses.has(horseId) && horses.size >= MAX_CARE_STALLS)
    throw apiError(
      HttpStatus.CONFLICT,
      'GROOM_SHIFT_CAPACITY_EXCEEDED',
      'Groom đang trực đã nhận chăm sóc 6 ngựa trong ca này.',
    );
  return roster;
}

export async function transferPendingCare(
  tx: Prisma.TransactionClient,
  horseId: string,
  zoneId: string,
  stallId: string,
  receivingId: string,
  shiftId: string,
  date = rosterDay(),
) {
  // Completed receipts stay at the original stall; unfinished work follows the horse.
  await tx.dailyCareTask.updateMany({
    where: { horseId, date: { gte: date }, isCompleted: false, cancelledAt: null },
    data: { stallZoneId: zoneId, stallId },
  });
  await tx.dailyCareTask.updateMany({
    where: { horseId, date, shiftId, isCompleted: false, cancelledAt: null },
    data: { assignedGroomUserId: receivingId },
  });
}
