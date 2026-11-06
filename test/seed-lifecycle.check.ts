import * as assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { calculateBoardingFee } from '../src/financial/boarding-fee';
import {
  addDays,
  clubDate,
  clubTime,
  isHeavy,
  startOfClubDay,
  TRIAL_SLOT_MINUTES,
} from '../src/training/training-rules';

async function check() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok(['/equiflow_seed_demo', '/racehorse_ci'].includes(url.pathname));
  assert.ok(!url.searchParams.has('host'));
  const prisma = new PrismaClient({ datasourceUrl: url.href });
  try {
    // Table names come from the generated Prisma schema, never from user input.
    const counts = Object.fromEntries(
      await Promise.all(
        Prisma.dmmf.datamodel.models.map(async (model) => {
          const table = Prisma.raw('"' + (model.dbName ?? model.name).replaceAll('"', '""') + '"');
          const [row] = await prisma.$queryRaw<{ count: bigint }[]>(
            Prisma.sql`SELECT count(*) FROM ${table}`,
          );
          assert.ok(row.count > 0n, `Empty seed model: ${model.name}`);
          return [model.name, Number(row.count)];
        }),
      ),
    );
    const [
      horses,
      stalls,
      workouts,
      plans,
      locks,
      vaccines,
      results,
      entries,
      invoices,
      tasks,
      rosters,
      stock,
      restocks,
      incidents,
    ] = await Promise.all([
      prisma.horse.findMany({
        where: { id: { startsWith: 'e091f100-' } },
        orderBy: { horseCode: 'asc' },
        include: { stallAllocations: true },
      }),
      prisma.stall.findMany({
        where: { id: { startsWith: 'e091f100-' } },
        orderBy: { code: 'asc' },
      }),
      prisma.workoutSession.findMany(),
      prisma.trainingPlan.findMany(),
      prisma.medicalLock.findMany({ include: { medicalRecord: { include: { injuries: true } } } }),
      prisma.preventiveSchedule.findMany(),
      prisma.tournamentResult.findMany({
        include: { registration: { include: { tournament: true } } },
      }),
      prisma.tournamentRegistration.findMany({ include: { tournament: true } }),
      prisma.financialInvoice.findMany(),
      prisma.dailyCareTask.findMany(),
      prisma.shiftRoster.findMany(),
      prisma.stockBalance.findMany(),
      prisma.restockRequest.findMany(),
      prisma.incidentReport.findMany(),
    ]);
    const now = new Date(),
      today = clubDate(now),
      todayStart = startOfClubDay(now);
    const horse = (n: number) => horses[n - 1];
    assert.equal(Object.keys(counts).length, 37);
    assert.equal(horses.length, 12);
    assert.deepEqual(
      horses.map((h) => h.horseCode),
      Array.from({ length: 12 }, (_, i) => `HR-${String(i + 1).padStart(6, '0')}`),
    );
    assert.equal(stalls.length, 20);
    assert.equal(stalls.filter((s) => s.status === 'OCCUPIED').length, 12);
    assert.equal(stalls.find((s) => s.code === 'STALL-B04')?.status, 'MAINTENANCE');
    assert.equal(horse(5).status, 'RETIRED');
    assert.equal(horse(6).status, 'ISOLATED');
    const historical = workouts.filter((w) => w.status === 'COMPLETED');
    for (const [n, minimum] of [
      [1, 35],
      [5, 50],
      [10, 35],
    ]) {
      const history = historical.filter((w) => w.horseId === horse(n).id);
      assert.ok(
        history.length >= minimum,
        `Insufficient completed workouts for ${horse(n).horseCode}`,
      );
      assert.ok(
        history.every(
          (w) =>
            w.scheduledDate < todayStart &&
            w.averageSpeedKmh! >= 45 &&
            w.averageSpeedKmh! <= 64 &&
            w.heartRatePeak! >= 130 &&
            w.heartRatePeak! <= 170 &&
            w.completionLevel === 'ACHIEVED' &&
            w.resultRecordedAt &&
            w.trainerNotes,
        ),
      );
    }
    assert.equal(
      plans.filter((p) => p.horseId === horse(1).id && p.status === 'COMPLETED').length,
      2,
    );
    assert.equal(historical.filter((w) => w.horseId === horse(8).id).length, 15);
    const scheduled = workouts.filter((w) => w.status === 'SCHEDULED');
    const trials = scheduled
      .filter((w) => w.workoutType === 'TRIAL' && clubDate(w.scheduledDate) === today)
      .sort((a, b) => +a.scheduledDate - +b.scheduledDate);
    assert.deepEqual(
      trials.map((w) => [w.horseId, w.trackSurface, clubTime(w.scheduledDate), w.targetSpeedKmh]),
      [
        [horse(1).id, 'TURF', { hour: 8, minute: 0 }, 62],
        [horse(4).id, 'TURF', { hour: 8, minute: TRIAL_SLOT_MINUTES }, 60],
      ],
    );
    assert.ok(
      scheduled.filter(
        (w) =>
          w.scheduledDate >= addDays(todayStart, 1) && w.scheduledDate < addDays(todayStart, 15),
      ).length >= 15,
    );
    assert.ok(
      scheduled.some(
        (w) =>
          w.scheduledDate > now &&
          plans.some((p) => p.id === w.trainingPlanId && p.status === 'ACTIVE'),
      ),
    );
    assert.ok(
      !scheduled.some(
        (w) =>
          w.horseId === horse(5).id ||
          (w.horseId === horse(2).id && isHeavy(w.workoutType, w.intensity)),
      ),
    );
    const locked = locks.find((l) => l.horseId === horse(2).id);
    assert.ok(
      horse(2).isMedicalLocked && locked?.isLocked && locked.medicalRecord?.status === 'OPEN',
    );
    assert.equal(clubDate(locked.medicalRecord.followUpDate!), clubDate(addDays(todayStart, 7)));
    assert.ok(
      locked.medicalRecord.injuries.some(
        (i) => i.status === 'ACTIVE' && i.bodySide === 'RIGHT' && i.severity === 'SEVERE',
      ),
    );
    assert.ok(locks.some((l) => l.horseId === horse(1).id && !l.isLocked && l.unlockedAt));
    for (const h of horses) {
      assert.equal(
        vaccines.filter(
          (v) => v.horseId === h.id && v.scheduleType === 'VACCINATION' && v.status === 'COMPLETED',
        ).length,
        3,
      );
    }
    assert.ok(vaccines.some((v) => v.status === 'OVERDUE' && v.dueDate < now));
    assert.deepEqual(
      results
        .filter((r) => r.registration.horseId === horse(5).id)
        .map((r) => r.finalRank)
        .sort(),
      [1, 1, 1, 2, 2],
    );
    assert.equal(
      entries.filter(
        (r) =>
          r.status === 'CONFIRMED' &&
          r.tournament.status === 'OPEN_REGISTRATION' &&
          clubDate(r.tournament.raceDate) === clubDate(addDays(todayStart, 20)),
      ).length,
      3,
    );
    assert.ok(
      !entries.some(
        (r) =>
          r.registrationDate <= now && r.tournament.raceDate > now && r.horseId === horse(2).id,
      ),
    );
    for (const bill of invoices) {
      const h = horses.find((row) => row.id === bill.horseId);
      assert.ok(h && h.ownerId === bill.ownerId && bill.billingPeriod < today.slice(0, 7));
      const expected = calculateBoardingFee(bill.billingPeriod, h.stallAllocations);
      assert.equal(bill.boardingDays, expected.boardingDays);
      assert.ok(bill.boardingFee.equals(expected.boardingFee));
      if (bill.status === 'DRAFT') assert.equal(bill.dueAt, null);
      else assert.equal(+bill.dueAt!, +addDays(bill.createdAt, 7));
    }
    const overdue = invoices.find((i) => i.status === 'OVERDUE');
    assert.ok(
      overdue &&
        overdue.horseId === horse(3).id &&
        overdue.netAmount.equals(6000000) &&
        overdue.dueAt! < now,
    );
    const sent = invoices.find((i) => i.status === 'SENT');
    assert.ok(sent && sent.netAmount.equals(8200000) && sent.dueAt! > now);
    assert.ok(invoices.some((i) => i.status === 'PAID' && i.netAmount.equals(14500000)));
    assert.ok(invoices.some((i) => i.status === 'DRAFT'));
    assert.equal(new Set(rosters.map((r) => r.date.toISOString().slice(0, 10))).size, 7);
    const todayTasks = tasks.filter((t) => t.date.toISOString().slice(0, 10) === today);
    assert.ok(todayTasks.some((t) => t.isCompleted) && todayTasks.some((t) => !t.isCompleted));
    assert.ok(
      todayTasks.some((t) => t.taskType === 'FEEDING') &&
        todayTasks.some((t) => t.taskType === 'CLEANING'),
    );
    assert.ok(stock.filter((s) => s.quantity.lt(s.minThreshold)).length >= 2);
    assert.deepEqual(restocks.map((r) => r.status).sort(), ['APPROVED', 'DELIVERED', 'PENDING']);
    assert.ok(incidents.some((i) => i.status === 'REPORTED' && clubDate(i.createdAt) === today));
    assert.equal(
      await prisma.refreshToken.count({ where: { revoked: false, expiresAt: { gt: now } } }),
      0,
    );
    assert.equal(await prisma.resetToken.count({ where: { expiresAt: { gt: now } } }), 0);
    assert.equal(await prisma.otpCode.count({ where: { expiresAt: { gt: now } } }), 0);
    console.log(JSON.stringify(counts));
  } finally {
    await prisma.$disconnect();
  }
}

check().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
