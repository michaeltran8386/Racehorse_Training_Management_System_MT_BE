# TASK-016 — Execution Report

| Parameter | Value |
| :--- | :--- |
| **Task** | TASK-016 — Web-created trial → SIM telemetry → persisted result/live monitor flow |
| **Plan Version** | v1-approved-r22 |
| **Status** | DONE (Human-Approved) |
| **Authorizing Command** | `START TASK-016` (2026-10-28 17:15 Asia/Bangkok); approved via `APPROVE TASK-016` (2026-10-28 20:00 Asia/Bangkok) |
| **Active Task / Next Task** | `NONE (IDLE)` / `TASK-017` (unauthorized; awaits `START TASK-017`) |
| **Authorized Scope Budget** | Exactly 11 application/test files (expanded via approved CR-023) |
| **Modified Application & Test Files** | 1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.ts`<br>2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.ts`<br>3. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts`<br>4. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.spec.ts`<br>5. `Racehorse_Simulator_Web/src/ui/TrialTab.tsx`<br>6. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/LiveMonitorPage.tsx`<br>7. `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`<br>8. `Racehorse_Training_Management_System_MT_BE/src/training/training-plans.service.ts`<br>9. `Racehorse_Training_Management_System_MT_BE/src/training/workouts.service.ts`<br>10. `Racehorse_Training_Management_System_MT_BE/src/training/training-services.spec.ts`<br>11. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/TrialRunsPage.tsx` |
| **Canonical Simulator** | `Racehorse_Simulator_Web` (Port 5175) |
| **Reference Directory (Untouched)** | `Racehorse_Simulator_Web_v3` (0 modifications, 0 references) |
| **Preserved Root Scripts** | `setup-db.bat`, `start.bat`, `stop.bat` (0 modifications, untouched) |
| **Real Stack Under Test** | NestJS Backend (`http://localhost:3000`), PostgreSQL Docker (`equiflow:5432`), Frontend (`http://localhost:5173`), Canonical Simulator (`http://localhost:5175`) |

---

## 1. Summary of Approved Implementation

TASK-016 completes the end-to-end integration flow between the Web application, Simulator real-time engine, Socket.IO gateway, PostgreSQL persistence, live telemetry monitor, and multi-trainer ownership boundaries (CR-022 & CR-023):

1. **Head Trainer Multi-Trainer Scoping & Fail-Closed Boundaries (`training-plans.service.ts` & `workouts.service.ts` / CR-023):**
   - **TrainingPlansService:**
     - `findAllPlans`: For `HEAD_TRAINER`, strictly filters `where.trainerUserId = user.userId`. Other trainers' plans are completely hidden. `CLUB_MANAGER` and `VETERINARIAN` retain club-wide visibility.
     - `findPlanById`: Scoped `HEAD_TRAINER` access. If the plan belongs to another trainer, returns HTTP 404 `PLAN_NOT_FOUND`.
     - `updatePlan`, `changePlanStatus`, `deletePlan`, `clonePlan`: Enforces `existing.trainerUserId !== user.userId` throws HTTP 403 `FORBIDDEN` (`"This plan belongs to another trainer."`).
   - **WorkoutsService:**
     - `createWorkout` & `createRepeatWorkouts`: Verifies `plan.trainerUserId !== user.userId` throws HTTP 403 `FORBIDDEN` (`"This plan belongs to another trainer."`).
     - `updateWorkout`, `recordResult`, `cancelWorkout`, `restoreWorkout`: Verifies `existing.trainingPlan?.trainerUserId !== user.userId` throws HTTP 403 `FORBIDDEN` (`"This workout belongs to another trainer."`).
     - `findAllWorkouts`: For `HEAD_TRAINER`, strictly scopes query by `where.trainingPlan = { trainerUserId: user.userId }`.
     - `findTrialRuns`: Automatically inherits `findAllWorkouts` trainer scoping.
     - `findWorkoutById`: Scoped `HEAD_TRAINER` access. If the workout's plan belongs to another trainer, returns HTTP 404 `WORKOUT_NOT_FOUND`.

2. **Trial Runs UI Date Auto-Expansion & Ownership Action Filtering (`TrialRunsPage.tsx` / CR-023):**
   - **Date Range Auto-Expansion on Save:**
     - When `WorkoutDialog` completes and triggers `onSaved(date)`:
       - If `savedDate < from`: updates `from` to `savedDate`.
       - If `savedDate > to`: updates `to` to `savedDate`.
       - Automatically invokes `load(nextFrom, nextTo)`, querying the expanded window so newly created trial runs are immediately rendered without manual filter adjustments.
   - **Actionable Simulation Control Guard:**
     - Action button "Chạy mô phỏng" is strictly guarded:
       `user.role === "HEAD_TRAINER" && row.status === "SCHEDULED" && plans.some((p) => p.id === row.planId)`.
     - Ensures the actionable button is never rendered for a workout owned by another trainer.

3. **Eligibility & Medical Rules Enforcement (`simulator.service.ts`):**
   - Head Trainer start verification strictly checks horse status:
     - Throws `HttpStatus.BAD_REQUEST` (`HORSE_RETIRED`, `'Ngựa đã ngừng quản lý.'`) when attempting to start a simulation for a retired horse.
     - Throws `HttpStatus.CONFLICT` (`MEDICAL_LOCK_ACTIVE`, `'A medical lock prevents this high-intensity workout.'`) when horse has active medical locks and the scheduled workout is high-intensity (`HEAVY` intensity or `TRIAL`/`DRILL`).

4. **Atomic Terminal Transition Between Finish and Abort (`simulator.service.ts` & `simulator.gateway.ts` / CR-022):**
   - Both normal finish (`recordFinished`) and abort (`abortSession`) compete for the exact same conditional atomic update in PostgreSQL:
     ```typescript
     tx.simulatorSession.updateMany({
       where: {
         id: sessionId,
         status: { in: [SimulatorSessionStatus.PENDING, SimulatorSessionStatus.RUNNING] },
       },
       data: { ... },
     })
     ```
   - Both return `{ session: SimulatorSession | null, transitioned: boolean }`:
     - If an abort occurs first, delayed normal finish finds 0 matching rows (`transitioned: false`) and does NOT overwrite `ABORTED_INJURY` or its abort reason.
     - If normal finish occurs first, delayed abort finds 0 matching rows (`transitioned: false`) and does NOT overwrite `COMPLETED` or its workout result.
   - **Gateway Single Wire Emit Guarantee:**
     - The gateway broadcasts `sim:session_finished` IF AND ONLY IF that operation won the transition (`transitioned: true`).
     - The losing operation suppresses broadcast, ensuring exactly one wire event and one persisted terminal outcome without relying on in-memory flags as substitute for DB transactions.

5. **15s Graceful Disconnect & 5m Session Timeout Handling (`simulator.gateway.ts` / CR-022):**
   - **15-Second Disconnect Grace Timer:**
     - On client disconnect, if the session is currently `RUNNING`, gateway schedules a 15-second grace timer (`disconnectTimers`).
     - If the client reconnects and authenticates within 15 seconds, the disconnect timer is automatically cancelled and the running session preserved.
     - If the timer expires without reconnection, `abortDueToDisconnect` transitions the session to `ABORTED_INJURY` with `abortReason: 'DISCONNECT_TIMEOUT_15S'`, cleans up active memory state, and broadcasts single notification.
   - **5-Minute Inactive Session Timeout:**
     - On first accepted telemetry tick, gateway registers an absolute 5-minute watchdog timer (`sessionTimeouts`).
     - If a session fails to finish within 5 minutes, `abortDueToSessionTimeout` marks the session `ABORTED_INJURY` with `abortReason: 'SESSION_TIMEOUT_5M'`.
   - **Resource Safety:**
     - All timers use `.unref?.()` and are cleanly cancelled on normal session completion (`recordFinished`), accepted abort, client reconnect within 15s, or module teardown (`onModuleDestroy`).

6. **Emergency Stop in Simulator Engine (`TrialTab.tsx`):**
   - When user clicks emergency stop or catastrophic injury occurs while running:
     - Sets run status to `"ABORTED_INJURY"` and halts runner velocity.
     - Emits `sim:session_finished` with `status: "ABORTED_INJURY"`.
     - Sets phase to `ABORTED` with alert notification.

7. **Defensive Live Telemetry Monitor (`LiveMonitorPage.tsx`):**
   - Made session telemetry rendering null-safe against incomplete legacy seed records or missing metrics.
   - Provides safe fallback display for sessions waiting on initial telemetry ticks (`"Waiting for the first telemetry packet..."`).
   - Correctly renders live 1 Hz metrics (speed in km/h, heart rate in bpm, body temperature in °C, stamina percentage, distance completed).

8. **Deterministic Fixture Cleanup & Teardown Architecture (`simulator-real-stack.spec.ts` / R-1 Resolution):**
   - Removed temporary `TARGET_WORKOUT_BASELINE_NOTES` assignment.
   - Retained deterministic seed `trainerNotes: 'Deterministic QA Head Trainer Trial Run'`.
   - Wrapped all test operations (cross-trainer attacks, baseline verification, Trainer-1 start) inside a strict `try { ... } finally { ... }` block that executes even if an assertion fails.
   - In `finally`:
     - Queries and deletes only `SimulatorSession` records created for `TARGET_WORKOUT_ID` by this test execution.
     - Restores `TARGET_WORKOUT_ID` to its deterministic seed state as defined by `seed-manual-qa.ts`: `status: 'SCHEDULED'`, `trainerNotes: 'Deterministic QA Head Trainer Trial Run'`, `statusReason: null`, `resultRecordedAt/resultRecordedById/resultUpdatedAt/resultUpdatedById: null`, and all result metrics (`actualDistanceMeters`, `actualTimeSeconds`, `actualSurface`, `trackCondition`, `heartRatePeak`, `heartRateRecovery`, `topSpeedKmh`, `performanceScore`, `completionLevel`, etc.) reset to `null`.
     - Asserts that the test-created session residue count is exactly zero (`expect(residueCount).toBe(0)`).
     - Verified that `seed-manual-qa.ts` was not modified.

---

## 2. Automated Test Results & Verification Evidence

### 2.1 Backend Training Services Unit Tests (`npm test -- src/training/training-services.spec.ts`)
- Command: `npm test -- src/training/training-services.spec.ts`
- Result: **55 passed, 55 total across 1 suite (Exit Code: 0)**
  - 14 CR-023 tests verifying Head Trainer ownership scoping and fail-closed mutations across `TrainingPlansService` and `WorkoutsService` (covering `HEAD_TRAINER`, `CLUB_MANAGER`, and `VETERINARIAN`).

### 2.2 Backend Simulator Test Suite (`npm test -- src/simulator/simulator.service.spec.ts src/simulator/simulator.gateway.spec.ts`)
- Command: `npm test -- src/simulator/simulator.service.spec.ts src/simulator/simulator.gateway.spec.ts`
- Result: **87 passed, 87 total across 2 suites (Exit Code: 0)**
  - `src/simulator/simulator.service.spec.ts`: **53 passed** (including atomic transition races and concurrent finish/abort tests).
  - `src/simulator/simulator.gateway.spec.ts`: **34 passed** (including 15s disconnect timers, 5m watchdog, and broadcast suppression).

### 2.3 Backend Quality Gates
- `npm run typecheck`: **Exit code 0 (0 type errors)**
- `npm run lint`: **Exit code 0 (0 errors, 0 warnings)**

### 2.4 Simulator Web Tests & Build
- `npm test`: **148 passed, 148 total across all suites (Exit Code: 0)**
- `npm run typecheck`: **Exit code 0 (0 type errors)**
- `npm run build`: **Exit code 0 (`tsc --noEmit && vite build` completed in 1.88s; generated `dist/assets/index-DvnFd2O7.js` 645 kB, `dist/assets/index-CoIVJD34.css` 49.5 kB)**

### 2.5 Frontend Quality Gates
- `npm run typecheck`: **Exit code 0 (0 type errors)**
- `npm run lint`: **Exit code 0 (0 errors)**

### 2.6 Playwright Real Chromium E2E Suite (`tests/e2e/simulator-real-stack.spec.ts`)
- Command: `npx playwright test tests/e2e/simulator-real-stack.spec.ts`
- Result: **26 passed, 26 total across desktop-1280 and desktop-1440 (Exit Code: 0)**
```
Running 26 tests using 1 worker

  ok  1 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:127:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-015: Direct access to port 5175 without session loads real catalogue from PostgreSQL without login screen (9.7s)
  ok  2 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:167:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Slice G: Trial Runs scheduling creates a TRIAL row visible after reload (4.8s)
  ok  3 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:230:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Head Trainer trial run: immutable setup, no obstacle authoring, stops at distance, DONE & summary, 1 finish packet & DB persistence (14.5s)
  ok  4 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:413:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Veterinarian exam: no intro, UI finish -> sim:exam_finished -> ACK -> return/close -> auto-load on focus (5.6s)
  ok  5 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:544:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › VitalsDisplay: displays within/outside reference range badges and disclaims health/injury/lock status (3.7s)
  ok  6 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:586:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Persistence and reload: Simulator and Main Web refetch latest data after page reload (6.2s)
  ok  7 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:615:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-12: Veterinarian exam on horse with absent master weight (QA T013 Exam Horse) (5.6s)
  ok  8 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:708:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-13: Medical record list displays real horse name and horse code without raw UUID fallback (3.7s)
  ok  9 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:737:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Emergency stop in Simulator stops running trial and persists ABORTED_INJURY once (9.6s)
  ok 10 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:806:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Medical lock blocks starting high-intensity workout and retired horse cannot be simulated (4.6s)
  ok 11 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:886:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Network disconnect for 15s marks running session ABORTED_INJURY in PostgreSQL (27.5s)
  ok 12 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:949:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016 / CR-023: Multi-trainer ownership scoping and fail-closed start check (9.5s)
  ok 13 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:1272:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016 / CR-023: TrialRunsPage auto-expands date filter onSaved and syncs with Weekly Calendar (6.0s)
  ok 14 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:127:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-015: Direct access to port 5175 without session loads real catalogue from PostgreSQL without login screen (7.4s)
  ok 15 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:167:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Slice G: Trial Runs scheduling creates a TRIAL row visible after reload (5.1s)
  ok 16 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:230:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Head Trainer trial run: immutable setup, no obstacle authoring, stops at distance, DONE & summary, 1 finish packet & DB persistence (14.3s)
  ok 17 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:413:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Veterinarian exam: no intro, UI finish -> sim:exam_finished -> ACK -> return/close -> auto-load on focus (5.8s)
  ok 18 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:544:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › VitalsDisplay: displays within/outside reference range badges and disclaims health/injury/lock status (3.6s)
  ok 19 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:586:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Persistence and reload: Simulator and Main Web refetch latest data after page reload (5.1s)
  ok 20 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:615:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-12: Veterinarian exam on horse with absent master weight (QA T013 Exam Horse) (6.4s)
  ok 21 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:708:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-13: Medical record list displays real horse name and horse code without raw UUID fallback (4.0s)
  ok 22 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:737:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Emergency stop in Simulator stops running trial and persists ABORTED_INJURY once (9.3s)
  ok 23 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:806:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Medical lock blocks starting high-intensity workout and retired horse cannot be simulated (5.1s)
  ok 24 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:886:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016: Network disconnect for 15s marks running session ABORTED_INJURY in PostgreSQL (27.6s)
  ok 25 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:949:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016 / CR-023: Multi-trainer ownership scoping and fail-closed start check (9.4s)
  ok 26 [desktop-1440] › tests\e2e\simulator-real-stack.spec.ts:1272:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-016 / CR-023: TrialRunsPage auto-expands date filter onSaved and syncs with Weekly Calendar (6.0s)

  26 passed (3.7m)
```

### 2.7 Post-Suite Deterministic Seed State & Zero-Residue Verification
Direct inspection of PostgreSQL database via Prisma client following execution of the Playwright test suite confirmed that `TARGET_WORKOUT_ID` (`00000000-0000-4000-a007-000000000003`) was completely restored to its clean deterministic seed baseline with zero residue:
- Verification command:
  ```powershell
  node -e 'const { PrismaClient } = require("../Racehorse_Training_Management_System_MT_BE/node_modules/@prisma/client"); const p = new PrismaClient(); async function main() { const s = await p.simulatorSession.findMany({ where: { workoutSessionId: "00000000-0000-4000-a007-000000000003" } }); console.log("simulatorSessions residue count:", s.length); const w = await p.workoutSession.findUnique({ where: { id: "00000000-0000-4000-a007-000000000003" } }); console.log("workout status:", w.status); console.log("trainerNotes:", w.trainerNotes); console.log("statusReason:", w.statusReason); console.log("resultRecordedAt:", w.resultRecordedAt); console.log("resultRecordedById:", w.resultRecordedById); console.log("resultUpdatedAt:", w.resultUpdatedAt); console.log("resultUpdatedById:", w.resultUpdatedById); console.log("actualDistanceMeters:", w.actualDistanceMeters); console.log("actualTimeSeconds:", w.actualTimeSeconds); console.log("actualSurface:", w.actualSurface); console.log("trackCondition:", w.trackCondition); console.log("heartRatePeak:", w.heartRatePeak); console.log("heartRateRecovery:", w.heartRateRecovery); console.log("topSpeedKmh:", w.topSpeedKmh); console.log("performanceScore:", w.performanceScore); console.log("completionLevel:", w.completionLevel); await p.$disconnect(); } main();'
  ```
- Verbatim output:
  ```
  simulatorSessions residue count: 0
  workout status: SCHEDULED
  trainerNotes: Deterministic QA Head Trainer Trial Run
  statusReason: null
  resultRecordedAt: null
  resultRecordedById: null
  resultUpdatedAt: null
  resultUpdatedById: null
  actualDistanceMeters: null
  actualTimeSeconds: null
  actualSurface: null
  trackCondition: null
  heartRatePeak: null
  heartRateRecovery: null
  topSpeedKmh: null
  performanceScore: null
  completionLevel: null
  ```

### 2.8 Git Diff & Whitespace Verification (`git diff --check`)
- Backend: Clean (Exit code 0)
- Frontend: Clean (Exit code 0)
- Simulator: Clean (Exit code 0)

### 2.9 Evidence Hygiene & Preservation
1. **Historical Evidence Preservation (R-1):**
   - Exactly six historical evidence files restored to `HEAD` and verified untouched in Git working tree (`git diff HEAD -- docs/ai-workflow/evidence` returns empty):
     - `docs/ai-workflow/evidence/task013_medical_record_list_names.png`
     - `docs/ai-workflow/evidence/task013_vet_exam_sim.png`
     - `docs/ai-workflow/evidence/task013_vet_main_web_loaded.png`
     - `docs/ai-workflow/evidence/task013_vitals_reference_range.png`
     - `docs/ai-workflow/evidence/task013_workout_completed_sim.png`
     - `docs/ai-workflow/evidence/task015_simulator_direct_catalogue.png`
   - Playwright test runner in `simulator-real-stack.spec.ts` guards all historical screenshot captures behind `if (process.env.CAPTURE_HISTORICAL_EVIDENCE) { ... }`, preventing standard Playwright test runs from overwriting them.
2. **TASK-016 Evidence Preserved:**
   - `docs/ai-workflow/evidence/task016_live_monitor_telemetry.png`: Real-time biometrics on `/training/monitor` for running simulation (speed `44.6 km/h`, heart rate `133 bpm`, stamina `98%`, body temperature `37.9 °C`, distance progress `164.7m / 1800m (9%)`), with safe handling for initial un-ticked sessions.
   - `docs/ai-workflow/evidence/task016_simulator_emergency_stop.png`: Simulator runner halted upon catastrophic injury trigger, pill displaying `■ ABORTED_INJURY`, and emergency event UI.

---

## 3. Human QA Acceptance Procedure

To verify TASK-016 manually on the running local stack:

### Scenario 1: Multi-Trainer Ownership Scoping & Complete Attack Matrix (CR-023)
1. Sign in as Head Trainer 2 (`qa-trainer2@gmail.com` / `EquiFlow@2026`).
2. Navigate to `/trials` (`http://localhost:5173/trials`).
   - **Expected:** Horse *QA Zephyr Wind* (owned by Head Trainer 1, workout `00000000-0000-4000-a007-000000000003`) is NOT listed in Trainer 2's trial runs table. No simulation action button ("Chạy mô phỏng") is present.
3. Navigate to `/training/plans` (`http://localhost:5173/training/plans`).
   - **Expected:** Trainer 1's plan (`QA-GA-000001`) is NOT visible in Trainer 2's plans table.
4. Attempt cross-trainer operations via API using Trainer 2's Bearer token:
   - **Cross-trainer Start:** `POST http://localhost:3000/api/simulator/workouts/00000000-0000-4000-a007-000000000003/start`
     - **Expected:** Returns HTTP 403 Forbidden (`"This workout belongs to another trainer."`).
   - **Cross-trainer Create Workout:** `POST http://localhost:3000/api/training/plans/<TRAINER1_PLAN_ID>/workouts`
     - **Expected:** Returns HTTP 403 Forbidden (`"This plan belongs to another trainer."`).
   - **Repeat-Create Workout:** Repeat identical `POST http://localhost:3000/api/training/plans/<TRAINER1_PLAN_ID>/workouts`
     - **Expected:** Returns HTTP 403 Forbidden (`"This plan belongs to another trainer."`).
   - **Repeat-Workouts Endpoint:** `POST http://localhost:3000/api/training/plans/<TRAINER1_PLAN_ID>/workouts/repeat`
     - **Expected:** Returns HTTP 403 Forbidden (`"This plan belongs to another trainer."`).
   - **Cross-trainer Update:** `PATCH http://localhost:3000/api/training/workouts/00000000-0000-4000-a007-000000000003` with `{ trainerNotes: "Malicious update" }`
     - **Expected:** Returns HTTP 403 Forbidden (`"This workout belongs to another trainer."`).
   - **Cross-trainer Cancel:** `POST http://localhost:3000/api/training/workouts/00000000-0000-4000-a007-000000000003/cancel` with `{ reason: "PLAN_CHANGE", note: "Malicious cancel" }`
     - **Expected:** Returns HTTP 403 Forbidden (`"This workout belongs to another trainer."`).
   - **Cross-trainer Restore:** `POST http://localhost:3000/api/training/workouts/00000000-0000-4000-a007-000000000003/restore` with `{}`
     - **Expected:** Returns HTTP 403 Forbidden (`"This workout belongs to another trainer."`).
   - **Cross-trainer Record Result:** `POST http://localhost:3000/api/training/workouts/00000000-0000-4000-a007-000000000003/result` with `{ actualDistanceMeters: 1000, actualTimeSeconds: 65, performanceScore: 8, completionLevel: "ACHIEVED", trainerNotes: "Malicious result" }`
     - **Expected:** Returns HTTP 403 Forbidden (`"This workout belongs to another trainer."`).
5. Check PostgreSQL database baseline:
   - **Expected:** Assert rejected requests created/updated zero records, and preserved the original workout status (`SCHEDULED`), notes, and result.
6. Sign in as Head Trainer 1 (`qa-trainer1@gmail.com` / `EquiFlow@2026`) and navigate to `/trials`:
   - **Expected:** Horse *QA Zephyr Wind* trial row is visible, and the button "Chạy mô phỏng" is visible and enabled. Starting the session succeeds with HTTP 201 Created and returns valid `launchUrl` and `sessionId`.

### Scenario 2: Trial Runs Date Auto-Expansion & Calendar Sync (CR-023)
1. Sign in as Head Trainer 1 (`qa-trainer1@gmail.com` / `EquiFlow@2026`).
2. Navigate to `/trials` (`http://localhost:5173/trials`).
3. Click **"+ Lên lịch chạy thử"**.
4. In the dialog:
   - Select a date outside the initial 14-day filter (e.g. `2026-11-20`).
   - Select plan *Giai đoạn thử tải nâng cao* (`QA-T013-PLAN-001`).
   - Enter target speed `48 km/h`, jockey `QA Jockey`, distance `1200m`.
   - Click **"Lưu buổi tập"**.
5. **Expected:**
   - The modal closes.
   - The "Đến ngày" filter input on `/trials` automatically expands to `2026-11-20`.
   - The newly created trial immediately appears in the table with the button **"Chạy mô phỏng"**.
6. Click **"📅 Xem trên lịch tuần"** (`/training/calendar`) and select the date `2026-11-20`.
   - **Expected:** The scheduled trial workout appears on the calendar.

### Scenario 3: Medical Lock & Retired Horse Rejection
1. Attempt to start a high-intensity (`HEAVY` / `TRIAL`) workout for a horse with an active medical lock.
   - **Expected:** Request is rejected with HTTP 409 Conflict (`code: "MEDICAL_LOCK_ACTIVE"`).
2. Attempt to start a simulation for a horse marked `status: "RETIRED"`.
   - **Expected:** Request is rejected with HTTP 400 Bad Request (`code: "HORSE_RETIRED"`).

### Scenario 4: Live Monitor Telemetry
1. In Main Web (`http://localhost:5173`), go to `/trials` and click **"Chạy mô phỏng"** for scheduled horse *QA Zephyr Wind*.
2. In the Simulator popup, click **"» Bắt đầu chạy thử"** at speed `1×`.
3. In a separate tab, open `http://localhost:5173/training/monitor`.
4. **Expected:**
   - A live session card appears for *QA Zephyr Wind* (`985141099000001`).
   - Speed (km/h), Heart Rate (bpm), Stamina (%), and Temperature (°C) update dynamically every ~1 second.

### Scenario 5: Emergency Stop & ABORTED_INJURY Persistence
1. While a trial is running in the Simulator, click one of the incident buttons (e.g. **"!! Gãy xương chân cấp tính"**).
2. **Expected:**
   - The horse stops immediately.
   - Status pill displays `■ ABORTED_INJURY`.
   - Querying the database (`prisma.simulatorSession.findUnique`) confirms `status: "ABORTED_INJURY"`, `finishedAt` is set, and exactly one finish packet was transmitted.

### Scenario 6: 15-Second Disconnect Grace Abort
1. Start another trial run in the Simulator popup.
2. While the phase is `RUNNING`, abruptly close the Simulator browser tab.
3. Wait 16 seconds.
4. Check session status in PostgreSQL (`prisma.simulatorSession.findUnique`).
5. **Expected:**
   - Session status transitioned from `RUNNING` to `ABORTED_INJURY`.
   - `result.abortReason` is set to `"DISCONNECT_TIMEOUT_15S"`.

---

## 4. Gate State & Human Handoff

- **Execution Gate:** `IDLE`
- **Active Task:** `NONE`
- **Last Approved Task:** `TASK-016` (human-approved on 2026-10-28 via `APPROVE TASK-016`).
- **Next Task:** `TASK-017` (strictly unauthorized; awaits explicit human command `START TASK-017` or commit authorization).
- **Approved Contract Enforced & Verified:**
  1. Multi-trainer scoping: Head Trainers only see and manage their own plans, workouts, and trial runs; foreign accesses return 404 (read) or 403 (mutation/start).
  2. TrialRunsPage auto-expands date filter bounds on save and strictly guards simulation actions against foreign plans.
  3. `recordFinished` and `abortSession` compete for the exact same conditional atomic transition in database transaction only from `PENDING` or `RUNNING`. Neither can overwrite a terminal state or result.
  4. Single persisted terminal outcome and single wire broadcast: Gateway emits `sim:session_finished` IF AND ONLY IF that operation won the transition (`transitioned: true`).
  5. 5-minute rule is an absolute running-session watchdog beginning at the first accepted telemetry tick.
  6. Normal finish, accepted abort, client reconnect within 15s, and module teardown clear applicable timers. Reconnect within 15s preserves session. 15s expiry aborts once.
  7. Deterministic fixture cleanup runs fail-safe in `try / finally`, restoring seed state and asserting zero session residue.
- TASK-016 is human-approved and execution is IDLE. Do not commit, push, merge, or begin TASK-017 without explicit authorization.
