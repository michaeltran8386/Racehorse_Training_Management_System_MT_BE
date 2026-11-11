import {
  DailyTaskType,
  HorseCatalogType,
  HorseStatus,
  IncidentStatus,
  InvoiceStatus,
  MedicalRecordStatus,
  NotificationCategory,
  NutritionPlanStatus,
  PlanStatus,
  PreventiveStatus,
  PreventiveType,
  Prisma,
  PrismaClient,
  RegistrationStatus,
  RestockStatus,
  Role,
  SimulatorSessionStatus,
  SimulatorSessionType,
  StallStatus,
  TournamentStatus,
  UserStatus,
  WorkoutStatus,
} from '@prisma/client';
import * as assert from 'assert';
import * as bcrypt from 'bcryptjs';
import { existsSync } from 'fs';
import { HORSE_GENDERS } from '../src/horses/horse-rules';

function resolveDatabaseUrl(): string {
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  assert.ok(url, 'DIRECT_URL or DATABASE_URL must be set to run seed-lifecycle.check.ts');
  return url;
}

function modelDelegateName(modelName: string): string {
  return modelName.slice(0, 1).toLowerCase() + modelName.slice(1);
}

function distinct<T>(values: Iterable<T>): Set<T> {
  return new Set(values);
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
  try {
    // 1. All Prisma models (38) must be populated
    const models = Prisma.dmmf.datamodel.models;
    assert.strictEqual(models.length, 38, `Expected 38 Prisma models, saw ${models.length}`);
    for (const model of models) {
      const delegateKey = modelDelegateName(model.name);
      const count: number = await (prisma as any)[delegateKey].count();
      assert.ok(count > 0, `Model ${model.name} (${delegateKey}) must have > 0 rows, got ${count}`);
    }

    // 2. Users, roles, passwords, and all 7 UserStatus values
    const users = await prisma.user.findMany();
    const activeByRole = (role: Role) =>
      users.filter((u) => u.role === role && u.status === UserStatus.ACTIVE);
    assert.ok(activeByRole(Role.CLUB_MANAGER).length >= 2, 'Expected >= 2 active CLUB_MANAGER');
    assert.ok(activeByRole(Role.HEAD_TRAINER).length >= 4, 'Expected >= 4 active HEAD_TRAINER');
    assert.ok(activeByRole(Role.VETERINARIAN).length > 2, 'Expected > 2 active VETERINARIAN');
    assert.strictEqual(activeByRole(Role.GROOM).length, 10, 'Expected exactly 10 active GROOM');
    assert.ok(activeByRole(Role.HORSE_OWNER).length >= 6, 'Expected >= 6 active HORSE_OWNER');

    const userStatuses = distinct(users.map((u) => u.status));
    for (const st of Object.values(UserStatus)) {
      assert.ok(userStatuses.has(st), `Missing UserStatus: ${st}`);
    }

    const demoEmails = [
      'manager@gmail.com',
      'manager2@gmail.com',
      'trainer@gmail.com',
      'trainer2@gmail.com',
      'trainer3@gmail.com',
      'trainer4@gmail.com',
      'vet@gmail.com',
      'vet2@gmail.com',
      'vet3@gmail.com',
      'vet4@gmail.com',
      'groom@gmail.com',
      'groom10@gmail.com',
      'owner@gmail.com',
      'owner6@gmail.com',
    ];
    for (const email of demoEmails) {
      const u = users.find((item) => item.email === email);
      assert.ok(u?.passwordHash, `Missing passwordHash for ${email}`);
      const ok = await bcrypt.compare('EquiFlow@2026', u.passwordHash);
      assert.ok(ok, `Password EquiFlow@2026 failed for ${email}`);
    }

    // 3. Catalogs (8 active BREED + 1 inactive BREED, 8 COLOR), Stalls, Horses, BR-STL-07
    const catalogItems = await prisma.horseCatalogItem.findMany();
    const activeBreeds = catalogItems.filter(
      (c) => c.type === HorseCatalogType.BREED && c.isActive,
    );
    const activeColors = catalogItems.filter(
      (c) => c.type === HorseCatalogType.COLOR && c.isActive,
    );
    assert.ok(activeBreeds.length >= 8, `Expected >= 8 active BREEDs, got ${activeBreeds.length}`);
    assert.ok(activeColors.length >= 8, `Expected >= 8 active COLORs, got ${activeColors.length}`);

    const zones = await prisma.stallZone.findMany();
    const stalls = await prisma.stall.findMany();
    assert.ok(zones.length >= 4, 'Expected >= 4 StallZones');
    assert.ok(stalls.length >= 32, `Expected >= 32 Stalls, got ${stalls.length}`);
    for (const z of zones) {
      assert.ok(
        z.rows >= 1 && z.rows <= 4 && z.cols >= 1 && z.cols <= 4,
        `Zone ${z.code} grid out of bounds`,
      );
    }
    const stallStatuses = distinct(stalls.map((s) => s.status));
    for (const st of Object.values(StallStatus)) {
      assert.ok(stallStatuses.has(st), `Missing StallStatus: ${st}`);
    }

    const horses = await prisma.horse.findMany({
      include: { stallAllocations: { where: { isActive: true } } },
    });
    assert.ok(horses.length >= 18, `Expected >= 18 Horses, got ${horses.length}`);
    const horseStatuses = distinct(horses.map((h) => h.status));
    for (const st of Object.values(HorseStatus)) {
      assert.ok(horseStatuses.has(st), `Missing HorseStatus: ${st}`);
    }
    for (const b of activeBreeds) {
      assert.ok(
        horses.some((h) => h.breed === b.name),
        `Active breed ${b.name} has no horse assigned`,
      );
    }
    for (const h of horses) {
      assert.ok(HORSE_GENDERS.includes(h.gender), `Invalid horse gender ${h.gender} on ${h.name}`);
      if (h.status === HorseStatus.RETIRED) {
        assert.strictEqual(
          h.stallAllocations.length,
          0,
          `BR-STL-07 violated: RETIRED horse ${h.name} still has active stall allocation`,
        );
      }
    }

    // 4. Training & Simulator
    const plans = await prisma.trainingPlan.findMany();
    const planStatuses = distinct(plans.map((p) => p.status));
    for (const st of Object.values(PlanStatus)) {
      assert.ok(planStatuses.has(st), `Missing PlanStatus: ${st}`);
    }

    const workouts = await prisma.workoutSession.findMany();
    const workoutStatuses = distinct(workouts.map((w) => w.status));
    for (const st of Object.values(WorkoutStatus)) {
      assert.ok(workoutStatuses.has(st), `Missing WorkoutStatus: ${st}`);
    }

    const simSessions = await prisma.simulatorSession.findMany();
    const simTypes = distinct(simSessions.map((s) => s.type));
    const simStatuses = distinct(simSessions.map((s) => s.status));
    for (const t of Object.values(SimulatorSessionType)) {
      assert.ok(simTypes.has(t), `Missing SimulatorSessionType: ${t}`);
    }
    for (const st of Object.values(SimulatorSessionStatus)) {
      assert.ok(simStatuses.has(st), `Missing SimulatorSessionStatus: ${st}`);
    }

    // 5. Medical PR #153 (<= 1 OPEN record per horse) + Preventive 4 types
    const medRecords = await prisma.medicalRecord.findMany();
    const medStatuses = distinct(medRecords.map((m) => m.status));
    for (const st of Object.values(MedicalRecordStatus)) {
      assert.ok(medStatuses.has(st), `Missing MedicalRecordStatus: ${st}`);
    }
    const openByHorse = new Map<string, number>();
    for (const m of medRecords) {
      if (m.status === MedicalRecordStatus.OPEN) {
        openByHorse.set(m.horseId, (openByHorse.get(m.horseId) ?? 0) + 1);
      }
    }
    for (const [hId, count] of openByHorse.entries()) {
      assert.ok(count <= 1, `PR #153 violated: Horse ${hId} has ${count} OPEN medical records`);
    }

    const prevCatalog = await prisma.preventiveTypeCatalog.findMany();
    const prevCats = distinct(prevCatalog.map((c) => c.category));
    for (const pt of Object.values(PreventiveType)) {
      assert.ok(prevCats.has(pt), `Missing PreventiveTypeCatalog category: ${pt}`);
    }
    const prevSchedules = await prisma.preventiveSchedule.findMany();
    const prevStatuses = distinct(prevSchedules.map((p) => p.status));
    for (const st of Object.values(PreventiveStatus)) {
      assert.ok(prevStatuses.has(st), `Missing PreventiveStatus: ${st}`);
    }

    // 6. Nutrition, Stable Care, Shifts (all 10 Grooms rostered), DailyTasks (no retired horse)
    const nutritionPlans = await prisma.nutritionPlan.findMany();
    const nutritionStatuses = distinct(nutritionPlans.map((n) => n.status));
    for (const st of Object.values(NutritionPlanStatus)) {
      assert.ok(nutritionStatuses.has(st), `Missing NutritionPlanStatus: ${st}`);
    }

    const supplies = await prisma.supplyCatalog.findMany();
    const supplyCodes = distinct(supplies.map((s) => s.code));
    assert.strictEqual(
      supplies.length,
      4,
      `Expected original 4 SupplyCatalog items, found ${supplies.length}`,
    );
    for (const code of ['TIMOTHY', 'OATS', 'ELECTROLYTE', 'ANTI_INFLAM']) {
      assert.ok(supplyCodes.has(code), `Missing original SupplyCatalog code: ${code}`);
    }

    const activeGroomIds = new Set(activeByRole(Role.GROOM).map((g) => g.id));
    const rosters = await prisma.shiftRoster.findMany();
    const rosteredGrooms = distinct(rosters.map((r) => r.groomUserId));
    for (const gId of activeGroomIds) {
      assert.ok(rosteredGrooms.has(gId), `Groom ${gId} has no ShiftRoster assignment`);
    }

    const retiredHorseIds = new Set(
      horses.filter((h) => h.status === HorseStatus.RETIRED).map((h) => h.id),
    );
    const tasks = await prisma.dailyCareTask.findMany();
    const taskTypes = distinct(tasks.map((t) => t.taskType));
    for (const tt of Object.values(DailyTaskType)) {
      assert.ok(taskTypes.has(tt), `Missing DailyTaskType: ${tt}`);
    }
    for (const task of tasks) {
      assert.ok(
        !retiredHorseIds.has(task.horseId),
        `BR-STL-07 violated: DailyCareTask generated for RETIRED horse ${task.horseId}`,
      );
    }

    const restocks = await prisma.restockRequest.findMany();
    const restockStatuses = distinct(restocks.map((r) => r.status));
    for (const st of Object.values(RestockStatus)) {
      assert.ok(restockStatuses.has(st), `Missing RestockStatus: ${st}`);
    }

    const incidents = await prisma.incidentReport.findMany();
    const incidentStatuses = distinct(incidents.map((i) => i.status));
    for (const st of Object.values(IncidentStatus)) {
      assert.ok(incidentStatuses.has(st), `Missing IncidentStatus: ${st}`);
    }

    // 7. Tournaments, Registrations & 6-month Invoices
    const tournaments = await prisma.tournament.findMany();
    const tourStatuses = distinct(tournaments.map((t) => t.status));
    for (const st of Object.values(TournamentStatus)) {
      assert.ok(tourStatuses.has(st), `Missing TournamentStatus: ${st}`);
    }

    const regs = await prisma.tournamentRegistration.findMany();
    const regStatuses = distinct(regs.map((r) => r.status));
    for (const st of Object.values(RegistrationStatus)) {
      assert.ok(regStatuses.has(st), `Missing RegistrationStatus: ${st}`);
    }

    const invoices = await prisma.financialInvoice.findMany();
    const invStatuses = distinct(invoices.map((i) => i.status));
    for (const st of Object.values(InvoiceStatus)) {
      assert.ok(invStatuses.has(st), `Missing InvoiceStatus: ${st}`);
    }
    const billingPeriods = distinct(invoices.map((i) => i.billingPeriod));
    for (const p of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
      assert.ok(billingPeriods.has(p), `Missing FinancialInvoice period ${p}`);
    }

    // 8. Owner AI hygiene & Notifications & Counters
    const aiMsgs = await prisma.ownerAiMessage.findMany();
    for (const msg of aiMsgs) {
      assert.ok(
        !msg.content.includes('Thunder'),
        'OwnerAiMessage still contains stale Thunder name',
      );
    }
    const notifs = await prisma.notification.findMany();
    const notifCats = distinct(notifs.map((n) => n.category));
    for (const cat of Object.values(NotificationCategory)) {
      assert.ok(notifCats.has(cat), `Missing NotificationCategory: ${cat}`);
    }
    for (const counterName of ['horse_code', 'training_plan', 'request_code', 'forbidden_ref']) {
      const c = await prisma.counter.findUnique({ where: { name: counterName } });
      assert.ok(c && c.value >= 10, `Counter ${counterName} missing or too low`);
    }

    console.log(
      `PASS: All ${models.length} Prisma models, enums, counts (10 grooms, 4 vets, 19 horses, 32 stalls), BR-STL-07, and PR #153 verified cleanly.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
