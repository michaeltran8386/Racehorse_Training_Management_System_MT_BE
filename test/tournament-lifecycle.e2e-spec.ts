import { createHash } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Role,
  HorseStatus,
  RegistrationStatus,
  TournamentStatus,
  TrackSurface,
} from '@prisma/client';

function normalizeHost(host: string): string {
  return (host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function validateVerifyTarget(dbUrl: string, directUrl: string): void {
  if (!dbUrl || !dbUrl.trim() || !directUrl || !directUrl.trim()) {
    throw new Error(
      'SAFETY GATE REJECTED: DATABASE_URL and DIRECT_URL are required and non-empty.',
    );
  }

  let dbParsed: URL;
  let directParsed: URL;
  try {
    dbParsed = new URL(dbUrl.trim());
    directParsed = new URL(directUrl.trim());
  } catch (err: any) {
    throw new Error(`SAFETY GATE REJECTED: Malformed database URL: ${err.message}`);
  }

  const validProtocols = ['postgresql:', 'postgres:'];
  if (
    !validProtocols.includes(dbParsed.protocol.toLowerCase()) ||
    !validProtocols.includes(directParsed.protocol.toLowerCase())
  ) {
    throw new Error('SAFETY GATE REJECTED: Both URLs must use postgresql: protocol.');
  }

  const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
  const dbHost = normalizeHost(dbParsed.hostname);
  const directHost = normalizeHost(directParsed.hostname);

  if (!LOCAL_HOSTNAMES.has(dbHost) || !LOCAL_HOSTNAMES.has(directHost)) {
    throw new Error(
      'SAFETY GATE REJECTED: Remote database hosts are forbidden. Must target localhost / 127.0.0.1.',
    );
  }

  if (dbHost !== directHost) {
    throw new Error('SAFETY GATE REJECTED: Host mismatch between DATABASE_URL and DIRECT_URL.');
  }

  const dbPort = dbParsed.port || '5432';
  const directPort = directParsed.port || '5432';
  if (dbPort !== directPort) {
    throw new Error('SAFETY GATE REJECTED: Port mismatch between DATABASE_URL and DIRECT_URL.');
  }

  const TARGET_DB = 'equiflow_task019_migrations_verify';
  const dbName = (dbParsed.pathname || '').replace(/^\//, '').trim();
  const directDbName = (directParsed.pathname || '').replace(/^\//, '').trim();

  if (dbName !== TARGET_DB || directDbName !== TARGET_DB) {
    throw new Error(
      `SAFETY GATE REJECTED: Target database must be strictly '${TARGET_DB}'. Refusing execution on '${dbName}'.`,
    );
  }

  const dbSchema = dbParsed.searchParams.get('schema') || 'public';
  const directSchema = directParsed.searchParams.get('schema') || 'public';
  if (dbSchema !== directSchema) {
    throw new Error('SAFETY GATE REJECTED: Schema mismatch between DATABASE_URL and DIRECT_URL.');
  }
}

describe('Real-Stack Tournament Lifecycle Automated Verification (CR-028)', () => {
  let baselineHash: string;
  async function coreBaselineHash() {
    const rows = await Promise.all([
      prisma.tournament.findMany({ orderBy: { id: 'asc' } }),
      prisma.horse.findMany({ orderBy: { id: 'asc' } }),
      prisma.financialInvoice.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  let app: INestApplication;
  let prisma: PrismaService;

  // Track all created IDs for deterministic, FK-safe cleanup
  const createdIds = {
    userIds: new Set<string>(),
    horseIds: new Set<string>(),
    tournamentIds: new Set<string>(),
    registrationIds: new Set<string>(),
    resultIds: new Set<string>(),
    invoiceIds: new Set<string>(),
  };

  let managerToken: string;
  let trainerToken: string;

  const sentinel = `cr028-${Date.now()}`;
  let ownerUserId: string;
  let horseAId: string;
  let horseBId: string;
  let tournamentId: string;
  let regAId: string;
  let regBId: string;

  beforeAll(async () => {
    // 1. Target Database Safety Check with strict parsing and zero secret logging
    validateVerifyTarget(process.env.DATABASE_URL || '', process.env.DIRECT_URL || '');

    // 2. Initialize NestJS application with production AppModule and real PrismaService
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // 3. Authenticate Club Manager and Head Trainer via real HTTP login endpoint
    const managerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'manager@gmail.com', password: 'EquiFlow@2026' });
    expect(managerLogin.status).toBe(200);
    managerToken =
      managerLogin.body.data?.token ||
      managerLogin.body.token ||
      managerLogin.body.data?.accessToken;
    expect(managerToken).toBeDefined();

    const trainerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'trainer@gmail.com', password: 'EquiFlow@2026' });
    expect(trainerLogin.status).toBe(200);
    trainerToken =
      trainerLogin.body.data?.token ||
      trainerLogin.body.token ||
      trainerLogin.body.data?.accessToken;
    expect(trainerToken).toBeDefined();

    baselineHash = await coreBaselineHash();

    // 4. Create isolated named test fixtures in live PostgreSQL
    // Dedicated Owner User
    const ownerUser = await prisma.user.create({
      data: {
        email: `owner-${sentinel}@equiflow.test`,
        passwordHash: '$2b$10$hashedpasswordfore2etestpurposesonly123',
        fullName: `Owner ${sentinel}`,
        role: Role.HORSE_OWNER,
      },
    });
    ownerUserId = ownerUser.id;
    createdIds.userIds.add(ownerUserId);

    // Dedicated Horse A (Competing, will finish 1st)
    const horseA = await prisma.horse.create({
      data: {
        name: `Horse A ${sentinel}`,
        horseCode: `HA-${sentinel.slice(-6)}`,
        microchipRfid: `RFID-A-${sentinel.slice(-8)}`,
        breed: 'Thoroughbred',
        dob: new Date('2020-05-15'),
        gender: 'STALLION',
        color: 'BAY',
        ownerId: ownerUserId,
        status: HorseStatus.ACTIVE,
        isMedicalLocked: false,
      },
    });
    horseAId = horseA.id;
    createdIds.horseIds.add(horseAId);

    // Dedicated Horse B (Will be scratched with medical reason)
    const horseB = await prisma.horse.create({
      data: {
        name: `Horse B ${sentinel}`,
        horseCode: `HB-${sentinel.slice(-6)}`,
        microchipRfid: `RFID-B-${sentinel.slice(-8)}`,
        breed: 'Thoroughbred',
        dob: new Date('2021-03-20'),
        gender: 'MARE',
        color: 'CHESTNUT',
        ownerId: ownerUserId,
        status: HorseStatus.ACTIVE,
        isMedicalLocked: false,
      },
    });
    horseBId = horseB.id;
    createdIds.horseIds.add(horseBId);

    // Create Tournament with valid unexpired registration deadline
    // Race date is scheduled in the future during registration phase
    const futureDeadline = new Date(Date.now() + 3600 * 1000); // 1 hour from now
    const futureRaceDate = new Date(Date.now() + 7200 * 1000); // 2 hours from now

    const tournRes = await request(app.getHttpServer())
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: `Tourn ${sentinel}`,
        location: 'Phu Tho Test Track',
        distanceMeters: 1600,
        trackType: TrackSurface.TURF,
        prizePool: 10000000,
        registrationDeadline: futureDeadline.toISOString(),
        raceDate: futureRaceDate.toISOString(),
        status: TournamentStatus.OPEN_REGISTRATION,
      });

    expect(tournRes.status).toBe(201);
    tournamentId = tournRes.body.data?.id || tournRes.body.id;
    expect(tournamentId).toBeDefined();
    createdIds.tournamentIds.add(tournamentId);
  }, 30000);

  afterAll(async () => {
    // Deterministic FK-safe cleanup of exclusively created test records
    let cleanupError: any = null;
    if (prisma) {
      try {
        // 1. Delete Tournament Results
        if (createdIds.registrationIds.size > 0) {
          await prisma.tournamentResult.deleteMany({
            where: { registrationId: { in: Array.from(createdIds.registrationIds) } },
          });
        }

        // 2. Delete Invoices
        if (createdIds.userIds.size > 0) {
          await prisma.financialInvoice.deleteMany({
            where: { ownerId: { in: Array.from(createdIds.userIds) } },
          });
        }

        // 3. Delete Audit Logs & Notifications linked to created records
        if (createdIds.tournamentIds.size > 0) {
          await prisma.auditLog.deleteMany({
            where: { entityId: { in: Array.from(createdIds.tournamentIds) } },
          });
        }
        if (createdIds.registrationIds.size > 0) {
          await prisma.auditLog.deleteMany({
            where: { entityId: { in: Array.from(createdIds.registrationIds) } },
          });
        }

        // Notifications are emitted after the transaction; remove only messages linked to our tournaments.
        await prisma.notification.deleteMany({
          where: { link: { in: [...createdIds.tournamentIds].map((id) => '/races/' + id) } },
        });
        // Completion notifications use a generic link, so correlate by our unique tournament names.
        await prisma.notification.deleteMany({ where: { message: { contains: sentinel } } });
        // 4. Delete Tournament Registrations
        if (createdIds.tournamentIds.size > 0) {
          await prisma.tournamentRegistration.deleteMany({
            where: { tournamentId: { in: Array.from(createdIds.tournamentIds) } },
          });
        }

        // 5. Delete Tournaments
        if (createdIds.tournamentIds.size > 0) {
          await prisma.tournament.deleteMany({
            where: { id: { in: Array.from(createdIds.tournamentIds) } },
          });
        }

        // 6. Delete Horses
        if (createdIds.horseIds.size > 0) {
          await prisma.horse.deleteMany({
            where: { id: { in: Array.from(createdIds.horseIds) } },
          });
        }

        // 7. Delete Users
        if (createdIds.userIds.size > 0) {
          await prisma.user.deleteMany({
            where: { id: { in: Array.from(createdIds.userIds) } },
          });
        }
        expect(await prisma.horse.count({ where: { id: { in: [...createdIds.horseIds] } } })).toBe(
          0,
        );
        expect(
          await prisma.tournament.count({ where: { id: { in: [...createdIds.tournamentIds] } } }),
        ).toBe(0);
        expect(await prisma.financialInvoice.count({ where: { ownerId: ownerUserId } })).toBe(0);
        expect(await coreBaselineHash()).toBe(baselineHash);
      } catch (err: any) {
        cleanupError = err;
      } finally {
        await prisma.$disconnect();
      }
    }

    if (app) {
      await app.close();
    }

    if (cleanupError) {
      throw cleanupError;
    }
  });

  it('Step 1: Head Trainer registers Horse A and Horse B via real HTTP', async () => {
    // Register Horse A
    const resA = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/registrations`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ horseId: horseAId, notes: 'Horse A initial entry' });

    expect(resA.status).toBe(201);
    regAId = resA.body.data?.id || resA.body.id;
    expect(regAId).toBeDefined();
    createdIds.registrationIds.add(regAId);

    // Register Horse B
    const resB = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/registrations`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ horseId: horseBId, notes: 'Horse B entry' });

    expect(resB.status).toBe(201);
    regBId = resB.body.data?.id || resB.body.id;
    expect(regBId).toBeDefined();
    createdIds.registrationIds.add(regBId);

    // Verify registrations exist in PostgreSQL with REGISTERED status
    const regs = await prisma.tournamentRegistration.findMany({
      where: { tournamentId },
    });
    expect(regs).toHaveLength(2);
    expect(regs.every((r) => r.status === RegistrationStatus.REGISTERED)).toBe(true);
  });

  it('Step 2: Validates mandatory scratch reason and excludes scratched horse from results', async () => {
    // Attempt scratch without reason -> Must fail with HTTP 400 REASON_REQUIRED
    const failScratch = await request(app.getHttpServer())
      .delete(`/api/tournaments/${tournamentId}/registrations/${regBId}`)
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(failScratch.status).toBe(400);

    // Scratch with explicit medical reason -> Must succeed with HTTP 200
    const scratchReason = 'Acute tendon strain observed during morning warm-up';
    const scratchRes = await request(app.getHttpServer())
      .delete(
        `/api/tournaments/${tournamentId}/registrations/${regBId}?reason=${encodeURIComponent(scratchReason)}`,
      )
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(scratchRes.status).toBe(200);

    // Verify registration status in PostgreSQL updated to SCRATCHED_MEDICAL
    const scratchedReg = await prisma.tournamentRegistration.findUnique({
      where: { id: regBId },
    });
    expect(scratchedReg?.status).toBe(RegistrationStatus.SCRATCHED_MEDICAL);
    expect(scratchedReg?.notes).toContain(`Scratched: ${scratchReason}`);

    // Verify attempting to record race results for scratched horse fails with HTTP 400 CANNOT_RECORD_RESULT
    // (First transition to CLOSED_REGISTRATION to test result validation)
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600 * 1000), // past race date
      },
    });

    const rejectScratchedResult = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/results`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        lockResults: false,
        results: [
          {
            registrationId: regBId,
            finalRank: 2,
            finishTimeSeconds: 100.5,
          },
        ],
      });

    expect(rejectScratchedResult.status).toBe(400);
    expect(JSON.stringify(rejectScratchedResult.body)).toContain('CANNOT_RECORD_RESULT');
  });

  it('Step 3: Draft race results record finish data but make NO financial credit', async () => {
    // Record draft results for competing Horse A (lockResults = false)
    const draftRes = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/results`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        lockResults: false,
        results: [
          {
            registrationId: regAId,
            finalRank: 1,
            finishTimeSeconds: 96.42,
            prizeMoneyWon: 5000000,
            officialNotes: 'Dominant lead from start to finish',
          },
        ],
      });

    expect(draftRes.status).toBe(201);

    // Verify tournament remains in CLOSED_REGISTRATION state
    const tourn = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    expect(tourn?.status).toBe(TournamentStatus.CLOSED_REGISTRATION);

    // Verify result record exists in PostgreSQL
    const resultRow = await prisma.tournamentResult.findUnique({
      where: { registrationId: regAId },
    });
    expect(resultRow).toBeDefined();
    expect(Number(resultRow?.prizeMoneyWon)).toBe(5000000);

    // CRITICAL: Verify NO financial invoice was generated for owner under draft status
    const invoices = await prisma.financialInvoice.findMany({
      where: { ownerId: ownerUserId },
    });
    expect(invoices).toHaveLength(0);
  });

  it('Step 4: Concurrent lock requests on uncompleted tournament produce exactly one terminal transition and one 70% prize credit', async () => {
    // Fire TWO concurrent lock requests while tournament is NOT COMPLETED
    const [lockResA, lockResB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/tournaments/${tournamentId}/lock-results`)
        .set('Authorization', `Bearer ${managerToken}`),
      request(app.getHttpServer())
        .post(`/api/tournaments/${tournamentId}/lock-results`)
        .set('Authorization', `Bearer ${managerToken}`),
    ]);

    // Exactly one concurrent call must succeed (201) and the other must fail closed (400)
    const statuses = [lockResA.status, lockResB.status].sort();
    expect(statuses).toEqual([201, 400]);

    const losingBody = lockResA.status === 400 ? lockResA.body : lockResB.body;
    expect(JSON.stringify(losingBody)).toContain('ALREADY_COMPLETED');

    // 1. Verify tournament transitions to COMPLETED
    const completedTourn = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    expect(completedTourn?.status).toBe(TournamentStatus.COMPLETED);

    // 2. Verify competing Horse A transitions to RESTING
    const horseAAfter = await prisma.horse.findUnique({
      where: { id: horseAId },
    });
    expect(horseAAfter?.status).toBe(HorseStatus.RESTING);

    // 3. Verify scratched Horse B remains ACTIVE (was not competing)
    const horseBAfter = await prisma.horse.findUnique({
      where: { id: horseBId },
    });
    expect(horseBAfter?.status).toBe(HorseStatus.ACTIVE);

    // 4. Verify Financial Invoice created with exact Math.round(prizeMoneyWon * 0.7)
    // prizeMoneyWon = 5,000,000 -> 70% owner share = 3,500,000
    const expectedOwnerShare = Math.round(5000000 * 0.7); // 3500000
    const ownerInvoice = await prisma.financialInvoice.findFirst({
      where: { ownerId: ownerUserId, horseId: horseAId },
    });

    expect(ownerInvoice).toBeDefined();
    expect(Number(ownerInvoice?.prizeCredit)).toBe(expectedOwnerShare);
    expect(Number(ownerInvoice?.netAmount)).toBe(-expectedOwnerShare);
    expect(ownerInvoice?.status).toBe('DRAFT');
  });

  it('Step 5: Anti-Double Credit Proof — repeat lock calls on COMPLETED tournament fail closed and do NOT duplicate credit', async () => {
    // Repeat lock call on already COMPLETED tournament -> Must fail with HTTP 400 ALREADY_COMPLETED
    const repeatLock = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/lock-results`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(repeatLock.status).toBe(400);
    expect(JSON.stringify(repeatLock.body)).toContain('ALREADY_COMPLETED');

    // Also verify via batch results with lockResults: true -> Must fail with HTTP 400 ALREADY_LOCKED
    const repeatBatchLock = await request(app.getHttpServer())
      .post(`/api/tournaments/${tournamentId}/results`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        lockResults: true,
        results: [
          {
            registrationId: regAId,
            finalRank: 1,
            finishTimeSeconds: 96.42,
            prizeMoneyWon: 5000000,
          },
        ],
      });

    expect(repeatBatchLock.status).toBe(400);
    expect(JSON.stringify(repeatBatchLock.body)).toContain('ALREADY_LOCKED');

    // CRITICAL: Query live PostgreSQL directly to prove prizeCredit was NOT duplicated
    const invoices = await prisma.financialInvoice.findMany({
      where: { ownerId: ownerUserId, horseId: horseAId },
    });

    expect(invoices).toHaveLength(1);
    const invoice = invoices[0];
    expect(Number(invoice.prizeCredit)).toBe(3500000); // Strictly 3.5M, NOT 7M or 10.5M
    expect(Number(invoice.netAmount)).toBe(-3500000);
  });
  async function createClosedFixture(prize = 5000000) {
    const key = String(Date.now()) + '-' + createdIds.horseIds.size;
    const horse = await prisma.horse.create({
      data: {
        name: 'QA CR029 ' + sentinel + key,
        horseCode: 'CR029-' + key,
        microchipRfid: 'CR029-' + key,
        breed: 'Thoroughbred',
        dob: new Date('2020-01-01'),
        gender: 'STALLION',
        color: 'BAY',
        ownerId: ownerUserId,
        status: HorseStatus.IN_TRAINING,
      },
    });
    createdIds.horseIds.add(horse.id);
    const tournament = await prisma.tournament.create({
      data: {
        name: 'QA CR029 ' + sentinel + key,
        location: 'QA Track',
        distanceMeters: 1600,
        trackType: TrackSurface.TURF,
        prizePool: prize,
        raceDate: new Date(Date.now() - 3600000),
        registrationDeadline: new Date(Date.now() - 7200000),
        status: TournamentStatus.CLOSED_REGISTRATION,
      },
    });
    createdIds.tournamentIds.add(tournament.id);
    const trainer = await prisma.user.findUniqueOrThrow({ where: { email: 'trainer@gmail.com' } });
    const registration = await prisma.tournamentRegistration.create({
      data: {
        tournamentId: tournament.id,
        horseId: horse.id,
        registeredByTrainerId: trainer.id,
      },
    });
    createdIds.registrationIds.add(registration.id);
    await prisma.tournamentResult.create({
      data: {
        registrationId: registration.id,
        finalRank: 1,
        finishTimeSeconds: 100,
        avgSpeedKmh: 57.6,
        prizeMoneyWon: prize,
        officialNotes: 'original',
      },
    });
    return { horse, tournament, registration };
  }

  it.each(['combined', 'mixed'] as const)(
    'serializes %s finalizers without losing-result overwrite',
    async (mode) => {
      const { horse, tournament, registration } = await createClosedFixture();
      const combined = (notes: string) =>
        request(app.getHttpServer())
          .post('/api/tournaments/' + tournament.id + '/results')
          .set('Authorization', 'Bearer ' + managerToken)
          .send({
            lockResults: true,
            results: [
              {
                registrationId: registration.id,
                finalRank: 1,
                finishTimeSeconds: 99,
                prizeMoneyWon: 5000000,
                officialNotes: notes,
              },
            ],
          });
      const first =
        mode === 'mixed'
          ? request(app.getHttpServer())
              .post('/api/tournaments/' + tournament.id + '/lock-results')
              .set('Authorization', 'Bearer ' + managerToken)
          : combined('winner-a');
      const responses = await Promise.all([first, combined('winner-b')]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      const result = await prisma.tournamentResult.findUniqueOrThrow({
        where: { registrationId: registration.id },
      });
      expect(result.officialNotes).toBe(
        responses[0].status === 201 ? (mode === 'mixed' ? 'original' : 'winner-a') : 'winner-b',
      );
      const invoices = await prisma.financialInvoice.findMany({ where: { horseId: horse.id } });
      expect(invoices).toHaveLength(1);
      expect(Number(invoices[0].prizeCredit)).toBe(3500000);
      expect(Number(invoices[0].netAmount)).toBe(-3500000);
      expect((await prisma.horse.findUniqueOrThrow({ where: { id: horse.id } })).status).toBe(
        HorseStatus.RESTING,
      );
      const lateDraft = await request(app.getHttpServer())
        .post('/api/tournaments/' + tournament.id + '/results')
        .set('Authorization', 'Bearer ' + managerToken)
        .send({
          lockResults: false,
          results: [{ registrationId: registration.id, finalRank: 2, finishTimeSeconds: 101 }],
        });
      expect(lateDraft.status).toBe(400);
      expect(
        (
          await prisma.tournamentResult.findUniqueOrThrow({
            where: { registrationId: registration.id },
          })
        ).officialNotes,
      ).toBe(result.officialNotes);
    },
  );

  it('rolls back results, horse status and terminal status if financial credit fails', async () => {
    const { horse, tournament, registration } = await createClosedFixture();
    const result = await prisma.tournamentResult.findUniqueOrThrow({
      where: { registrationId: registration.id },
    });
    // Fits result Decimal(12,2), exceeds invoice Decimal(10,2); real PostgreSQL rejects the credit.
    const res = await request(app.getHttpServer())
      .post('/api/tournaments/' + tournament.id + '/results')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({
        lockResults: true,
        results: [
          {
            registrationId: registration.id,
            finalRank: 2,
            finishTimeSeconds: 110,
            prizeMoneyWon: 200000000,
            officialNotes: 'must rollback',
          },
        ],
      });
    expect(res.status).toBe(500);
    expect(
      await prisma.tournamentResult.findUniqueOrThrow({
        where: { registrationId: registration.id },
      }),
    ).toEqual(result);
    expect(
      (await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).status,
    ).toBe(TournamentStatus.CLOSED_REGISTRATION);
    expect((await prisma.horse.findUniqueOrThrow({ where: { id: horse.id } })).status).toBe(
      HorseStatus.IN_TRAINING,
    );
    expect(await prisma.financialInvoice.count({ where: { horseId: horse.id } })).toBe(0);
  });
});
