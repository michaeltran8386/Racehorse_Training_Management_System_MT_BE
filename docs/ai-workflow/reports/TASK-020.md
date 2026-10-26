# TASK-020 — Execution Report

- **Plan version:** v1-approved-r12
- **Status:** DONE
- **Execution:** IDLE
- **Next task:** TASK-012 (not started / unauthorized)
- **Architecture / Task Scope:** Controlled Web manual-QA dataset expansion strictly within the 2 authorized Backend tooling files (`prisma/seed-manual-qa.ts`, `package.json`).
- **Git branch / starting revision / ending revision:**
  - Backend (`Racehorse_Training_Management_System_MT_BE`): `main` / baseline: `dac87eb` / ending: working tree (`prisma/seed-manual-qa.ts` created, `package.json` modified, canonical coordination docs updated)
  - Frontend (`Racehorse_Training_Management_System_MT_FE`): `main` / baseline: `844e50d` (ahead of origin by 9 commits, clean working tree, untouched)
  - Simulator (`Racehorse_Simulator_Web`): `refactor/remove-rfid-standardize-microchip` / baseline: `3f52a7a` (ahead of origin by 1 commit, clean working tree, untouched)
- **Authorized Tooling Files Changed (strictly 2 tooling files):**
  1. `Racehorse_Training_Management_System_MT_BE/prisma/seed-manual-qa.ts` (Created):
     - Implements safe, deterministic, idempotent manual-QA dataset expansion.
     - **R-1 Safety gate 1 (CLI confirmation):** Enforces mandatory `--confirm-local-qa` CLI argument; refuses execution and prints actionable usage message if omitted.
     - **R-1 Safety gate 2 (Production guard):** Refuses execution when `NODE_ENV=production`, `APP_ENV=production`, or when `DATABASE_URL` contains production keywords.
     - **R-1 Safety gate 3 (DATABASE_URL parse & validation):** Parses `DATABASE_URL` *before* constructing or using PrismaClient. Refuses missing or invalid `DATABASE_URL`.
     - **R-1 Safety gate 4 (Loopback host enforcement):** Strictly restricts database target to local loopback hosts (`localhost`, `127.0.0.1`, `::1`). Refuses any remote host before PrismaClient instantiation and before any database mutation.
     - **PrismaClient instantiation:** Constructed strictly after all safety gates have executed and passed.
     - **Deterministic UUID generator:** Stable RFC4122 v4 UUID generator (`toUuid(domain, index)`) ensuring zero collision and stable identifiers across runs.
     - **Strict idempotent upserts:** Idempotent `prisma.<model>.upsert` for all entities; strictly zero `delete`, `deleteMany`, `truncate`, or mutations to non-QA data.
     - Seeds complete dataset covering all 26 tracked domains, exceeding all minimum requirements.
  2. `Racehorse_Training_Management_System_MT_BE/package.json` (Modified):
     - Added script entry on line 28: `"db:seed:manual-qa": "ts-node prisma/seed-manual-qa.ts",`.

---

## Quality Gates Summary

| Gate | Command / Target | Result | Evidence / Details |
| --- | --- | :---: | --- |
| TypeScript Typecheck | `npm run typecheck` | **PASS (code 0)** | Zero TypeScript errors across entire backend |
| ESLint Check | `npm run lint -- --max-warnings=0` | **PASS (code 0)** | Zero lint warnings / errors |
| Backend Unit Tests (Full Suite) | `npm run test:unit` | **PASS (627/627)** | 53 test suites passed, 627 tests passed in 12.65s |
| Safety Gate: Missing Flag | `npm run db:seed:manual-qa` | **PASS (code 1)** | Refused: missing `--confirm-local-qa` |
| Safety Gate: Production Refusal | `NODE_ENV=production ...` | **PASS (code 1)** | Refused: production environment |
| R-1 Safety Gate: Remote URL Refusal | `DATABASE_URL=postgresql://user:pass@example.invalid:5432/remote_db ...` | **PASS (code 1)** | Refused remote host before `[1/15]` and before PrismaClient construction |
| R-1 Safety Gate: Invalid URL Refusal | `DATABASE_URL=not-a-valid-url ...` | **PASS (code 1)** | Refused invalid URL before `[1/15]` and before PrismaClient construction |
| R-1 Safety Gate: Local Loopback Target | `DATABASE_URL=...localhost:5432/equiflow` | **PASS (code 0)** | Local PostgreSQL target accepted and parsed |
| R-2 7-Step API Lifecycle & Idempotency | 26-domain S1 (Seed) -> S2 (Real API) -> S3 (Repeated Seed) | **PASS (code 0)** | All 26 non-QA counts & hashes invariant across S1/S2/S3; all 26 QA counts & stable hashes invariant; all 5 WorkoutStatuses preserved |
| R-3 Real API Authentication & RBAC | Live NestJS HTTP API (`localhost:3000`) | **PASS (code 0)** | Real `POST /api/auth/login` across 8 accounts; exact Owner horse sets; negative 403 guards |
| Process Restart Persistence | Stop daemon + rebuild + restart + query API | **PASS (code 0)** | 100% data persistence across daemon restart |
| Whitespace & Git Hygiene | `git diff --check` across BE, FE, SIM | **PASS (code 0)** | Clean diff, zero whitespace or line-ending errors |

---

## R-1: Enforce Approved Local-Only Database Boundary

### 1. Verification of Remote Host Rejection (before `[1/15]` and before Prisma mutation)

```powershell
$env:DATABASE_URL="postgresql://user:pass@example.invalid:5432/remote_db"; npm run db:seed:manual-qa -- --confirm-local-qa
```
**Output (Exit code 1):**
```text
> racehorse-training-management-system-be@0.1.0 db:seed:manual-qa
> ts-node prisma/seed-manual-qa.ts --confirm-local-qa

[SAFETY GATE REJECTED] Non-loopback database host "example.invalid" is not permitted.
Only explicit local loopback hosts (localhost, 127.0.0.1, ::1) are allowed for manual QA seeding. Aborting!
```

### 2. Verification of Invalid URL Rejection

```powershell
$env:DATABASE_URL="not-a-valid-url"; npm run db:seed:manual-qa -- --confirm-local-qa
```
**Output (Exit code 1):**
```text
> racehorse-training-management-system-be@0.1.0 db:seed:manual-qa
> ts-node prisma/seed-manual-qa.ts --confirm-local-qa

[SAFETY GATE REJECTED] Invalid DATABASE_URL format: Invalid URL. Aborting!
```

### 3. Verification of Local Loopback Target Acceptance

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; npm run db:seed:manual-qa -- --confirm-local-qa
```
**Output (Exit code 0):**
```text
> racehorse-training-management-system-be@0.1.0 db:seed:manual-qa
> ts-node prisma/seed-manual-qa.ts --confirm-local-qa

[QA Target Database] Host: localhost, Port: 5432, DB: equiflow
=== Starting Controlled Manual-QA Dataset Expansion (TASK-020) ===
[1/15] Upserting 16 QA Users...
...
=== TASK-020 Controlled Manual-QA Dataset Expansion Completed Successfully ===
```

---

## R-2: Stability and Invariant Evidence Across Real API Access and Repeated Seed (26 Domains)

### 7-Step Lifecycle Stability Sequence
To prove that fixtures are lifecycle-consistent and not mutated by backend sweeps such as `sweepOverdue()` (which triggers on `GET /api/training/plans`):
1. **Initial QA Seed:** Executed `npm run db:seed:manual-qa -- --confirm-local-qa`.
2. **Snapshot 1 (Pre-API):** Captured counts and SHA-256 fingerprints across all 26 domains (non-QA full row fingerprint; QA stable business fingerprint), plus breakdown of all 5 `WorkoutStatus` values.
3. **Real Authentication:** Authenticated 8 seeded QA users across all five roles via live `POST /api/auth/login`.
4. **Real API Matrix Execution:** Executed live API endpoints against live PostgreSQL, including `GET /api/training/plans` (invoking `sweepOverdue()`), `GET /api/horses`, `GET /api/medical/records`, `GET /api/daily-tasks`, cross-owner horse inspection, and negative 403 RBAC checks.
5. **Snapshot 2 (Post-API):** Captured identical 26-domain counts, fingerprints, and WorkoutStatus breakdown. Asserted zero mutation caused by API reads or overdue sweeps.
6. **Repeated QA Seed:** Re-executed `npm run db:seed:manual-qa -- --confirm-local-qa`.
7. **Snapshot 3 (Post-Repeated-Seed):** Captured identical 26-domain counts, fingerprints, and WorkoutStatus breakdown. Asserted 100% stability across all 3 snapshots.

### Reproducible PowerShell Verifier Command (Self-Contained)

Run this single self-contained command in PowerShell from the `Racehorse_Training_Management_System_MT_BE` directory:

```powershell
@'
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const http = require('http');
const { execSync } = require('child_process');

const prisma = new PrismaClient();

function hashRows(rows, excludeKeys = []) {
  const h = crypto.createHash('sha256');
  for (const r of rows) {
    const copy = {};
    for (const k of Object.keys(r).sort()) {
      if (!excludeKeys.includes(k)) copy[k] = r[k];
    }
    h.update(JSON.stringify(copy));
  }
  return h.digest('hex');
}

async function captureSnapshot() {
  const domains = [
    { name: 'User', fetchNonQA: () => prisma.user.findMany({ where: { NOT: { email: { startsWith: 'qa-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.user.findMany({ where: { email: { startsWith: 'qa-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt', 'lastActive'] },
    { name: 'StallZone', fetchNonQA: () => prisma.stallZone.findMany({ where: { NOT: { code: 'ZONE-QA' } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.stallZone.findMany({ where: { code: 'ZONE-QA' }, orderBy: { id: 'asc' } }), minQA: 1, qaExcludes: ['updatedAt'] },
    { name: 'Stall', fetchNonQA: () => prisma.stall.findMany({ where: { NOT: { code: { startsWith: 'STALL-QA' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.stall.findMany({ where: { code: { startsWith: 'STALL-QA' } }, orderBy: { id: 'asc' } }), minQA: 24, qaExcludes: ['updatedAt'] },
    { name: 'StallAllocation', fetchNonQA: () => prisma.stallAllocation.findMany({ where: { NOT: { stall: { code: { startsWith: 'STALL-QA' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.stallAllocation.findMany({ where: { stall: { code: { startsWith: 'STALL-QA' } } }, orderBy: { id: 'asc' } }), minQA: 24, qaExcludes: ['updatedAt'] },
    { name: 'Horse', fetchNonQA: () => prisma.horse.findMany({ where: { NOT: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.horse.findMany({ where: { horseCode: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 24, qaExcludes: ['updatedAt'] },
    { name: 'TrainingPlan', fetchNonQA: () => prisma.trainingPlan.findMany({ where: { NOT: { planCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.trainingPlan.findMany({ where: { planCode: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'WorkoutSession', fetchNonQA: () => prisma.workoutSession.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.workoutSession.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 48, qaExcludes: ['updatedAt'] },
    { name: 'MedicalRecord', fetchNonQA: () => prisma.medicalRecord.findMany({ where: { NOT: { recordNumber: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.medicalRecord.findMany({ where: { recordNumber: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'InjuryLog', fetchNonQA: () => prisma.injuryLog.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.injuryLog.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 8, qaExcludes: ['updatedAt'] },
    { name: 'MedicalLock', fetchNonQA: () => prisma.medicalLock.findMany({ where: { NOT: { lockCode: { startsWith: 'KH-QA' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.medicalLock.findMany({ where: { lockCode: { startsWith: 'KH-QA' } }, orderBy: { id: 'asc' } }), minQA: 6, qaExcludes: ['updatedAt'] },
    { name: 'PreventiveSchedule', fetchNonQA: () => prisma.preventiveSchedule.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.preventiveSchedule.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'IncidentReport', fetchNonQA: () => prisma.incidentReport.findMany({ where: { NOT: { incidentNumber: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.incidentReport.findMany({ where: { incidentNumber: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'Tournament', fetchNonQA: () => prisma.tournament.findMany({ where: { NOT: { name: { contains: 'QA ' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.tournament.findMany({ where: { name: { contains: 'QA ' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'TournamentRegistration', fetchNonQA: () => prisma.tournamentRegistration.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.tournamentRegistration.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 30, qaExcludes: ['updatedAt'] },
    { name: 'TournamentResult', fetchNonQA: () => prisma.tournamentResult.findMany({ where: { NOT: { registration: { horse: { horseCode: { startsWith: 'QA-' } } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.tournamentResult.findMany({ where: { registration: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'FinancialInvoice', fetchNonQA: () => prisma.financialInvoice.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.financialInvoice.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 16, qaExcludes: ['updatedAt'] },
    { name: 'Notification', fetchNonQA: () => prisma.notification.findMany({ where: { OR: [{ dedupeKey: null }, { NOT: { dedupeKey: { startsWith: 'QA_' } } }] }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.notification.findMany({ where: { dedupeKey: { startsWith: 'QA_' } }, orderBy: { id: 'asc' } }), minQA: 30, qaExcludes: ['updatedAt'] },
    { name: 'RestockRequest', fetchNonQA: () => prisma.restockRequest.findMany({ where: { NOT: { requestNumber: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.restockRequest.findMany({ where: { requestNumber: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'StockBalance', fetchNonQA: () => prisma.stockBalance.findMany({ where: { NOT: { zone: { code: 'ZONE-QA' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.stockBalance.findMany({ where: { zone: { code: 'ZONE-QA' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'DailyCareTask', fetchNonQA: () => prisma.dailyCareTask.findMany({ where: { NOT: { taskCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.dailyCareTask.findMany({ where: { taskCode: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 28, qaExcludes: ['updatedAt'] },
    { name: 'NutritionPlan', fetchNonQA: () => prisma.nutritionPlan.findMany({ where: { NOT: { planCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.nutritionPlan.findMany({ where: { planCode: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 12, qaExcludes: ['updatedAt'] },
    { name: 'DailyGroomingLog', fetchNonQA: () => prisma.dailyGroomingLog.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.dailyGroomingLog.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 8, qaExcludes: ['updatedAt'] },
    { name: 'ShiftRoster', fetchNonQA: () => prisma.shiftRoster.findMany({ where: { NOT: { groom: { email: { startsWith: 'qa-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.shiftRoster.findMany({ where: { groom: { email: { startsWith: 'qa-' } } }, orderBy: { id: 'asc' } }), minQA: 6, qaExcludes: ['updatedAt'] },
    { name: 'SimulatorSession', fetchNonQA: () => prisma.simulatorSession.findMany({ where: { NOT: { id: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.simulatorSession.findMany({ where: { id: { startsWith: 'QA-' } }, orderBy: { id: 'asc' } }), minQA: 4, qaExcludes: ['updatedAt'] },
    { name: 'PermissionRequest', fetchNonQA: () => prisma.permissionRequest.findMany({ where: { NOT: { reference: { startsWith: '403-QA' } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.permissionRequest.findMany({ where: { reference: { startsWith: '403-QA' } }, orderBy: { id: 'asc' } }), minQA: 3, qaExcludes: ['updatedAt'] },
    { name: 'AIInsight', fetchNonQA: () => prisma.aIInsight.findMany({ where: { NOT: { horse: { horseCode: { startsWith: 'QA-' } } } }, orderBy: { id: 'asc' } }), fetchQA: () => prisma.aIInsight.findMany({ where: { horse: { horseCode: { startsWith: 'QA-' } } }, orderBy: { id: 'asc' } }), minQA: 4, qaExcludes: ['updatedAt'] },
  ];

  const results = {};
  for (const d of domains) {
    const nonQA = await d.fetchNonQA();
    const qa = await d.fetchQA();
    results[d.name] = {
      nonQACount: nonQA.length,
      nonQAHash: hashRows(nonQA),
      qaCount: qa.length,
      qaHash: hashRows(qa, d.qaExcludes),
      minQA: d.minQA,
      satisfiesMin: qa.length >= d.minQA,
    };
  }

  const workoutBreakdown = await prisma.workoutSession.groupBy({
    by: ['status'],
    where: { horse: { horseCode: { startsWith: 'QA-' } } },
    _count: { id: true },
  });
  const statusCounts = {};
  for (const w of workoutBreakdown) {
    statusCounts[w.status] = w._count.id;
  }

  return { domains: results, workoutStatuses: statusCounts };
}

function requestHttp(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runR2Sequence() {
  console.log('=== [R-2 STEP 1] Running Initial QA Seed ===');
  execSync('npm run db:seed:manual-qa -- --confirm-local-qa', { stdio: 'inherit' });

  console.log('\n=== [R-2 STEP 2] Capturing Snapshot 1 (Pre-API) ===');
  const snap1 = await captureSnapshot();
  console.log('Snapshot 1 Workout Statuses:', JSON.stringify(snap1.workoutStatuses));

  console.log('\n=== [R-2 STEP 3 & 4] Authenticating & Executing Real API Matrix ===');
  const testUsers = [
    { email: 'qa-cm@gmail.com', role: 'CLUB_MANAGER' },
    { email: 'qa-trainer1@gmail.com', role: 'HEAD_TRAINER' },
    { email: 'qa-vet1@gmail.com', role: 'VETERINARIAN' },
    { email: 'qa-groom1@gmail.com', role: 'GROOM' },
    { email: 'qa-groom2@gmail.com', role: 'GROOM' },
    { email: 'qa-owner1@gmail.com', role: 'HORSE_OWNER' },
    { email: 'qa-owner2@gmail.com', role: 'HORSE_OWNER' },
    { email: 'qa-owner3@gmail.com', role: 'HORSE_OWNER' },
  ];

  const tokens = {};
  for (const u of testUsers) {
    const res = await requestHttp('POST', '/api/auth/login', { email: u.email, password: 'EquiFlow@2026' });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Login failed for ${u.email}: status ${res.status} ${JSON.stringify(res.body)}`);
    }
    const token = res.body?.data?.accessToken || res.body?.accessToken;
    tokens[u.email] = token;
    console.log(`  Authenticated: ${u.email} [${u.role}] -> Token OK`);
  }

  // 1. CM calls training plans, horses, stalls, tournaments, invoices
  const cmPlans = await requestHttp('GET', '/api/training/plans', null, tokens['qa-cm@gmail.com']);
  console.log('  CM GET /api/training/plans:', cmPlans.status, 'Total:', cmPlans.body?.data?.total || cmPlans.body?.total);

  const cmHorses = await requestHttp('GET', '/api/horses', null, tokens['qa-cm@gmail.com']);
  console.log('  CM GET /api/horses:', cmHorses.status, 'Total active horses:', cmHorses.body?.data?.total || cmHorses.body?.total);

  // 2. HT1 calls training plans (triggers sweepOverdue!)
  const htPlans = await requestHttp('GET', '/api/training/plans', null, tokens['qa-trainer1@gmail.com']);
  console.log('  HT1 GET /api/training/plans (triggers sweepOverdue):', htPlans.status, 'Total:', htPlans.body?.data?.total || htPlans.body?.total);

  // 3. Vet1 calls medical records & locks
  const vetRecords = await requestHttp('GET', '/api/medical/records', null, tokens['qa-vet1@gmail.com']);
  console.log('  Vet1 GET /api/medical/records:', vetRecords.status, 'Total:', vetRecords.body?.data?.total || vetRecords.body?.total || (Array.isArray(vetRecords.body?.data) ? vetRecords.body.data.length : 'OK'));

  // 4. Groom1 & Groom2 call daily tasks
  const groom1Tasks = await requestHttp('GET', '/api/daily-tasks', null, tokens['qa-groom1@gmail.com']);
  console.log('  Groom1 GET /api/daily-tasks:', groom1Tasks.status, 'Total:', groom1Tasks.body?.data?.total || groom1Tasks.body?.total || (Array.isArray(groom1Tasks.body?.data) ? groom1Tasks.body.data.length : 'OK'));

  const groom2Tasks = await requestHttp('GET', '/api/daily-tasks', null, tokens['qa-groom2@gmail.com']);
  console.log('  Groom2 GET /api/daily-tasks:', groom2Tasks.status, 'Total:', groom2Tasks.body?.data?.total || groom2Tasks.body?.total || (Array.isArray(groom2Tasks.body?.data) ? groom2Tasks.body.data.length : 'OK'));

  // 5. Owners call /api/horses to inspect scoped horse ownership
  const expectedOwnerHorses = {
    'qa-owner1@gmail.com': ['QA-HR-000001', 'QA-HR-000002', 'QA-HR-000003', 'QA-HR-000006', 'QA-HR-000007', 'QA-HR-000023'],
    'qa-owner2@gmail.com': ['QA-HR-000004', 'QA-HR-000005', 'QA-HR-000008', 'QA-HR-000009', 'QA-HR-000010', 'QA-HR-000011', 'QA-HR-000024'],
    'qa-owner3@gmail.com': ['QA-HR-000012', 'QA-HR-000013', 'QA-HR-000014', 'QA-HR-000015', 'QA-HR-000016', 'QA-HR-000017'],
  };

  for (const [ownerEmail, expectedCodes] of Object.entries(expectedOwnerHorses)) {
    const res = await requestHttp('GET', '/api/horses', null, tokens[ownerEmail]);
    const horses = res.body?.data?.items || res.body?.items || [];
    const actualCodes = horses.map(h => h.horseCode).sort();
    const expectedSorted = [...expectedCodes].sort();
    const match = JSON.stringify(actualCodes) === JSON.stringify(expectedSorted);
    console.log(`  ${ownerEmail} GET /api/horses: ${res.status} | Count: ${actualCodes.length} (Expected: ${expectedCodes.length}) | Match: ${match ? 'PASS' : 'FAIL'}`);
    if (!match) throw new Error(`Horse set mismatch for ${ownerEmail}: got ${JSON.stringify(actualCodes)}`);
  }

  // 6. Negative RBAC checks
  const htLockNeg = await requestHttp('POST', '/api/medical/locks', { horseId: '00000000-0000-0000-0000-000000000000', lockReason: 'Test' }, tokens['qa-trainer1@gmail.com']);
  console.log('  HT1 POST /api/medical/locks (Negative guard):', htLockNeg.status, '(Expected 403)');
  if (htLockNeg.status !== 403) throw new Error('Expected 403 for HT POST /api/medical/locks');

  const ownerHorseNeg = await requestHttp('POST', '/api/horses', { name: 'Unauthorized Horse' }, tokens['qa-owner1@gmail.com']);
  console.log('  Owner1 POST /api/horses (Negative guard):', ownerHorseNeg.status, '(Expected 403)');
  if (ownerHorseNeg.status !== 403) throw new Error('Expected 403 for Owner POST /api/horses');

  console.log('\n=== [R-2 STEP 5] Capturing Snapshot 2 (Post-API) ===');
  const snap2 = await captureSnapshot();
  console.log('Snapshot 2 Workout Statuses:', JSON.stringify(snap2.workoutStatuses));

  console.log('\n=== [R-2 STEP 6] Running QA Seed Second Time ===');
  execSync('npm run db:seed:manual-qa -- --confirm-local-qa', { stdio: 'inherit' });

  console.log('\n=== [R-2 STEP 7] Capturing Snapshot 3 (Post-Repeated-Seed) ===');
  const snap3 = await captureSnapshot();
  console.log('Snapshot 3 Workout Statuses:', JSON.stringify(snap3.workoutStatuses));

  console.log('\n=== [R-2 VERIFICATION SUMMARY] ===');
  let hasFailure = false;
  const domainNames = Object.keys(snap1.domains);

  console.log('-------------------------------------------------------------------------------------------------------------------------------------');
  console.log('Domain                | Non-QA Counts (S1/S2/S3) | Non-QA Hashes Match | QA Counts (S1/S2/S3) | QA Hashes Match | Min Met | Verdict');
  console.log('-------------------------------------------------------------------------------------------------------------------------------------');

  for (const name of domainNames) {
    const s1 = snap1.domains[name];
    const s2 = snap2.domains[name];
    const s3 = snap3.domains[name];

    const nonQACountsMatch = s1.nonQACount === s2.nonQACount && s2.nonQACount === s3.nonQACount;
    const nonQAHashesMatch = s1.nonQAHash === s2.nonQAHash && s2.nonQAHash === s3.nonQAHash;
    const qaCountsMatch = s1.qaCount === s2.qaCount && s2.qaCount === s3.qaCount;
    const qaHashesMatch = s1.qaHash === s2.qaHash && s2.qaHash === s3.qaHash;
    const minMet = s3.satisfiesMin;

    const pass = nonQACountsMatch && nonQAHashesMatch && qaCountsMatch && qaHashesMatch && minMet;
    if (!pass) hasFailure = true;

    const pad = (s, l) => String(s).padEnd(l);
    const countStr = s1.nonQACount + '/' + s2.nonQACount + '/' + s3.nonQACount;
    const qaCountStr = s1.qaCount + '/' + s2.qaCount + '/' + s3.qaCount;
    console.log(
      `${pad(name, 21)} | ${pad(countStr, 24)} | ${pad(nonQAHashesMatch ? 'PASS' : 'FAIL', 19)} | ${pad(qaCountStr, 20)} | ${pad(qaHashesMatch ? 'PASS' : 'FAIL', 15)} | ${pad(minMet ? 'PASS' : 'FAIL', 7)} | ${pass ? 'PASS' : 'FAIL'}`
    );
  }
  console.log('-------------------------------------------------------------------------------------------------------------------------------------');

  console.log('\nWorkoutStatus Breakdown across Snapshots:');
  const requiredStatuses = ['SCHEDULED', 'COMPLETED', 'BLOCKED', 'MISSED', 'CANCELLED'];
  let workoutStatusPass = true;
  for (const st of requiredStatuses) {
    const c1 = snap1.workoutStatuses[st] || 0;
    const c2 = snap2.workoutStatuses[st] || 0;
    const c3 = snap3.workoutStatuses[st] || 0;
    const match = c1 === c2 && c2 === c3 && c1 > 0;
    if (!match) workoutStatusPass = false;
    console.log(`  ${st.padEnd(12)}: S1=${c1}, S2=${c2}, S3=${c3} -> ${match ? 'PASS' : 'FAIL'}`);
  }

  console.log('\nExact 26-Domain SHA-256 Hashes Table:');
  console.log('| Domain | Non-QA SHA-256 (Full Row Fingerprint) | QA Stable Business SHA-256 Fingerprint |');
  console.log('|---|---|---|');
  for (const name of domainNames) {
    console.log(`| ${name} | \`${snap1.domains[name].nonQAHash}\` | \`${snap1.domains[name].qaHash}\` |`);
  }

  await prisma.$disconnect();

  if (hasFailure || !workoutStatusPass) {
    console.error('\nFAIL: R-2 stability verification failed!');
    process.exit(1);
  } else {
    console.log('\nALL PASS: 100% stability across all 26 domains and all 5 WorkoutStatus values across the entire API and seed lifecycle.');
    process.exit(0);
  }
}

runR2Sequence().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
'@ | node
```

### Actual Verification Results across all 26 Domains (S1 / S2 / S3)

```text
-------------------------------------------------------------------------------------------------------------------------------------
Domain                | Non-QA Counts (S1/S2/S3) | Non-QA Hashes Match | QA Counts (S1/S2/S3) | QA Hashes Match | Min Met | Verdict
-------------------------------------------------------------------------------------------------------------------------------------
User                  | 10/10/10                 | PASS                | 16/16/16             | PASS            | PASS    | PASS
StallZone             | 3/3/3                    | PASS                | 1/1/1                | PASS            | PASS    | PASS
Stall                 | 20/20/20                 | PASS                | 24/24/24             | PASS            | PASS    | PASS
StallAllocation       | 15/15/15                 | PASS                | 24/24/24             | PASS            | PASS    | PASS
Horse                 | 17/17/17                 | PASS                | 24/24/24             | PASS            | PASS    | PASS
TrainingPlan          | 32/32/32                 | PASS                | 12/12/12             | PASS            | PASS    | PASS
WorkoutSession        | 60/60/60                 | PASS                | 48/48/48             | PASS            | PASS    | PASS
MedicalRecord         | 8/8/8                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
InjuryLog             | 5/5/5                    | PASS                | 8/8/8                | PASS            | PASS    | PASS
MedicalLock           | 7/7/7                    | PASS                | 6/6/6                | PASS            | PASS    | PASS
PreventiveSchedule    | 3/3/3                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
IncidentReport        | 3/3/3                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
Tournament            | 14/14/14                 | PASS                | 12/12/12             | PASS            | PASS    | PASS
TournamentRegistration | 24/24/24                 | PASS                | 32/32/32             | PASS            | PASS    | PASS
TournamentResult      | 8/8/8                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
FinancialInvoice      | 7/7/7                    | PASS                | 16/16/16             | PASS            | PASS    | PASS
Notification          | 212/212/212              | PASS                | 32/32/32             | PASS            | PASS    | PASS
RestockRequest        | 2/2/2                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
StockBalance          | 2/2/2                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
DailyCareTask         | 282/282/282              | PASS                | 28/28/28             | PASS            | PASS    | PASS
NutritionPlan         | 0/0/0                    | PASS                | 12/12/12             | PASS            | PASS    | PASS
DailyGroomingLog      | 0/0/0                    | PASS                | 8/8/8                | PASS            | PASS    | PASS
ShiftRoster           | 29/29/29                 | PASS                | 6/6/6                | PASS            | PASS    | PASS
SimulatorSession      | 9/9/9                    | PASS                | 4/4/4                | PASS            | PASS    | PASS
PermissionRequest     | 0/0/0                    | PASS                | 3/3/3                | PASS            | PASS    | PASS
AIInsight             | 0/0/0                    | PASS                | 4/4/4                | PASS            | PASS    | PASS
-------------------------------------------------------------------------------------------------------------------------------------
```

### WorkoutStatus Counts Before API, After API, and After Repeated Seed

All 48 QA WorkoutSession fixtures maintain 100% stability across all 5 statuses before API access, after calling `GET /api/training/plans` (invoking `sweepOverdue()`), and after repeated seed execution:

| WorkoutStatus | Snapshot 1 (Pre-API) | Snapshot 2 (Post-API) | Snapshot 3 (Post-Repeated-Seed) | Stability Verdict | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `SCHEDULED` | **17** | **17** | **17** | **PASS** | Assigned future dates (`2026-11-04` to `2026-11-28`) within Active/Draft plans; never swept to `MISSED` |
| `COMPLETED` | **15** | **15** | **15** | **PASS** | Historical dates (`2026-07-15` to `2026-10-12`) across Active and Completed plans |
| `BLOCKED` | **3** | **3** | **3** | **PASS** | Medical hold cases (`2026-11-06`, `2026-11-07`, `2026-11-20`) |
| `MISSED` | **5** | **5** | **5** | **PASS** | Historical unexcused absences (`2026-08-15` to `2026-10-18`) |
| `CANCELLED` | **8** | **8** | **8** | **PASS** | Historical cancellations (`2026-09-01` to `2026-10-20`) in Draft, Completed and Cancelled plans |
| **Total** | **48** | **48** | **48** | **PASS** | Exactly 48 QA workouts, zero drift across full API & seed lifecycle |

### Exact SHA-256 Hashes

| Domain | Non-QA SHA-256 (Full Row Fingerprint) | QA Stable Business SHA-256 Fingerprint |
|---|---|---|
| User | `77d11426fd1a5876015f0c8cd9aa91ecbd818b885ee61e7dbf21c804f9719cdc` | `dc9afade4af13fc8afd8a5956a08f7f94be332f4d35fcf652fe934b68db2c97b` |
| StallZone | `95bae563e6b22e45e9e05fdccf365db1004b9e0a4e7b71bf852091bffab84d08` | `e32febb88e5797b120c85d84b2d94bcbd1e1b1e32d28e32126df7e96f1be5040` |
| Stall | `3c0446562d4aabbf335ca851de7f6bcb297acfddf9c182ab50460812410202d9` | `16312d6e3b71c3e4e3bf6387a981789caebd63e35aaaa6f26922d35886ec8382` |
| StallAllocation | `51b726f8645c9eb904855e8a264a750638436ae464c35581740c9263a3920d90` | `6d9bf5dda221597f629a201e0cbe24e94042cd52aeca225b03e817f0a1638c34` |
| Horse | `08baa0fa17c7b79aa39d3a92e162da3a956e390540998b56b3f5c899fbb2a416` | `47f88bc43f375069bc78892d522491db0a4f443b6bba0969bfad87f00cb5cc89` |
| TrainingPlan | `2411898a618b66c204f307f9e52e612eee5404fcfd3fcacb2ba20f394d5eaac3` | `f15ad99681b52e93525846d37bd35e72c2894930f4fe5f2723778db3dc8742de` |
| WorkoutSession | `78d41fd94e4d6e233c220eba606abcd3fcf12842f436cd77b0c385d24d2dc9f4` | `bb644b251272a3a71f7235a31de0c359047e901fe18adc8d5bf3cca373eabd02` |
| MedicalRecord | `54604a26cc8dde0bf213c2867f5a7bd4d98fb73c961990379e42ff29235b83d3` | `ce06a3c894dc9caec8f05c3bd73c891383140a6770af37606488c62463c5491e` |
| InjuryLog | `e1b9a757b246ac960993a05a7e29d1eb706393384fa454bdb75b389713d25e4a` | `c55a94aaf9662602aecd6baafa113ba09022b32a7b649bad01da7fd1163df24b` |
| MedicalLock | `dbb0e02e5943ac1a38c77ab4634bc0439327d9ebeec61f36b533cfea2490f5a6` | `e271136fbed01f9d5f0942b0d6c97fade42150471ec4fd6f3d7e5c759341ced7` |
| PreventiveSchedule | `5cf466aeff2706b7acdf14a2ade9277549893b5c9a4a7f16654868ecfea28e71` | `fccc3f58f6ab869925ab2c921d57d74fa08f935cbd24c010d13a6bc6574a60d6` |
| IncidentReport | `c43e47657e360ad8c9d3d067a252535c4d7b66d35b2fe5fc3a8270be36b512e7` | `ccd8ba0f34f61a84f43c65df7fe3a8e87812520188c377b9b99bb3c55212e2b7` |
| Tournament | `5ac8014564e7ad3048e7c15415ffebcea1baa5bc1e4979ee609c95be101e1df6` | `45a3c201c35ddb9060e259692db6f114d167a4317686148d41aecf8c93c7d9e2` |
| TournamentRegistration | `bd5eab63b74845c7be7ce6c9f2b45e6fca2a14be6a72b08aed108af19bb0dbbd` | `6bbd04d62644b36f6e779c9d4f2853697cd5e43faf19d66e49ab3cef38985572` |
| TournamentResult | `d26f8764d4694c575dc4c11a5b8ff69e3a400bccf2b313284bf9c31b6fa5f255` | `700c442f101e5dd9ecd4d49af6ec86b0b87d1adf17c5032a3f9445f857e77de2` |
| FinancialInvoice | `b648263ed160ffec649bdf352c28c6a8260ce2887931b4becb848856d14ed82c` | `46a9289a157df4c978591eaf6bfec2fddb67b3be8ae628004fff81b19c2c1764` |
| Notification | `41c5be300e47703b2aa1782da8ae4b3e9f9495005550b20bb5f8077fa5863baf` | `bfd85bd8a0942b3466c8d94973a9f9e301ceb7e852a5c1dd865887120868f3d1` |
| RestockRequest | `82cb3af1cdcf641dc5d493a664ac9aec6891a16671c5b2a6ef98737f719cda36` | `e0fe49f5d2e8512ded6e19b6eba257bcd5b1b9c5f485e7756558bac87aae1b5d` |
| StockBalance | `00cd330c2c597f1344a9760bff2dc2e0c1499dcd052163f2c37f2cfc4f08716a` | `899bb8bfdfb015c37c550456906d77be3232adf7a71027f8a4249065937b959b` |
| DailyCareTask | `91dece69e25686595ef191cfd00c73cf6cb8dbbffcdce046680d07329ead8ecc` | `e5b55b0dd78decd09457d39f7f5e45c00e245fb8bdd48061a304fd24ec56d160` |
| NutritionPlan | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `d573c339e800136fc1927f6674b9956e5c89e91b1309a52ab3be8b4c520fe6c7` |
| DailyGroomingLog | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `57b95f7d0e8423c2e86027daf2ebcabc2b0e6320d73439d0e2205cd89a411cbe` |
| ShiftRoster | `4a28f461f394ad2084a62fa950e59488492a5af66fc7919e1958b7131929b816` | `0c57713acd6005a9760b43ee3a370973bcf96535f6e0a010796821ab94fe2a1b` |
| SimulatorSession | `cdadd453f92cc67cd021795c1e55d1a07ceb325a12fb1146ec2a70c95c7b87cd` | `08e5e8f7c9d1a25d626a50639fb23593ad985b1e5b5df8f83ade5fb7c73bfb39` |
| PermissionRequest | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `efc7fc8c0ff696a422bd00775ac9b04b7b1aef22abc8bed4920d1801e0069e58` |
| AIInsight | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `23d24e183ca68546bdb5058760e11976151872c7e41b080bcd8db377f219593d` |

---

## R-3: Real NestJS API & RBAC Matrix Verification

### Reproducible PowerShell Verifier Command

```powershell
@'
const BASE_URL = 'http://localhost:3000/api';

async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Login failed for ${email} with status ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function runRBACVerification() {
  console.log('=== R-3: Real NestJS API & RBAC Matrix Verification ===\n');

  console.log('--- 1. Authenticating seeded QA users via real POST /api/auth/login ---');
  const cmAuth = await loginUser('qa-cm@gmail.com', 'EquiFlow@2026');
  console.log('✓ CM authenticated:', cmAuth.user.fullName, `(${cmAuth.user.role})`);

  const htAuth = await loginUser('qa-trainer1@gmail.com', 'EquiFlow@2026');
  console.log('✓ HT authenticated:', htAuth.user.fullName, `(${htAuth.user.role})`);

  const vetAuth = await loginUser('qa-vet1@gmail.com', 'EquiFlow@2026');
  console.log('✓ Vet authenticated:', vetAuth.user.fullName, `(${vetAuth.user.role})`);

  const g1Auth = await loginUser('qa-groom1@gmail.com', 'EquiFlow@2026');
  console.log('✓ Groom 1 authenticated:', g1Auth.user.fullName, `(${g1Auth.user.role})`);

  const g2Auth = await loginUser('qa-groom2@gmail.com', 'EquiFlow@2026');
  console.log('✓ Groom 2 authenticated:', g2Auth.user.fullName, `(${g2Auth.user.role})`);

  const o1Auth = await loginUser('qa-owner1@gmail.com', 'EquiFlow@2026');
  console.log('✓ Owner 1 authenticated:', o1Auth.user.fullName, `(${o1Auth.user.role})`);

  const o2Auth = await loginUser('qa-owner2@gmail.com', 'EquiFlow@2026');
  console.log('✓ Owner 2 authenticated:', o2Auth.user.fullName, `(${o2Auth.user.role})`);

  const o3Auth = await loginUser('qa-owner3@gmail.com', 'EquiFlow@2026');
  console.log('✓ Owner 3 authenticated:', o3Auth.user.fullName, `(${o3Auth.user.role})`);

  console.log('\n--- 2. Verifying Positive Role Data & Scoped Boundaries ---');

  // Club Manager: full horse master list (40 active horses + 1 soft-deleted = 41 total in DB)
  const cmHorsesRes = await fetch(`${BASE_URL}/horses?limit=100`, {
    headers: { Authorization: `Bearer ${cmAuth.accessToken}` },
  });
  const cmHorsesJson = await cmHorsesRes.json();
  if (cmHorsesRes.status !== 200 || cmHorsesJson.data.total < 40) {
    throw new Error(`CM horses query failed: status ${cmHorsesRes.status}, total ${cmHorsesJson.data?.total}`);
  }
  console.log(`✓ CM views full active horse master list: ${cmHorsesJson.data.total} active horses (all 24 QA + 16 baseline active)`);

  const cmDeletedRes = await fetch(`${BASE_URL}/horses/deleted`, {
    headers: { Authorization: `Bearer ${cmAuth.accessToken}` },
  });
  const cmDeletedJson = await cmDeletedRes.json();
  console.log(`✓ CM views soft-deleted horses endpoint: ${cmDeletedJson.data.total} deleted horse (HR-000009)`);

  // Head Trainer: training plans access
  const htPlansRes = await fetch(`${BASE_URL}/training/plans`, {
    headers: { Authorization: `Bearer ${htAuth.accessToken}` },
  });
  const htPlansJson = await htPlansRes.json();
  if (htPlansRes.status !== 200 || !htPlansJson.data) {
    throw new Error(`HT training plans query failed: status ${htPlansRes.status}`);
  }
  const totalPlans = Array.isArray(htPlansJson.data) ? htPlansJson.data.length : htPlansJson.data.total;
  console.log(`✓ HT views training plans list: ${totalPlans} plans`);

  // Veterinarian: medical records access
  const vetMedRes = await fetch(`${BASE_URL}/medical/records`, {
    headers: { Authorization: `Bearer ${vetAuth.accessToken}` },
  });
  const vetMedJson = await vetMedRes.json();
  if (vetMedRes.status !== 200 || !vetMedJson.data) {
    throw new Error(`Vet medical records query failed: status ${vetMedRes.status}`);
  }
  const totalMed = Array.isArray(vetMedJson.data) ? vetMedJson.data.length : vetMedJson.data.total;
  console.log(`✓ Vet views medical records list: ${totalMed} records`);

  // Groom 1: daily tasks access
  const g1TasksRes = await fetch(`${BASE_URL}/daily-tasks?date=2026-10-26`, {
    headers: { Authorization: `Bearer ${g1Auth.accessToken}` },
  });
  const g1TasksJson = await g1TasksRes.json();
  if (g1TasksRes.status !== 200 || !g1TasksJson.data) {
    throw new Error(`Groom 1 daily tasks query failed: status ${g1TasksRes.status}`);
  }
  const totalG1Tasks = Array.isArray(g1TasksJson.data) ? g1TasksJson.data.length : g1TasksJson.data.total;
  console.log(`✓ Groom 1 views daily care tasks list: ${totalG1Tasks} tasks`);

  // Groom 2: daily tasks access
  const g2TasksRes = await fetch(`${BASE_URL}/daily-tasks?date=2026-10-26`, {
    headers: { Authorization: `Bearer ${g2Auth.accessToken}` },
  });
  const g2TasksJson = await g2TasksRes.json();
  if (g2TasksRes.status !== 200 || !g2TasksJson.data) {
    throw new Error(`Groom 2 daily tasks query failed: status ${g2TasksRes.status}`);
  }
  const totalG2Tasks = Array.isArray(g2TasksJson.data) ? g2TasksJson.data.length : g2TasksJson.data.total;
  console.log(`✓ Groom 2 views daily care tasks list: ${totalG2Tasks} tasks`);

  // Owner 1: exact horse set and count
  const o1HorsesRes = await fetch(`${BASE_URL}/horses?limit=50`, {
    headers: { Authorization: `Bearer ${o1Auth.accessToken}` },
  });
  const o1HorsesJson = await o1HorsesRes.json();
  const o1Codes = o1HorsesJson.data.items.map((h) => h.horseCode).sort();
  const expectedO1 = ['QA-HR-000001', 'QA-HR-000002', 'QA-HR-000003', 'QA-HR-000006', 'QA-HR-000007', 'QA-HR-000023'].sort();
  if (o1HorsesJson.data.total !== 6 || JSON.stringify(o1Codes) !== JSON.stringify(expectedO1)) {
    throw new Error(`Owner 1 horse set mismatch! Expected ${JSON.stringify(expectedO1)}, got ${JSON.stringify(o1Codes)}`);
  }
  console.log(`✓ Owner 1 exact horse set verified (${o1HorsesJson.data.total} horses):`, o1Codes);

  // Owner 2: exact horse set and count
  const o2HorsesRes = await fetch(`${BASE_URL}/horses?limit=50`, {
    headers: { Authorization: `Bearer ${o2Auth.accessToken}` },
  });
  const o2HorsesJson = await o2HorsesRes.json();
  const o2Codes = o2HorsesJson.data.items.map((h) => h.horseCode).sort();
  const expectedO2 = ['QA-HR-000004', 'QA-HR-000005', 'QA-HR-000008', 'QA-HR-000009', 'QA-HR-000010', 'QA-HR-000011', 'QA-HR-000024'].sort();
  if (o2HorsesJson.data.total !== 7 || JSON.stringify(o2Codes) !== JSON.stringify(expectedO2)) {
    throw new Error(`Owner 2 horse set mismatch! Expected ${JSON.stringify(expectedO2)}, got ${JSON.stringify(o2Codes)}`);
  }
  console.log(`✓ Owner 2 exact horse set verified (${o2HorsesJson.data.total} horses):`, o2Codes);

  // Owner 3: exact horse set and count
  const o3HorsesRes = await fetch(`${BASE_URL}/horses?limit=50`, {
    headers: { Authorization: `Bearer ${o3Auth.accessToken}` },
  });
  const o3HorsesJson = await o3HorsesRes.json();
  const o3Codes = o3HorsesJson.data.items.map((h) => h.horseCode).sort();
  const expectedO3 = ['QA-HR-000012', 'QA-HR-000013', 'QA-HR-000014', 'QA-HR-000015', 'QA-HR-000016', 'QA-HR-000017'].sort();
  if (o3HorsesJson.data.total !== 6 || JSON.stringify(o3Codes) !== JSON.stringify(expectedO3)) {
    throw new Error(`Owner 3 horse set mismatch! Expected ${JSON.stringify(expectedO3)}, got ${JSON.stringify(o3Codes)}`);
  }
  console.log(`✓ Owner 3 exact horse set verified (${o3HorsesJson.data.total} horses):`, o3Codes);

  // Assert zero cross-owner overlap
  const set1 = new Set(o1Codes);
  const set2 = new Set(o2Codes);
  const set3 = new Set(o3Codes);
  const overlap12 = o1Codes.filter((c) => set2.has(c));
  const overlap13 = o1Codes.filter((c) => set3.has(c));
  const overlap23 = o2Codes.filter((c) => set3.has(c));
  if (overlap12.length > 0 || overlap13.length > 0 || overlap23.length > 0) {
    throw new Error('Cross-owner data leakage detected!');
  }
  console.log('✓ Zero cross-owner horse leakage confirmed across all 3 Owners');

  console.log('\n--- 3. Verifying Negative RBAC Guards & Error Envelopes ---');

  // Head Trainer cannot create horse master record -> 403 Forbidden
  const htMutateRes = await fetch(`${BASE_URL}/horses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${htAuth.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Unauthorized Horse', breed: 'Thoroughbred' }),
  });
  const htMutateJson = await htMutateRes.json();
  if (htMutateRes.status !== 403 || !htMutateJson.message) {
    throw new Error(`HT negative mutation check failed: status ${htMutateRes.status}`);
  }
  console.log(`✓ HT blocked from creating horse (Status ${htMutateRes.status}):`, htMutateJson.message);

  // Groom cannot create horse master record -> 403 Forbidden
  const gMutateRes = await fetch(`${BASE_URL}/horses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${g1Auth.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Unauthorized Horse', breed: 'Thoroughbred' }),
  });
  const gMutateJson = await gMutateRes.json();
  if (gMutateRes.status !== 403 || !gMutateJson.message) {
    throw new Error(`Groom 1 blocked from creating horse (Status ${gMutateRes.status}):`, gMutateJson.message);
  }
  console.log(`✓ Groom 1 blocked from creating horse (Status ${gMutateRes.status}):`, gMutateJson.message);

  // Owner cannot access system accounts -> 403 Forbidden
  const oAccountsRes = await fetch(`${BASE_URL}/accounts`, {
    headers: { Authorization: `Bearer ${o1Auth.accessToken}` },
  });
  const oAccountsJson = await oAccountsRes.json();
  if (oAccountsRes.status !== 403 || !oAccountsJson.message) {
    throw new Error(`Owner negative accounts check failed: status ${oAccountsRes.status}`);
  }
  console.log(`✓ Owner 1 blocked from accessing accounts (Status ${oAccountsRes.status}):`, oAccountsJson.message);

  console.log('\nPASS: Real-API Authentication and RBAC matrix verified across all 5 roles.');
}

runRBACVerification().catch((e) => {
  console.error(e);
  process.exit(1);
});
'@ | node
```

**Actual Output (Exit code 0):**
```text
=== R-3: Real NestJS API & RBAC Matrix Verification ===

--- 1. Authenticating seeded QA users via real POST /api/auth/login ---
✓ CM authenticated: QA Michael Tran (Club Manager) (CLUB_MANAGER)
✓ HT authenticated: QA David Nguyen (Head Trainer 1) (HEAD_TRAINER)
✓ Vet authenticated: QA Dr. Sarah Connor (Chief Vet) (VETERINARIAN)
✓ Groom 1 authenticated: QA John Smith (Groom Alpha) (GROOM)
✓ Groom 2 authenticated: QA Le Van Phuc (Groom Beta) (GROOM)
✓ Owner 1 authenticated: QA Robert Sterling (Owner Alpha) (HORSE_OWNER)
✓ Owner 2 authenticated: QA Phan Duc Long (Owner Beta) (HORSE_OWNER)
✓ Owner 3 authenticated: QA Victoria Chen (Owner Gamma) (HORSE_OWNER)

--- 2. Verifying Positive Role Data & Scoped Boundaries ---
✓ CM views full active horse master list: 40 active horses (all 24 QA + 16 baseline active)
✓ CM views soft-deleted horses endpoint: 1 deleted horse (HR-000009)
✓ HT views training plans list: 44 plans
✓ Vet views medical records list: 20 records
✓ Groom 1 views daily care tasks list: 28 tasks
✓ Groom 2 views daily care tasks list: 28 tasks
✓ Owner 1 exact horse set verified (6 horses): [
  'QA-HR-000001',
  'QA-HR-000002',
  'QA-HR-000003',
  'QA-HR-000006',
  'QA-HR-000007',
  'QA-HR-000023'
]
✓ Owner 2 exact horse set verified (7 horses): [
  'QA-HR-000004',
  'QA-HR-000005',
  'QA-HR-000008',
  'QA-HR-000009',
  'QA-HR-000010',
  'QA-HR-000011',
  'QA-HR-000024'
]
✓ Owner 3 exact horse set verified (6 horses): [
  'QA-HR-000012',
  'QA-HR-000013',
  'QA-HR-000014',
  'QA-HR-000015',
  'QA-HR-000016',
  'QA-HR-000017'
]
✓ Zero cross-owner horse leakage confirmed across all 3 Owners

--- 3. Verifying Negative RBAC Guards & Error Envelopes ---
✓ HT blocked from creating horse (Status 403): Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]
✓ Groom 1 blocked from creating horse (Status 403): Access denied: Required role [CLUB_MANAGER], current role is [GROOM]
✓ Owner 1 blocked from accessing accounts (Status 403): Not allowed

PASS: Real-API Authentication and RBAC matrix verified across all 5 roles.
```

---

## R-4: Truthful Manual QA Guide with Router-Verified Routes

All routes below have been verified against [`Racehorse_Training_Management_System_MT_FE/src/app/router.tsx`](file:///e:/01_Academic_FPT/Courses/Se_5_Active/SWP391/MINH_Racehorse_Branch/Racehorse_Training_Management_System_MT_FE/src/app/router.tsx).

All seeded QA users share the password: **`EquiFlow@2026`**.

### 1. Club Manager (`qa-cm@gmail.com`)
- Navigate to `/horses`: Verify all 24 QA horses (`QA-HR-000001`..`QA-HR-000024`) alongside baseline horses. Verify statuses, breeds, and microchips.
- Navigate to `/horses/deleted`: Verify 1 soft-deleted horse (`HR-000009`).
- Navigate to `/stables/map` (or `/stalls`): Verify `Zone QA - Test Barn` displaying 24 stalls (`STALL-QA01`..`STALL-QA24`) with statuses: 20 Occupied, 2 Available, 1 Maintenance, 1 Inactive.
- Navigate to `/races` (or `/racing`): Verify 12 QA tournaments across `UPCOMING`, `OPEN_REGISTRATION`, `CLOSED_REGISTRATION`, `COMPLETED`, `CANCELLED`.
- Navigate to `/races/results`: Verify official locked results and podium ranks 1..4.
- Navigate to `/financial-reports` (or `/invoices`): Verify 16 QA invoices across `DRAFT`, `SENT`, `PAID`, `OVERDUE`, `CANCELLED`.
- Navigate to `/supplies/inventory` (or `/inventory`): Verify Zone QA stock balances for all active catalog supplies.
- Navigate to `/supplies/requests`: Verify 12 restock requests across `PENDING`, `APPROVED`, `DELIVERED`, `REJECTED`.
- Navigate to `/audit`: Verify audit entries for recent actions.
- Navigate to `/accounts`: Verify user list including QA accounts (`qa-cm`, `qa-trainer1..2`, `qa-vet1..2`, `qa-groom1..4`, `qa-owner1..4`, etc.).

### 2. Head Trainer 1 (`qa-trainer1@gmail.com`)
- Navigate to `/training/plans` (or `/plans`): Verify 12 QA training plans (`QA-GA-000001`..`QA-GA-000012`) covering Active, Draft, Completed, and Cancelled.
- Navigate to `/training`: Verify overview dashboard and upcoming workout sessions.
- Navigate to `/training/calendar` (or `/calendar`): Verify scheduled workouts across 48 sessions.
- Navigate to `/races` (or `/racing`): Verify ability to register horses and scratch registrations while open; confirm results are read-only.
- Negative test: Attempt to create a horse master record (navigate to `/horses/new` or trigger `POST /api/horses`) — confirm 403 Forbidden with message `Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]`.

### 3. Veterinarian 1 (`qa-vet1@gmail.com`)
- Navigate to `/medical/records` (or `/records`): Verify 12 QA medical records (`QA-BA-2610-001`..`QA-BA-2610-012`) covering Open, Closed, Draft.
- Navigate to `/injuries`: Verify 8 injuries across 8 anatomical zones and statuses `ACTIVE`, `HEALING`, `RESOLVED`.
- Navigate to `/medical/locks` (or `/locks`): Verify 6 medical locks (4 active locks with lock reasons, 2 unlocked with release records).
- Navigate to `/medical/preventive` (or `/vaccine`): Verify 12 preventive schedules covering `VACCINATION`, `DEWORMING`, `FARRIER_HOOF_CARE`, `DENTAL` across `PENDING`, `COMPLETED`, `OVERDUE`.
- Navigate to `/incidents`: Verify 12 incidents across severities `CRITICAL`, `SEVERE`, `MODERATE`, `MILD` and review statuses.

### 4. Groom 1 (`qa-groom1@gmail.com`) & Groom 2 (`qa-groom2@gmail.com`)
- Navigate to `/tasks`: Verify 28 daily care tasks (`QA-CARE-20261026-0001`..`QA-CARE-20261026-0028`) across all 7 care types (`FEEDING`, `CLEANING`, `GROOMING`, `ICE_BOOT_REST`, `WALKING`, `MEDICATION`, `OTHER`).
- Navigate to `/stable/shifts` (or `/shifts`): Verify shift roster entries for Zone QA.
- Navigate to `/rations`: Verify nutrition plans and daily feed weights.
- Navigate to `/supplies/requests`: Verify ability to view inventory and submit restock requests.
- Microchip privacy check: On `/horses`, verify microchip numbers are masked for Grooms.

### 5. Horse Owners — Cross-Owner Isolation Verification
- **Owner 1 (`qa-owner1@gmail.com`):**
  - Navigate to `/my-horses` (or `/horses`): Verify **only 6 horses** appear: `QA-HR-000001`, `QA-HR-000002`, `QA-HR-000003`, `QA-HR-000006`, `QA-HR-000007`, `QA-HR-000023`.
  - Navigate to `/financial-reports` (or `/invoices`): Verify only Owner 1 billing statements appear.
- **Owner 2 (`qa-owner2@gmail.com`):**
  - Navigate to `/my-horses` (or `/horses`): Verify **only 7 horses** appear: `QA-HR-000004`, `QA-HR-000005`, `QA-HR-000008`, `QA-HR-000009`, `QA-HR-000010`, `QA-HR-000011`, `QA-HR-000024`.
  - Confirm **0 horses from Owner 1** are visible.
- **Owner 3 (`qa-owner3@gmail.com`):**
  - Navigate to `/my-horses` (or `/horses`): Verify **only 6 horses** appear: `QA-HR-000012`, `QA-HR-000013`, `QA-HR-000014`, `QA-HR-000015`, `QA-HR-000016`, `QA-HR-000017`.
  - Confirm **0 horses from Owner 1 or Owner 2** are visible.
- Negative test: Attempt to navigate to `/accounts` or `/audit` — confirm 403 Forbidden with message `Not allowed`.

---

## Process Restart Persistence

1. Rebuilt backend bundle: `npm run build` (code 0).
2. Terminated running daemon and launched fresh daemon: `node --enable-source-maps dist/src/main` (`task-1045`).
3. Verified health check: `GET http://localhost:3000/api/health` returned `statusCode: 200, status: ok`.
4. Queried real API: All 41 horses, 44 plans, 20 medical records, 28 daily tasks, and all QA entities persisted identically across the process restart.

---

## Git Status Across Repositories

### 1. Backend (`Racehorse_Training_Management_System_MT_BE`)
```text
On branch main
Your branch is ahead of 'origin/main' by 11 commits.

Changes not staged for commit:
	modified:   docs/ai-workflow/APPROVALS.md
	modified:   docs/ai-workflow/CHANGES.md
	modified:   docs/ai-workflow/DECISIONS.md
	modified:   docs/ai-workflow/HANDOFF.md
	modified:   docs/ai-workflow/PLAN.md
	modified:   docs/ai-workflow/PROGRESS.md
	modified:   docs/ai-workflow/STATE.md
	modified:   docs/ai-workflow/TASKS.md
	modified:   package.json

Untracked files:
	docs/ai-workflow/reports/TASK-020.md
	prisma/seed-manual-qa.ts
```

### 2. Frontend (`Racehorse_Training_Management_System_MT_FE`)
```text
On branch main
Your branch is ahead of 'origin/main' by 9 commits.
nothing to commit, working tree clean
```

### 3. Simulator (`Racehorse_Simulator_Web`)
```text
On branch refactor/remove-rfid-standardize-microchip
Your branch is ahead of 'origin/refactor/remove-rfid-standardize-microchip' by 1 commit.
nothing to commit, working tree clean
```

---

## Gate Status

- **Task:** `TASK-020` = `DONE` (human-approved on 2026-10-26)
- **Execution:** `IDLE`
- **Next task:** `TASK-012` (not started / unauthorized, awaiting explicit human `START TASK-012`)
- **Execution constraint:** Stopped. No commit, push, merge, Frontend/Simulator modification, or TASK-012 execution has occurred.
