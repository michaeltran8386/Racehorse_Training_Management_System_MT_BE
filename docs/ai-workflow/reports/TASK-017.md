# TASK-017 — Execution Report

| Parameter | Value |
| :--- | :--- |
| **Task** | TASK-017 — Incident→Vet→Lock round trip |
| **Plan Version** | v1-approved-r22 |
| **Status** | DONE |
| **Authorizing Commands** | `START TASK-017` (2026-10-28 20:30 Asia/Bangkok)<br>`REJECT TASK-017` round-trip re-verification (2026-10-28 22:05 Asia/Bangkok)<br>`REJECT TASK-017` isolation re-verification (2026-10-28 23:10 Asia/Bangkok)<br>`REJECT TASK-017` indirect mutations re-verification (2026-10-28 23:43 Asia/Bangkok)<br>`REJECT TASK-017` correlated notification/audit isolation re-verification (2026-10-29 00:09 Asia/Bangkok)<br>`APPROVE TASK-017` (2026-10-29 00:45 Asia/Bangkok) |
| **Active Task / Next Task** | `NONE` / `TASK-018` (TODO, unauthorized) |
| **Authorized Scope Budget** | Maximum 5 files per repository |
| **Modified Application & Test Files** | **Backend (1 file):**<br>1. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-services.spec.ts`<br>**Frontend (4 files):**<br>2. `Racehorse_Training_Management_System_MT_FE/src/features/stable/components/IncidentDetailModal.tsx`<br>3. `Racehorse_Training_Management_System_MT_FE/src/features/stable/pages/IncidentListPage.tsx`<br>4. `Racehorse_Training_Management_System_MT_FE/src/features/health/pages/TrainingLockPage.tsx`<br>5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`<br>**Simulator (1 file):**<br>6. `Racehorse_Simulator_Web/src/ui/TrialTab.tsx` |
| **Canonical Simulator** | `Racehorse_Simulator_Web` (Port 5175) |
| **Reference Directory (Untouched)** | `Racehorse_Simulator_Web_v3` (0 modifications, 0 references) |
| **Preserved Root Scripts** | `setup-db.bat`, `start.bat`, `stop.bat` (0 modifications, untouched) |
| **Preserved Historical Evidence** | `task016_live_monitor_telemetry.png`, `task016_simulator_emergency_stop.png` (byte-for-byte restored to committed HEAD, 0 uncommitted modifications) |
| **Real Stack Under Test** | NestJS Backend (`http://localhost:3000`), PostgreSQL Docker (`equiflow:5432`), Frontend (`http://localhost:5173`), Canonical Simulator (`http://localhost:5175`) |

---

## 1. Summary of Implementation & Non-Destructive Invariants

TASK-017 proves the complete round-trip flow from an advisory incident reported via Simulator Socket.IO through clinical review by a licensed Veterinarian, creation of a Medical Record, explicit placement of a Medical Lock in Main-Web UI, real-time lock synchronization to the active Simulator session, and subsequent lock lift:

### 1.1 Strictly Non-Destructive Fixture Isolation & Indirect Mutation Preservation (R-6 & R-10)
- **Elimination of Broad Deletions:** All pre-test `deleteMany` operations that previously targeted entities by `targetHorseId` or broad notification attributes (`category: 'MEDICAL'`, `title: { contains: 'SIMULATOR' }`) have been completely removed.
- **Snapshot Baseline State:** Before any test mutation, the test snapshots:
  - Reused horse's exact attributes (`status`, `isMedicalLocked`, `ownerId`, `assignedGroomUserId`).
  - Pre-existing entity ID arrays (`preRegIds`, `preLockIds`, `preRecordIds`, `preIncidentIds`).
  - Pre-existing heavy/BREEZE/TRIAL `WorkoutSession` rows for `targetHorseId` (`preWorkoutSnapshots`: `id`, `status`, `statusReason`).
  - Pre-existing `Notification` IDs (`preNotificationIds`) and `AuditLog` IDs (`preAuditLogIds`).
- **Protected Boundary:** All fixture creation, mutations, and API requests execute inside a single `try / finally` boundary.
- **Correlated-Only Cleanup & Concurrency Preservation:**
  - Never deletes rows solely because their IDs were absent from the pre-test snapshot (`where: { id: { notIn: ... } }` completely eliminated).
  - Test-owned rows identified using exact created incident/record/lock/session/workout IDs, unique `TEST_MARKER`, and actual correlation fields (`createdNotificationIds`, `createdIncidentNumber`, `placedLockCode`, `correlatedEntityIds`).
  - Deletion strictly restricted to those correlated rows, preserving all unrelated notifications/audit records created concurrently by human activity or background schedulers (`IncidentsScheduler`).
- **Sentinel Concurrency Proof:**
  - Adds a sentinel unrelated `Notification` and `AuditLog` created after the snapshot carrying a unique `SENTINEL-CONCURRENT-...` marker.
  - Verifies that cleanup preserves both sentinels untouched across the full run (`preservedSentinelNotif` and `preservedSentinelAudit` confirmed truthy).
  - Deletes only the sentinels by exact ID afterward and asserts post-delete null.
- **Exact Restoration & Residue Assertions:**
  - `postRegIds.toEqual(preRegIds)`
  - `postLockIds.toEqual(preLockIds)`
  - `postRecordIds.toEqual(preRecordIds)`
  - `postIncidentIds.toEqual(preIncidentIds)`
  - `postWorkoutSnapshots.toEqual(preWorkoutSnapshots)` (accepted workout snapshot/restoration)
  - `postNotifsForPre.length === preNotificationIds.length` (all pre-existing notification rows remain present)
  - `postAuditsForPre.length === preAuditLogIds.length` (all pre-existing audit rows remain present)
  - `residueNotifs.length === 0` (zero test-correlated notification residue)
  - `residueAudits.length === 0` (zero test-correlated audit residue)

### 1.2 Exact Incident Notification Routing (R-7)
- **Direct Incident Correlation:** Notifications are matched directly to the created incident via `(n.params as any)?.incidentNumber === incident.incidentNumber` (not by broad category or historical title).
- **Intended Audience Verification:** For the `MODERATE` simulator incident (lameness), the test verifies that notifications are created exclusively for:
  - Intended Veterinarian: `qa-vet1@gmail.com` (`TARGET_VET_EMAIL`)
  - Intended Groom: assigned groom for the horse (`initialGroomUserId`)
  - Intended Owner: owner of the horse (`initialOwnerId`)
- **Unintended Recipient Guard:** Verifies that neither Head Trainers (`HEAD_TRAINER`) nor Club Managers (`CLUB_MANAGER`) receive notifications for moderate incidents (CR-001 rule). Every recipient's role is strictly asserted to be within `['VETERINARIAN', 'GROOM', 'HORSE_OWNER']`.

### 1.3 Preservation of Historical Evidence & Out-of-Scope Files (R-8)
- Reverted unrelated date/time edits in historical TASK-013 test lines of `simulator-real-stack.spec.ts` back to their committed HEAD values (`2026-10-28` and `19:45`).
- Restored `docs/ai-workflow/evidence/task016_live_monitor_telemetry.png` and `docs/ai-workflow/evidence/task016_simulator_emergency_stop.png` byte-for-byte to their committed HEAD revisions.
- Focused Playwright execution targets `-g "TASK-017"` to prevent overwriting prior-task screenshot artifacts.

### 1.4 Real Application Contracts (R-1 through R-3)
- **Live Workout Start:** Starts scheduled heavy trial workout via live NestJS API `POST /api/simulator/workouts/${workout.id}/start` with Trainer Bearer token.
- **Canonical Simulator Connection:** Connects Simulator via Backend-issued `sessionId` and starts trial.
- **Real Incident Reporting:** Clicks `! Khập khiễng` to emit `sim:incident_report` over real Socket.IO.
- **No Automatic Record/Lock:** Verifies PostgreSQL `IncidentReport` is created while `MedicalRecord` and `MedicalLock` counts remain equal to pre-existing baseline (`isMedicalLocked: false`).
- **Explicit Vet Clinical Review & Medical Action:**
  - Vet reviews incident in Main Web (`/incidents`), updates status to `UNDER_REVIEW` with clinical notes.
  - Vet clicks `Create Medical Record` shortcut (`/medical/records/new?horseId=${targetHorseId}`), submits `Save & Finalize`, and verifies PostgreSQL persistence for the target horse.
  - Vet clicks `Place Training Lock` shortcut (`/locks?horseId=${targetHorseId}&action=place`), confirms lock, and verifies PostgreSQL `MedicalLock` and `isMedicalLocked: true`.
- **Lock Enforcement & Safe Lift:**
  - Active Simulator session receives `sys:medical_lock_sync`, displays `Đang bị Medical Lock`, and disables heavy intensity.
  - Live NestJS API rejects future heavy workout start with HTTP 409 `ConflictException` (`MEDICAL_LOCK_ACTIVE`).
  - Live NestJS API rejects future tournament registration with HTTP 400 `BadRequestException` (`MEDICAL_LOCK_ACTIVE`).
  - Vet lifts lock via Main Web `/locks`; Simulator receives `sys:medical_lock_sync` (`medical_lock: false`) and dismisses banner.
  - Active runner pace remains at safe `LIGHT` intensity and does not automatically resume unsafe heavy work.

---

## 2. Automated Test Results & Verification Evidence

### 2.1 Focused TASK-017 Playwright Suite (`tests/e2e/simulator-real-stack.spec.ts`)
```powershell
npx playwright test -g "TASK-017"
```
- `[desktop-1280] › TASK-017: Incident -> Vet review -> Medical Record & Lock -> Round-trip enforcement & lift`: **PASS (18.0s)**
- `[desktop-1440] › TASK-017: Incident -> Vet review -> Medical Record & Lock -> Round-trip enforcement & lift`: **PASS (14.9s)**
- **Result:** **2 passed (36.3s, Exit code: 0)**

### 2.2 Backend Unit & Integration Tests
```powershell
npm test -- src/medical/medical-services.spec.ts src/incidents/incidents.service.spec.ts
```
- `src/incidents/incidents.service.spec.ts`: **14 passed**
- `src/medical/medical-services.spec.ts`: **37 passed**
- **Result:** **51 passed, 51 total across 2 suites (Exit Code: 0, 5.4s runtime)**

### 2.3 Quality Gates & Lints
- **Backend Typecheck:** `npm run typecheck` in `Racehorse_Training_Management_System_MT_BE` -> **Exit code: 0 (0 type errors)**
- **Backend Lint:** `npm run lint` in `Racehorse_Training_Management_System_MT_BE` -> **Exit code: 0 (0 errors, 0 warnings)**
- **Frontend Typecheck:** `npm run typecheck` in `Racehorse_Training_Management_System_MT_FE` -> **Exit code: 0 (0 type errors)**
- **Frontend Lint:** `npm run lint` in `Racehorse_Training_Management_System_MT_FE` -> **Exit code: 0 (0 errors)**
- **Simulator Tests:** `npm test` in `Racehorse_Simulator_Web` -> **148 passed, 148 total (Exit Code: 0)**
- **Simulator Typecheck & Build:** `npm run typecheck && npm run build` in `Racehorse_Simulator_Web` -> **Exit code: 0 (Build clean)**
- **Whitespace & Git Diff Verification (`git diff --check`):**
  - `Racehorse_Training_Management_System_MT_BE`: Clean (Exit code: 0)
  - `Racehorse_Training_Management_System_MT_FE`: Clean (Exit code: 0)
  - `Racehorse_Simulator_Web`: Clean (Exit code: 0)
- **Evidence Integrity:** `git status --short docs/ai-workflow/evidence/` -> Clean (0 untracked/modified files)

---

## 3. Human QA Acceptance Procedure

To verify TASK-017 manually on the running local stack:

### Scenario 1: Non-Destructive Advisory Incident & Routing
1. Open the canonical Simulator at `http://localhost:5175`.
2. Connect or start a running trial workout session for horse *QA Zephyr Wind* (`QA-HR-000001`).
3. While the horse is running, click **"! Khập khiễng"** (Lameness).
4. **Expected:**
   - Simulator emits `sim:incident_report`.
   - PostgreSQL creates `IncidentReport` with `status: 'REPORTED'` and `severity: 'MODERATE'`.
   - Notifications are dispatched strictly to the assigned Groom (`qa-groom1@gmail.com`), Horse Owner (`qa-owner1@gmail.com`), and Veterinarians (`qa-vet1@gmail.com`).
   - Head Trainers and Club Managers do **not** receive this notification.
   - The horse's `isMedicalLocked` remains `false`. No `MedicalRecord` or `MedicalLock` is automatically created.

### Scenario 2: Vet Review & Medical Actions
1. Sign in to Main Web (`http://localhost:5173`) as Veterinarian (`qa-vet1@gmail.com` / `EquiFlow@2026`).
2. Navigate to `/incidents` (`http://localhost:5173/incidents`).
3. Click **"Review & Prescribe"** on the incident card.
4. Set status **"UNDER_REVIEW"**, enter notes, and submit. Status updates to `UNDER_REVIEW`.
5. Open the modal again and click **"📋 Create Medical Record"** (`incident-action-create-record`).
   - Navigates to `/medical/records/new?horseId=<horseId>`.
   - Fill examination findings and diagnosis, then click **"Save & Finalize"**.
   - Verify record is saved in PostgreSQL for the target horse. The horse remains unlocked.
6. Return to `/incidents` or click **"🔒 Place Training Lock"** (`incident-action-place-lock`).
   - Navigates to `/locks?horseId=<horseId>&action=place` with horse preselected.
   - Enter lock reason and confirm. Horse appears in Active Locks and `isMedicalLocked === true`.

### Scenario 3: Realtime Lock Enforcement & Safe Lift
1. Observe the connected Simulator at `http://localhost:5175`:
   - Simulator receives `sys:medical_lock_sync`.
   - Displays warning banner **"Đang bị Medical Lock"**.
   - Heavy and moderate intensity workout options are disabled.
2. In Main Web `/locks`, click **"Mở khóa"** (Lift Lock) next to the active lock.
3. Enter lift reason and confirm unlock.
4. **Expected:**
   - Lock moves to History (RELEASED) and `isMedicalLocked === false`.
   - Simulator receives `sys:medical_lock_sync` with `medical_lock: false`.
   - Warning banner disappears.
   - Active runner pace remains at safe light level without automatically resuming unsafe heavy action.

---

## 4. Gate State & Human Handoff

- **Execution Gate:** `IDLE`
- **Active Task:** `NONE`
- **Last Approved Task:** `TASK-017` (human-approved on 2026-10-29 via `APPROVE TASK-017`).
- **Next Task:** `TASK-018` (awaits explicit human command `START TASK-018`).
- **Approved Contract Enforced & Verified:**
  1. Strictly non-destructive fixture lifecycle with zero broad deletions, exact ID/marker cleanup, exact attribute restoration, indirect mutation preservation of pre-existing heavy workouts (R-10), exact baseline restoration of Notification and AuditLog IDs, and pre-existing state matching assertions.
  2. Exact notification routing tied to `incidentNumber` verifying Vet, Groom, and Owner recipients with 0 unintended recipients.
  3. Historical evidence PNGs byte-for-byte preserved to committed HEAD.
  4. Real-stack round-trip contracts across live NestJS API, Main-Web UI, and canonical Simulator Socket.IO verified on both viewports.
- TASK-017 is marked DONE. Execution is IDLE. AGY will STOP and await human command `START TASK-018`. Do not commit, push, merge, or proceed to TASK-018 without authorization.
