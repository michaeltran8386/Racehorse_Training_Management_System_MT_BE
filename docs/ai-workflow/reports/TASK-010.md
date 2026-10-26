# TASK-010 — Execution Report

- **Plan version:** v1-approved-r11
- **Status:** DONE
- **Slice Architecture:** Complete two-slice implementation (strictly the 10 authorized files total: 5 Slice A files + 5 Slice B files) under approved CR-012.
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / starting: `717cbd3` / ending: working tree (`src/medical/medical-locks.service.ts`, `src/medical/medical-services.spec.ts`)
  - Frontend: `main` / starting: `82635a6` / ending: working tree (`src/shared/lib/api.ts`, `.env.example`, `tests/e2e/notifications.spec.ts`, `src/features/dashboard/pages/AuditLogPage.tsx`, `Dockerfile`, `src/vite-env.d.ts`, `.github/workflows/ci.yml`, `AGENTS.md`)
  - Simulator: `refactor/remove-rfid-standardize-microchip` (clean working tree)
- **Files Changed & Why (strictly the 10 authorized files across Slice A and Slice B):**
  - **Slice A (5 files):**
    1. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-locks.service.ts`:
       - Dispatches lock lifecycle notifications to approved 4-group audience (`{ roles: [Role.HEAD_TRAINER, Role.CLUB_MANAGER], owner: true, groom: true }`) via `NotificationsService.notifyHorse` across `createMedicalLock` (`LOCK_PLACED`), `extendMedicalLock` (`LOCK_EXTENDED`), and `releaseMedicalLock` (`LOCK_LIFTED`).
       - Preserved standard user-facing notification messages without clinical notes exposure for test instrumentation; notifications are tracked via before/after ID delta snapshots.
       - Synchronizes realtime simulator lock state immediately (`sys:medical_lock_sync`) across create, extend, and release.
       - Confirmed actor Vet exclusion (`excludeUserId = actor.userId`) across all 3 lifecycle actions.
    2. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-services.spec.ts`:
       - Unit tests assert `notifyHorse` is called with `{ roles: [Role.HEAD_TRAINER, Role.CLUB_MANAGER], owner: true, groom: true }` and `excludeUserId: mockVetUser.userId` on `LOCK_PLACED`, `LOCK_EXTENDED`, and `LOCK_LIFTED`.
       - Non-Vet roles (Club Manager, Head Trainer, Groom) are rejected with `ForbiddenException` (`VET_ONLY`).
    3. `Racehorse_Training_Management_System_MT_FE/src/shared/lib/api.ts`:
       - Real-only API client: removed dynamic import `import("@/shared/mock/handlers")`.
       - Removed unused legacy `export const USE_MOCK = false;` symbol.
       - Requests dispatch directly to real NestJS backend (`VITE_API_URL || 'http://localhost:3000/api'`).
       - Network errors and timeouts throw `ApiError` visibly without silent fallback.
    4. `Racehorse_Training_Management_System_MT_FE/.env.example`:
       - Removed deprecated `VITE_USE_MOCK=true`. Standardized default `VITE_API_URL=http://localhost:3000/api`.
    5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/notifications.spec.ts`:
       - Fail-closed and portable Prisma initialization resolving sibling Backend directory portably from `__dirname` without hardcoded drive paths (`PRISMA_CLIENT_PATH || path.resolve(__dirname, '../../..', 'Racehorse_Training_Management_System_MT_BE', 'node_modules', '@prisma/client')`).
       - Dynamic resolution of target horse `Crimson Flash` via `horseCode: 'HR-000014'`, strictly asserting active Owner (`owner@gmail.com`) and assigned Groom (`groom@gmail.com`) before mutations.
       - Pre-test notification snapshot (`preNotifIds`) for exact delta isolation.
       - Positive assertions for Club Manager, Head Trainer, actual Owner, and assigned Groom tied to current-run Medical Lock event.
       - Negative assertions proving acting Veterinarian receives 0 self-generated events.
       - Negative assertions proving unrelated Horse Owner (`owner2@gmail.com`) and unrelated Groom (`groom2@gmail.com`) receive 0 events.
       - Real-stack cutover test proving invalid credentials display visible error without mock bypass.
       - Cleanup-always teardown (`try { ... release api ... } finally { try { ... Prisma exact delete ... } finally { await prisma.$disconnect(); } }`): captures release errors, queries exact notification and audit IDs created by current run, deletes only exact created IDs and created lock in one `$transaction`, asserts zero residue, and restores baseline horse state. Teardown failures fail the test suite.
  - **Slice B (5 files, corrective cutover authorized by CR-012):**
    6. `Racehorse_Training_Management_System_MT_FE/src/features/dashboard/pages/AuditLogPage.tsx`:
       - Removed obsolete mock demo alert `{import.meta.env.VITE_USE_MOCK === "true" && (...) }`.
       - Loads audit history directly from real NestJS API (`GET /api/audit-logs`) and renders explicit connection error Alert with retry on backend unavailability.
    7. `Racehorse_Training_Management_System_MT_FE/Dockerfile`:
       - Removed obsolete `ARG VITE_USE_MOCK=false` and `ENV VITE_USE_MOCK=$VITE_USE_MOCK`.
    8. `Racehorse_Training_Management_System_MT_FE/src/vite-env.d.ts`:
       - Removed obsolete type declaration `readonly VITE_USE_MOCK?: string;` from `ImportMetaEnv`.
    9. `Racehorse_Training_Management_System_MT_FE/.github/workflows/ci.yml`:
       - Removed `VITE_USE_MOCK: 'true'` build environment override from Stage 2 (`build`).
       - Explicitly and transparently deferred Stage 3 (`black-box-playwright-tests`) in standalone FE CI (which lacks a live NestJS Backend and PostgreSQL container), preventing mock-backed runs or false passes.
    10. `Racehorse_Training_Management_System_MT_FE/AGENTS.md`:
        - Removed obsolete lines 67–68 rule prescribing mock handler generation for new APIs.
        - Defined the real NestJS/PostgreSQL API as the sole data layer.

---

## Combined Quality Gates Summary

| Gate | Command | Result | Details |
| --- | --- | --- | --- |
| Backend Medical Unit Tests | `npm test -- src/medical` | **PASS (107/107)** | 3 test suites passed in 9.8s |
| Backend Typecheck | `npm run typecheck` | **PASS (code 0)** | Zero TypeScript errors |
| Backend Strict Lint | `npm run lint -- --max-warnings=0` | **PASS (code 0)** | Zero ESLint warnings/errors |
| Frontend Typecheck | `npm run typecheck` | **PASS (code 0)** | Zero TypeScript errors |
| Frontend Lint | `npm run lint` | **PASS (code 0)** | Zero errors (only react hook hints) |
| Frontend Production Build | `npm run build` | **PASS (code 0)** | Clean build in 635ms |
| Production Bundle Mock Scan | `rg -i "handleMock\|mock/handlers\|mockDatabase\|mockNotification\|VITE_USE_MOCK" dist/` | **PASS (code 1)** | Exactly 0 matches found (clean bundle) |
| Real-Stack Playwright Suite (Run 1) | `npx playwright test tests/e2e/notifications.spec.ts` | **PASS (16/16)** | 16 passed across desktop-1280 & desktop-1440 in 45.8s |
| Real-Stack Playwright Suite (Run 2) | `npx playwright test tests/e2e/notifications.spec.ts` | **PASS (16/16)** | 16 passed consecutively in 44.8s (idempotent rerunnability proven) |
| Direct Live 4-Group Matrix & Exact Cleanup | Inline tested PowerShell command | **PASS (code 0)** | CM, HT, Owner, Groom verified; 0 for Vet, 0 for Unrelated; 0 residue; baseline restored |
| Backend-Down UI Error Check | Playwright navigation & route abort | **PASS** | Explicit error banner on `/login` and `/audit`; 0 mock alerts |
| Restart Persistence Check | DB / API inspection across reboot | **PASS** | Extended lock and audit state intact across process reboot |
| Baseline Restoration Check | PostgreSQL query | **PASS** | Horse `RESTING`/`false`; Owner notify restored to `{lockLifted: false, ...}` |
| Git Diff Cleanliness | `git diff --check` (BE & FE) | **PASS (code 0)** | Zero whitespace or formatting conflicts |

---

## R-1 & R-3: Positive Live 4-Group Audience & Isolation Evidence

### Target Horse Baseline Setup
- **Target Horse:** `Crimson Flash` (UUID: `ee44e633-ea53-4783-bbab-e3bd826a5320`, Code: `HR-000014`)
- **Captured Baseline State:** `status: RESTING`, `isMedicalLocked: false` (captured dynamically before any mutations)
- **Active Owner:** `Robert Sterling` (`owner@gmail.com`, UUID: `8808d50b-1ccb-478f-9771-5b40a7b274b1`, Role: `HORSE_OWNER`)
- **Captured Owner Preference Baseline:** `notify: { lockLifted: false, dailyDigest: false, raceResults: true, thresholdAlert: false }`
- **Active Stall Allocation:** ID `alloc-ee44e633-ea53-4783-bbab-e3bd826a5320` (`isActive: true`)
- **Active Assigned Groom:** `John Smith (Groom Hand)` (`groom@gmail.com`, UUID: `8d19fece-09f1-46a1-8830-0420a0b07ac6`, Role: `GROOM`)
- **Unrelated Owner:** `Phan Đức Long` (`owner2@gmail.com`, Role: `HORSE_OWNER`)
- **Unrelated Groom:** `groom2@gmail.com` (Role: `GROOM`)
- **Acting Veterinarian:** `Dr. Nguyen Van A` (`vet@gmail.com`, Role: `VETERINARIAN`)
- **Club Manager:** `Michael Tran` (`manager@gmail.com`, Role: `CLUB_MANAGER`)
- **Head Trainer:** `Alex Nguyen` (`trainer@gmail.com`, Role: `HEAD_TRAINER`)

### Root Cause Analysis: Previous Incomplete Evidence vs Live-Data Drift
1. **Incomplete Evidence in Test Harness:**
   The earlier test script asserted delivery against `owner@gmail.com` and `groom@gmail.com`, but selected the horse `Ironclad Titan` which was owned by `owner2@gmail.com` and groomed by `groom2@gmail.com`. Because the test script checked the wrong recipient addresses, it reported only 2 notifications (CM and HT). In PostgreSQL, `Ironclad Titan` had actually dispatched events to `owner2` and `groom2`.
2. **Live-Data Drift in PostgreSQL User Preferences:**
   In PostgreSQL, `owner@gmail.com`'s user row contained `"notify": { "lockLifted": false, ... }` caused by earlier notification settings toggle testing. When `LOCK_LIFTED` was dispatched, `NotificationsService.notifyUsers` respected user preferences:
   ```typescript
   const settingKey = SETTING_OF[input.type]; // 'lockLifted'
   return stored[settingKey] ?? defaultNotify(u.role)[settingKey];
   ```
   Because `stored['lockLifted'] === false`, `owner@gmail.com` was excluded from `LOCK_LIFTED` events. Restoring `owner@gmail.com`'s preference via `PUT /api/me/notifications` `{ key: 'lockLifted', value: true }` restored delivery.
3. **Application Defect Assessment:**
   The backend code in `medical-locks.service.ts` correctly delegates to `notifyHorse(horseId, { roles: [Role.HEAD_TRAINER, Role.CLUB_MANAGER], owner: true, groom: true }, input, actorId)` with `excludeUserId: actor.userId`. There was **no application defect**; the discrepancy was entirely attributable to incomplete test evidence and live-data preference drift. No out-of-scope files were modified.

### Live 4-Group Delivery & Isolation Matrix

| Lifecycle Action | CM (`manager@gmail.com`) | HT (`trainer@gmail.com`) | Actual Owner (`owner@gmail.com`) | Assigned Groom (`groom@gmail.com`) | Acting Vet (`vet@gmail.com`) | Unrelated Owner (`owner2@gmail.com`) | Unrelated Groom (`groom2@gmail.com`) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LOCK_PLACED** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **0 (EXCLUDED)** | **0 (ISOLATED)** | **0 (ISOLATED)** |
| **LOCK_EXTENDED** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **0 (EXCLUDED)** | **0 (ISOLATED)** | **0 (ISOLATED)** |
| **LOCK_LIFTED** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **RECEIVED (1)** | **0 (EXCLUDED)** | **0 (ISOLATED)** | **0 (ISOLATED)** |

- **Total Notifications Generated:** Exactly 12 across all 3 events (4 placed + 4 extended + 4 lifted).
- **Exact Recipient Set Verified:** Sorted recipient emails for each event match `['groom@gmail.com', 'manager@gmail.com', 'owner@gmail.com', 'trainer@gmail.com']`.
- **Strict Negative Isolation Verified:** Acting Veterinarian received 0 self-generated notifications across all three events. Unrelated Owner (`owner2`) and Unrelated Groom (`groom2`) received 0 notifications for the target horse.

---

## R-2: Tested Inline PowerShell Reproduction Command

The command below uses a PowerShell single-quoted here-string (`@' ... '@ | node`), which preserves all literal JavaScript `$transaction` and `$disconnect` calls without PowerShell variable expansion. It runs portably from `Racehorse_Training_Management_System_MT_BE` using `require('@prisma/client')` without absolute paths, includes full HTTP status/body assertions, tests all 4 groups, cleans up exact IDs atomically, and restores both the horse state and the original notification preference baseline.

```powershell
# Run from Racehorse_Training_Management_System_MT_BE:
@'
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
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

(async () => {
  const runMarker = `AUDIENCE_VERIFY_${Date.now()}`;
  const runStartTime = new Date();
  console.log('=== Starting Real-Stack Four-Group Verifier ===');
  console.log('Run marker:', runMarker);

  // 1. Dynamic resolution of target horse by horseCode
  const horse = await prisma.horse.findUnique({
    where: { horseCode: 'HR-000014' },
    include: {
      owner: { select: { id: true, email: true, status: true } },
      stallAllocations: {
        where: { isActive: true },
        include: { assignedGroom: { select: { id: true, email: true, status: true } } },
      },
    },
  });
  if (!horse) throw new Error('Target horse HR-000014 not found');
  if (!horse.owner || horse.owner.email !== 'owner@gmail.com') {
    throw new Error(`Target horse HR-000014 owner mismatch: expected owner@gmail.com, got ${horse.owner?.email}`);
  }
  const currentAllocation = horse.stallAllocations?.[0];
  if (!currentAllocation?.assignedGroom || currentAllocation.assignedGroom.email !== 'groom@gmail.com') {
    throw new Error(`Target horse HR-000014 groom mismatch: expected groom@gmail.com, got ${currentAllocation?.assignedGroom?.email}`);
  }

  const baselineHorseStatus = horse.status;
  const baselineIsMedicalLocked = horse.isMedicalLocked;

  const ownerUser = await prisma.user.findUnique({ where: { email: 'owner@gmail.com' } });
  const baselineOwnerNotify = JSON.parse(JSON.stringify(ownerUser.notify));

  console.log(`Resolved horse ${horse.name} (${horse.horseCode}) ID: ${horse.id}`);
  console.log(`Baseline horse state: status=${baselineHorseStatus}, isMedicalLocked=${baselineIsMedicalLocked}`);
  console.log(`Baseline owner notify preference: ${JSON.stringify(baselineOwnerNotify)}`);

  // R-1: Snapshot notification IDs only for target horse and event types LOCK_PLACED, LOCK_EXTENDED, LOCK_LIFTED
  const preNotifs = await prisma.notification.findMany({
    where: {
      type: { in: ['LOCK_PLACED', 'LOCK_EXTENDED', 'LOCK_LIFTED'] },
      OR: [
        { params: { path: ['horse'], equals: horse.name } },
        { message: { contains: horse.name } },
      ],
    },
    select: { id: true },
  });
  const scopedPreNotifIds = preNotifs.map(n => n.id);
  console.log(`Scoped pre-existing notifications count for ${horse.name}: ${scopedPreNotifIds.length}`);

  // R-2: Snapshot relevant pre-existing audit IDs before mutation
  const preAudits = await prisma.auditLog.findMany({
    where: {
      entityId: horse.id,
      action: 'HORSE_STATUS_CHANGED',
    },
    select: { id: true },
  });
  const scopedPreAuditIds = preAudits.map(a => a.id);
  console.log(`Scoped pre-existing HORSE_STATUS_CHANGED audits count for ${horse.name}: ${scopedPreAuditIds.length}`);

  let createdLockId = null;
  let verifierError = null;

  // Outer try/finally begins BEFORE mutating owner notify preference
  try {
    // Temporarily enable lockLifted preference for owner
    await prisma.user.update({
      where: { email: 'owner@gmail.com' },
      data: { notify: { ...baselineOwnerNotify, lockLifted: true } }
    });

    // Authenticate as Vet via real API (HTTP 200)
    const loginRes = await request('POST', '/api/auth/login', { email: 'vet@gmail.com', password: 'EquiFlow@2026' });
    if (loginRes.status !== 200 || !loginRes.body?.data?.accessToken) {
      throw new Error(`Vet login failed with HTTP ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }
    const vetToken = loginRes.body.data.accessToken;

    // 1. Create Medical Lock (LOCK_PLACED, HTTP 201)
    const createRes = await request('POST', '/api/medical/locks', {
      horseId: horse.id,
      expectedRestDays: 7,
      lockReason: 'Routine joint examination',
      appliedMedicalStatus: 'RESTING',
      unlockConditions: 'Post-exam flexion negative'
    }, vetToken);
    if (createRes.status !== 201 || !createRes.body?.data?.id) {
      throw new Error(`Create medical lock failed with HTTP ${createRes.status}: ${JSON.stringify(createRes.body)}`);
    }
    createdLockId = createRes.body.data.id;
    console.log(`Medical lock created: ID=${createdLockId}`);

    // 2. Extend Medical Lock (LOCK_EXTENDED, HTTP 200)
    const extendRes = await request('POST', `/api/medical/locks/${createdLockId}/extend`, {
      additionalDays: 3,
      recheckNotes: 'Further rest recommended'
    }, vetToken);
    if (extendRes.status !== 200 || !extendRes.body?.data?.id) {
      throw new Error(`Extend medical lock failed with HTTP ${extendRes.status}: ${JSON.stringify(extendRes.body)}`);
    }
    console.log(`Medical lock extended: ID=${createdLockId}`);

    // 3. Release Medical Lock (LOCK_LIFTED, HTTP 200)
    const releaseRes = await request('POST', `/api/medical/locks/${createdLockId}/release`, {
      unlockReason: 'Horse cleared to resume light training',
      newHorseStatus: baselineHorseStatus
    }, vetToken);
    if (releaseRes.status !== 200 || !releaseRes.body?.data?.id) {
      throw new Error(`Release medical lock failed with HTTP ${releaseRes.status}: ${JSON.stringify(releaseRes.body)}`);
    }
    console.log(`Medical lock released: ID=${createdLockId}`);

    // R-1: Capture generated notifications using scoped query (id not in scopedPreNotifIds)
    const newNotifs = await prisma.notification.findMany({
      where: {
        type: { in: ['LOCK_PLACED', 'LOCK_EXTENDED', 'LOCK_LIFTED'] },
        OR: [
          { params: { path: ['horse'], equals: horse.name } },
          { message: { contains: horse.name } },
        ],
        id: { notIn: scopedPreNotifIds },
      },
      include: { user: true }
    });
    console.log(`Captured ${newNotifs.length} new notifications generated during run.`);

    const expectedRecipients = ['groom@gmail.com', 'manager@gmail.com', 'owner@gmail.com', 'trainer@gmail.com'];
    const negativeRecipients = ['vet@gmail.com', 'owner2@gmail.com', 'groom2@gmail.com'];

    // Assert exact 4-group audience for each event
    for (const eventType of ['LOCK_PLACED', 'LOCK_EXTENDED', 'LOCK_LIFTED']) {
      const eventNotifs = newNotifs.filter(n => n.type === eventType);
      const actualRecipients = eventNotifs.map(n => n.user.email).sort();
      console.log(`Event ${eventType}: recipients = ${JSON.stringify(actualRecipients)}`);
      if (JSON.stringify(actualRecipients) !== JSON.stringify(expectedRecipients.slice().sort())) {
        throw new Error(`Recipient mismatch for ${eventType}: expected ${JSON.stringify(expectedRecipients)}, got ${JSON.stringify(actualRecipients)}`);
      }
    }

    // Assert zero leakage to negative actors
    for (const neg of negativeRecipients) {
      const count = newNotifs.filter(n => n.user.email === neg).length;
      if (count !== 0) {
        throw new Error(`Audience isolation leak: ${neg} received ${count} notifications`);
      }
    }
    console.log('Four-group positive audience and negative isolation assertions PASSED.');

  } catch (err) {
    verifierError = err;
    console.error('Verifier execution error:', err.message);
  } finally {
    console.log('--- Entering Unconditional Cleanup & Baseline Restoration ---');
    let cleanupError = null;

    try {
      // R-1: Capture any new notifications created during the run within the scoped query
      const notifsToClean = await prisma.notification.findMany({
        where: {
          type: { in: ['LOCK_PLACED', 'LOCK_EXTENDED', 'LOCK_LIFTED'] },
          OR: [
            { params: { path: ['horse'], equals: horse.name } },
            { message: { contains: horse.name } },
          ],
          id: { notIn: scopedPreNotifIds },
        },
        select: { id: true }
      });
      const notifIds = notifsToClean.map(n => n.id);

      // R-2: Capture any audits created during the run matching lock actions or scoped status changes
      const auditsToClean = await prisma.auditLog.findMany({
        where: {
          OR: [
            ...(createdLockId
              ? [
                  {
                    entityId: createdLockId,
                    action: {
                      in: ['CREATE_MEDICAL_LOCK', 'EXTEND_MEDICAL_LOCK', 'RELEASE_MEDICAL_LOCK'],
                    },
                  },
                ]
              : []),
            {
              entityId: horse.id,
              action: 'HORSE_STATUS_CHANGED',
              id: { notIn: scopedPreAuditIds },
            },
          ],
        },
        select: { id: true }
      });
      const auditIds = auditsToClean.map(a => a.id);

      console.log(`Executing atomic cleanup: ${notifIds.length} notifications, ${auditIds.length} audits, lock ${createdLockId || 'none'}...`);

      const txOps = [];
      if (notifIds.length > 0) {
        txOps.push(prisma.notification.deleteMany({ where: { id: { in: notifIds } } }));
      }
      if (auditIds.length > 0) {
        txOps.push(prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } }));
      }
      if (createdLockId) {
        txOps.push(prisma.medicalLock.deleteMany({ where: { id: createdLockId } }));
      }
      txOps.push(
        prisma.horse.update({
          where: { id: horse.id },
          data: { status: baselineHorseStatus, isMedicalLocked: baselineIsMedicalLocked }
        })
      );
      txOps.push(
        prisma.user.update({
          where: { email: 'owner@gmail.com' },
          data: { notify: baselineOwnerNotify }
        })
      );

      await prisma.$transaction(txOps);

      // Verify zero residue and exact restoration
      const remNotifs = notifIds.length > 0
        ? await prisma.notification.count({ where: { id: { in: notifIds } } })
        : 0;
      const remLock = createdLockId
        ? await prisma.medicalLock.count({ where: { id: createdLockId } })
        : 0;
      const remAudits = auditIds.length > 0
        ? await prisma.auditLog.count({ where: { id: { in: auditIds } } })
        : 0;

      const restoredHorse = await prisma.horse.findUnique({
        where: { id: horse.id },
        select: { status: true, isMedicalLocked: true }
      });
      const restoredOwner = await prisma.user.findUnique({
        where: { email: 'owner@gmail.com' },
        select: { notify: true }
      });

      if (remNotifs !== 0 || remLock !== 0 || remAudits !== 0) {
        throw new Error(`Residue detected after cleanup: ${remNotifs} notifs, ${remLock} locks, ${remAudits} audits`);
      }
      if (restoredHorse.status !== baselineHorseStatus || restoredHorse.isMedicalLocked !== baselineIsMedicalLocked) {
        throw new Error(`Horse baseline not restored: status=${restoredHorse.status}, isMedicalLocked=${restoredHorse.isMedicalLocked}`);
      }
      if (JSON.stringify(restoredOwner.notify) !== JSON.stringify(baselineOwnerNotify)) {
        throw new Error(`Owner notify baseline not restored: expected ${JSON.stringify(baselineOwnerNotify)}, got ${JSON.stringify(restoredOwner.notify)}`);
      }

      console.log('Zero residue and complete baseline restoration verified successfully.');
    } catch (cErr) {
      cleanupError = cErr;
      console.error('Cleanup error:', cErr.message);
    } finally {
      await prisma.$disconnect();
    }

    if (verifierError || cleanupError) {
      const combined = [verifierError?.message, cleanupError?.message].filter(Boolean).join(' | ');
      throw new Error(`Verifier failed: ${combined}`);
    }
  }

  console.log('=== Verifier Finished Successfully ===');
})().catch(err => {
  console.error('FATAL VERIFIER FAILURE:', err.message);
  process.exit(1);
});
'@ | node
```

### Verbatim Execution Output:
```
=== Starting Real-Stack Four-Group Verifier ===
Run marker: AUDIENCE_VERIFY_1792973623939
Resolved horse Crimson Flash (HR-000014) ID: ee44e633-ea53-4783-bbab-e3bd826a5320
Baseline horse state: status=RESTING, isMedicalLocked=false
Baseline owner notify preference: {"lockLifted":false,"dailyDigest":false,"raceResults":true,"thresholdAlert":false}
Scoped pre-existing notifications count for Crimson Flash: 36
Scoped pre-existing HORSE_STATUS_CHANGED audits count for Crimson Flash: 8
Medical lock created: ID=815fbadc-5b34-44f0-95f2-fcbdd1131321
Medical lock extended: ID=815fbadc-5b34-44f0-95f2-fcbdd1131321
Medical lock released: ID=815fbadc-5b34-44f0-95f2-fcbdd1131321
Captured 12 new notifications generated during run.
Event LOCK_PLACED: recipients = ["groom@gmail.com","manager@gmail.com","owner@gmail.com","trainer@gmail.com"]
Event LOCK_EXTENDED: recipients = ["groom@gmail.com","manager@gmail.com","owner@gmail.com","trainer@gmail.com"]
Event LOCK_LIFTED: recipients = ["groom@gmail.com","manager@gmail.com","owner@gmail.com","trainer@gmail.com"]
Four-group positive audience and negative isolation assertions PASSED.
--- Entering Unconditional Cleanup & Baseline Restoration ---
Executing atomic cleanup: 12 notifications, 5 audits, lock 815fbadc-5b34-44f0-95f2-fcbdd1131321...
Zero residue and complete baseline restoration verified successfully.
=== Verifier Finished Successfully ===
```
**Exit code:** `0`

---

## Detailed Step-by-Step Manual QA Procedure for Reviewer

To independently verify TASK-010 from the UI and API:

### 1. Automated Verification Checks
In `Racehorse_Training_Management_System_MT_BE`:
```bash
npm test -- src/medical
npm run typecheck
npm run lint -- --max-warnings=0
```
In `Racehorse_Training_Management_System_MT_FE`:
```bash
npm run typecheck
npm run lint
npm run build
rg -i "handleMock|mock/handlers|mockDatabase|mockNotification|VITE_USE_MOCK" dist/
```
*(Verify `rg` outputs 0 matches).*

### 2. Real-Stack Playwright Suite
With NestJS backend running on `localhost:3000`:
```bash
npx playwright test tests/e2e/notifications.spec.ts
```
*(Verify all 16 tests pass consecutively).*

### 3. Four-Inbox Manual Inspection
1. Log in to `http://localhost:5173/login` as Veterinarian (`vet@gmail.com` / `EquiFlow@2026`).
2. Navigate to Medical Records, select `Crimson Flash`, and place a Training Lock.
3. Open four separate private/incognito browser windows:
   - Window A: Log in as Club Manager (`manager@gmail.com`). Check Notifications bell and `/notifications`. Confirm `Training Lock placed` notification is present.
   - Window B: Log in as Head Trainer (`trainer@gmail.com`). Check `/notifications`. Confirm `Training Lock placed` notification is present.
   - Window C: Log in as Horse Owner (`owner@gmail.com`). Check `/notifications`. Confirm `Training Lock placed` notification is present. Confirm no administrative notices (registration/permission requests) appear.
   - Window D: Log in as Groom (`groom@gmail.com`). Check `/notifications`. Confirm `Training Lock placed` notification is present.
4. Back in the Veterinarian window:
   - Check `/notifications`: confirm the acting Veterinarian receives 0 self-generated notifications.
5. In a fifth window, log in as unrelated owner (`owner2@gmail.com`):
   - Confirm 0 notifications for `Crimson Flash` appear.
6. Extend and Release the lock as Veterinarian; observe that `Training Lock extended` and `Training Lock lifted` appear in all four inboxes, with 0 for Veterinarian and 0 for unrelated users.

### 4. Backend-Down UI Error Check
1. Stop the NestJS backend process (e.g., kill terminal on port 3000).
2. Visit `http://localhost:5173/login` and submit credentials.
   - Confirm error alert: *"Cannot reach the server. Please check your connection."*
   - Confirm the page remains on `/login` without mock authentication fallback.
3. Visit `http://localhost:5173/audit`.
   - Confirm explicit error alert: *"Audit history could not be loaded. Check your connection and try again."*
   - Confirm no "Demo audit history" banner is shown.

---

## Conclusion & Gate Status

TASK-010 has resolved all concerns cited in the rejection:
- **R-1 (Exact Scoped Notification Cleanup):** Pre-mutation snapshot records only notification IDs for target horse `Crimson Flash` (code: `HR-000014`) and event types `LOCK_PLACED`, `LOCK_EXTENDED`, `LOCK_LIFTED`. Post-test cleanup queries the same scoped filter with `id: { notIn: scopedPreNotifIds }` unconditionally (empty snapshot works correctly on fresh tables without conditional omit). Captures all 12 generated records including `LOCK_LIFTED` rows without test markers in production messages. Deletes only exact generated IDs and asserts zero residue.
- **R-2 (Exact Scoped Audit Cleanup):** Pre-mutation snapshot records existing `HORSE_STATUS_CHANGED` audits for the target horse (`scopedPreAuditIds`). Post-test cleanup queries only audits whose action/entity match this test: `CREATE_MEDICAL_LOCK`, `EXTEND_MEDICAL_LOCK`, `RELEASE_MEDICAL_LOCK` for `createdLockId`, and `HORSE_STATUS_CHANGED` for target horse `notIn: scopedPreAuditIds`. No broad `timestamp >= runStartTime` filter. Exactly 5 audits deleted with zero residue.
- **R-3 (Canonical PowerShell Verifier & Full Validation):** The canonical verifier in `reports/TASK-010.md` uses the exact same scoped before/after-ID logic, preserving cleanup-always, owner preference restoration, dynamic `horseCode` resolution, and clinical-note privacy. Both Playwright test runs passed 16/16 consecutively. All backend and frontend quality gates pass cleanly with zero lint/typecheck errors, clean bundle scan, and clean git diff.

Execution has completed and TASK-010 is **DONE** following explicit human approval (`APPROVE TASK-010` on 2026-10-26). Execution is **IDLE** awaiting authorization or start for the next eligible task (TASK-011).
No commits, pushes, or starts of TASK-011 have been performed.
