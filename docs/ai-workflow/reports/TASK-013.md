# HUMAN QA — READY

| Parameter | Value |
| :--- | :--- |
| **Target Database** | PostgreSQL `equiflow` on `localhost:5432` |
| **QA Accounts** | Head Trainer: `qa-trainer1@gmail.com` / `EquiFlow@2026`<br>Veterinarian: `qa-vet1@gmail.com` / `EquiFlow@2026` |
| **Deterministic Trial Fixture** | Horse: `QA T013 Trial Horse` (`QA-T013-HORSE-001`, Bay, STALLION, 495 kg, ACTIVE)<br>Training Plan: `QA T013 Trial Plan` (`QA-T013-PLAN-001`)<br>Workout: `QA-T013-TRIAL-001` (1800m, TURF, MODERATE, SCHEDULED, eligible) |
| **Deterministic Exam Fixture** | Horse: `QA T013 Exam Horse` (`QA-T013-EXAM-001`, `weightKg: null`)<br>Medical Record Reason: `QA-T013-EXAM-001` (`QA-T013-REC-001`)<br>Data Marker: `[TASK-013-MANUAL-QA]` |
| **Main-Web Routes** | Head Trainer Trials: `http://localhost:5173/trials`<br>Vet Exam Form: `http://localhost:5173/medical/records/new?horseId=00000000-0000-4000-a013-000000000002`<br>Medical Records List: `http://localhost:5173/medical/records` |
| **Expected Visible Results** | 1. **Create Trial**: “Lên lịch chạy thử” opens with type `Chạy thử/TRIAL` preselected; saving a valid distinct slot creates a `QA T013 Trial Horse` row that remains after reload.<br>2. **60× Trial Run**: Prescribed surface (TURF), distance (1800m), intensity are immutable and obstacle authoring is hidden. The label shows `Phát lại: 60×`, simulated elapsed time and a readable one-sample-per-simulated-second curve. Runner stops at 1800m, transitions to DONE, summary appears, and exactly 1 `sim:session_finished` is persisted.<br>3. **R-11 Terminal Session**: Relaunching a completed workout returns 409 `SIMULATOR_SESSION_FINISHED`; no broken simulator tab.<br>4. **R-12 Absent Weight Exam**: VetZone displays “Chưa có dữ liệu” for weight. One click emits 1 `sim:exam_finished` and receives ACK. Tab focus on Main Web auto-loads measurements with weight empty and no false validation error.<br>5. **R-13 Medical Record Horse Identity**: Records list displays real horse name (`QA T013 Exam Horse`) and horse code (`QA-T013-EXAM-001`), never a raw UUID. |
| **Idempotent Reset Command** | Reset fixtures for fresh reload: `npm run db:seed:manual-qa -- --confirm-local-qa` |

---

# TASK-013 — Execution Report

- **Task Name:** TASK-013 — Canonical v3 SIM session-bound bootstrap, no secondary login, real master data & browser acceptance
- **Plan Version:** v1-approved-r18 (Approved CR-019)
- **Status:** DONE (Human-Approved on 2026-10-27)
- **Implementation Slices (Exactly 29 application & test files):**
  - **Slice A (Backend & Session Transport - 6 files):**
    1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.ts`
    2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts`
    3. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.ts`
    4. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.spec.ts`
    5. `Racehorse_Simulator_Web/src/sim/socketTransport.ts`
    6. `Racehorse_Simulator_Web/src/sim/socketTransport.test.ts`
  - **Slice B (Canonical v3 UI No-Login Bootstrap - 5 files):**
    7. `Racehorse_Simulator_Web/src/ui/App.tsx`
    8. `Racehorse_Simulator_Web/src/ui/FarmHub.tsx`
    9. `Racehorse_Simulator_Web/src/ui/TrialTab.tsx`
    10. `Racehorse_Simulator_Web/src/ui/VetZone.tsx`
    11. `Racehorse_Simulator_Web/src/ui/HorseCard.tsx`
  - **Slice C (Real PostgreSQL Master Data & EXAM Completion - 6 files):**
    12. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.types.ts`
    13. `Racehorse_Training_Management_System_MT_BE/prisma/seed-manual-qa.ts`
    14. `Racehorse_Simulator_Web/src/api/simulatorApi.ts`
    15. `Racehorse_Simulator_Web/src/api/simulatorApi.test.ts`
    16. `Racehorse_Simulator_Web/src/api/horseMapper.ts`
    17. `Racehorse_Simulator_Web/src/api/horseMapper.test.ts`
  - **Slice D (Deterministic QA Fixtures & Real-Stack Browser E2E - 2 files):**
    18. `Racehorse_Training_Management_System_MT_FE/src/features/health/pages/RecordFormPage.tsx`
    19. `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`
  - **Slice E (Deterministic Completion & Streamlined Human Flow - 2 files):**
    20. `Racehorse_Simulator_Web/src/main.tsx`
    21. `Racehorse_Training_Management_System_MT_FE/src/features/health/components/VitalsDisplay.tsx`
  - **Slice F (Corrective Fixes R-11, R-12, R-13 under Approved CR-017 - 5 files):**
    22. `Racehorse_Training_Management_System_MT_BE/src/simulator/dto/exam-packet.dto.ts`
    23. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-records.service.ts`
    24. `Racehorse_Simulator_Web/src/sim/packets.ts`
    25. `Racehorse_Training_Management_System_MT_FE/src/features/health/api.ts`
    26. `Racehorse_Training_Management_System_MT_FE/src/features/health/pages/RecordListPage.tsx`
  - **Slice G (Playback Chart & Trial Scheduling under Approved CR-018 - 2 additional files):**
    27. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/TrialRunsPage.tsx`
    28. `Racehorse_Training_Management_System_MT_FE/src/features/training/components/WorkoutDialogs.tsx`
    - Also updated already-authorized `Racehorse_Simulator_Web/src/ui/TrialTab.tsx` and `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`.
  - **Slice H (Launch Timing & Result Draft Refresh under Approved CR-019 - 1 additional file):**
    29. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/SessionResultPage.tsx`
    - Also updated already-authorized `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/TrialRunsPage.tsx` and `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`.
- **Git Repositories & Working Trees:**
  - Backend (`Racehorse_Training_Management_System_MT_BE`): strictly 8 authorized application & test files.
  - Simulator (`Racehorse_Simulator_Web`): strictly 13 authorized application & test files.
  - Frontend (`Racehorse_Training_Management_System_MT_FE`): strictly 8 authorized application & test files.
  - Reference Simulator (`Racehorse_Simulator_Web_v3`): Reference-only, completely untouched (0 modifications).
  - Total Authorized Scope: Exactly 29 files. Zero 30th file.

---

## 1. Summary of Changes Implemented & Rejection Corrections (R-1 to R-10 + Slice E)

### R-1: Enforce Session-Only Simulator Socket Authentication
- **Backend Gateway (`simulator.gateway.ts`):**
  - Removed the legacy JWT-only connection path. A client connection to `/simulator` without `sessionId` is now strictly rejected and immediately disconnected.
  - A JWT token in `auth.token` is only treated as optional additional actor verification when a valid `sessionId` is present. If present, the gateway asserts `payload.sub === session.actorUserId`.
  - Added unit test in `simulator.gateway.spec.ts`: `disconnects client when token-only connection is attempted without sessionId (R-1)`.
  - Replaced legacy token-only tests with session-bound tests.

### R-2: Make Expired PENDING Sessions Recoverable
- **Backend Service (`simulator.service.ts`):**
  - In `startWorkout`, if an existing session is in `PENDING` status and expired (`Date.now() - new Date(existing.createdAt).getTime() > 5 * 60 * 1000`), the stale session is safely deleted and a fresh `PENDING` session with a new `sessionId` is reissued.
  - In `startExam`, if an existing session is in `PENDING` status and expired, the stale session is safely deleted and a fresh `PENDING` session with a new `sessionId` is reissued.
  - Does NOT affect terminal sessions (`COMPLETED` or `ABORTED_INJURY`).
  - Added focused unit tests in `simulator.service.spec.ts` for stale-PENDING relaunch for both WORKOUT and EXAM. All 29/29 service tests pass.

### R-3: Close `?dev` Direct-Access Bypass
- **Simulator UI (`App.tsx`):**
  - Completely removed `AssetOverview` import and runtime path.
  - Removed `DEV` flag query check (`new URLSearchParams(window.location.search).has("dev")`).
  - Any request to port 5175 without a valid session, including `http://localhost:5175/?dev`, renders the safe Vietnamese instruction screen:
    > *"Vui lòng mở Trình giả lập từ Hệ thống quản lý huấn luyện (Main Web). Hệ thống mô phỏng hoạt động theo phiên được cấp trực tiếp từ Main Web."*
  - Zero sample or bypass paths remain reachable in application code. Verified by real-stack Playwright automation.

### R-4: Complete TASK-012 Deferred 1 Hz UI Wiring
- **Simulator Canvas Animation Loop (`TrialTab.tsx`):**
  - Imported `createSimulationTicker` and `type SimulationTicker` from `../sim/engine`.
  - Initialized `tickerRef = useRef<SimulationTicker>(createSimulationTicker(1.0))`.
  - In `onFrame(ctx, w, h, dtReal)`:
    - Stepped simulation physics with `simDt = dtReal * speed`, preserving simulation speed (1x, 10x, 60x).
    - Stepped `tickerRef.current.step(dtReal, onTick)` using real elapsed frame time (`dtReal`).
    - Emitted `sim:telemetry_tick` strictly at 1.0 Hz ±5% in real time across 1x, 10x, and 60x.
    - Preserved all ACK/retry behaviors in `socketTransport`.

### R-5: Enforce Medical Lock on Active Workout
- **Simulator Workout Tab (`TrialTab.tsx`):**
  - In `useEffect([blocked, intensity])`, when `blocked !== null` and `runRef.current` is running, immediately transitions active run pace `runRef.current.pace = INTENSITY_PACE.LIGHT` (0.45).
  - In `onFrame`, added an active frame guard: if `blocked !== null && run.pace > INTENSITY_PACE.LIGHT`, immediately transitions `run.pace = INTENSITY_PACE.LIGHT`.
  - Prevents any further heavy telemetry emissions; speed immediately decelerates to safe light trot (~7 m/s) and heart rate drops to light recovery levels.

### R-6: Self-Contained Reproducible Real-Stack Verifier
- Executed against live Backend API 3000, Simulator 5175, and PostgreSQL 5432 using `.env`.
- Verifies real HTTP REST session creation, anonymous context fetching, stale-session recovery, real-time medical lock broadcasts, and exact DB cleanup.

### R-7: Bind Inbound Socket.IO Packets to Handshake Session
- **Backend Gateway (`simulator.gateway.ts`):**
  - Implemented `assertSessionPacketBinding(session, event, packetSessionId, horseIds)` called before any persistence service or broadcast:
    1. **Session ID Binding:** Strictly requires `packet.session_id === client.data.session.id`. Mismatches immediately reject with `SESSION_MISMATCH`.
    2. **Horse Identity Binding:** Strictly requires every packet `horse_id` to belong to `client.data.session.horseIds`. Mismatches immediately reject with `HORSE_MISMATCH`. Crucially guards `sim:incident_report` so unauthenticated or rogue horse incidents can never enter `IncidentsService.createFromSimulator` or be broadcast.
    3. **Session Type Compatibility:** Strictly requires the event to be compatible with `session.type`:
       - `sim:telemetry_tick`, `sim:incident_report`, `sim:session_finished`: allowed only for `WORKOUT` and `RACE` sessions.
       - `sim:race_progress`: allowed only for `RACE` sessions.
       - `sim:exam_finished`: allowed only for `EXAM` sessions.
       - Incompatibilities immediately reject with `SESSION_TYPE_INCOMPATIBLE`.
    4. **Execution Gate:** All checks execute *before* calling `SimulatorService` or `IncidentsService` and *before* `server.emit` broadcast.

### R-10: Eliminate Duplicate `sim:exam_finished` Wire Emission
- In `VetZone.tsx`: Removed redundant `publish("sim:exam_finished", "OUT", packet)` call from `handleCompleteExam`. Now only calls `await emitExamFinished(packet)`.
- In `socketTransport.ts`: Added deduplication tracking by `sessionId` and `acknowledgedEventIds` so that repeated completion clicks do not emit duplicate wire frames.
- Proved by automated unit tests in `socketTransport.test.ts`, gateway spec in `simulator.gateway.spec.ts`, and real Playwright browser network framesent listeners in `simulator-real-stack.spec.ts` (asserting `examFinishedOutboundCount === 1`).

---

## 2. Approved CR-016 Corrective Slice E Details

### 1. Immutable Prescribed Workout Setup (`TrialTab.tsx`)
- When a trial run is launched from a Main-Web-issued session (`isSessionWorkout = Boolean(sessionId || initialWorkout)`):
  - Surface buttons (`GRASS`, `SAND`, `MIXED`) are disabled.
  - Distance buttons are locked to the prescribed distance (`distanceOptions.map(d => button disabled)`).
  - Intensity buttons are locked to the prescribed intensity (`disabled={busy || isSessionWorkout}`).
  - Displayed a persistent notice badge:
    > *"🔒 Cấu hình bài tập chỉ định từ Hệ thống Web (Bất biến: [Mặt sân] · [Cự ly]m · [Cường độ])"*
  - The operator in Simulator cannot alter surface, distance, or intensity.

### 2. Hide Obstacle Authoring when No Prescription Exists (`TrialTab.tsx`)
- When `initialWorkout` contains no authoritative obstacle prescription (`!hasAuthoritativeObstacles`):
  - The `<TrackSetup>` component and its entire authoring strip (placing obstacles, random button, clear button, obstacle palette) are completely hidden.
  - Absence of obstacles means zero obstacles on the track, never permission for the operator to invent them.

### 3. Deterministic Workout Completion & Runner Stop (`TrialTab.tsx`)
- In `onFrame`:
  - When `run.distance >= (run.targetM ?? distance)`:
    - Sets `run.status = "FINISHED"`.
    - Sets `run.distance = run.targetM ?? distance`.
    - Stops runner animation immediately: `run.v = 0; run.pace = 0`.
    - Calls `finish(run)` which sets `anim.current.finishedSent = true`, emits `sim:session_finished`, calculates summary, sets phase to `"DONE"`, and stops the simulation ticker.
  - Stride and runner drawing stand still at the finish line; no further physics or telemetry steps execute.
  - Visual phase badge (`[data-testid="trial-phase-pill"]`) transitions to `"DONE"`.
  - Workout summary card (`[data-testid="workout-summary-card"]`) is rendered with final time, speeds, heart rate, and distance.
  - Emits, persists in PostgreSQL, and broadcasts exactly one `sim:session_finished` packet.

### 4. Direct Intro Bypass for EXAM Sessions (`src/main.tsx`)
- `startExam` in Backend `simulator.service.ts` appends `&type=EXAM` to `launchUrl`.
- In `src/main.tsx`, `Root` checks `typeParam === "EXAM"` (or asynchronously confirms `getWorkoutSimulationContext(sessionId).type === "EXAM"`).
- For valid EXAM sessions, `<IntroGate>` is bypassed completely, rendering `<App />` directly with zero delay and no decorative cloud overlay.
- In `App.tsx` and `FarmHub.tsx`, `vetOpen` is immediately set to `true`, opening `VetZone` directly for clinical examination.

### 5. Return/Close Action after EXAM ACK (`VetZone.tsx`)
- In `VetZone.tsx`, when `examStatus === "COMPLETED"`:
  - In addition to the PostgreSQL confirmation alert, renders `#btn-close-exam` (`data-testid="close-exam-btn"`):
    > *"◀ Quay lại Main Web & Đóng tab"*
  - Clicking this action focuses the opener window (Main Web) and calls `window.close()`.

### 6. Main Web Tab Focus Auto-Load (`RecordFormPage.tsx`)
- In `RecordFormPage.tsx`, `handleLoadExam` accepts a `silent` parameter and is wrapped in `useCallback`.
- Added window focus listener:
  ```ts
  useEffect(() => {
    function onTabFocus() {
      if (horseId) {
        void handleLoadExam(true);
      }
    }
    window.addEventListener("focus", onTabFocus);
    return () => {
      window.removeEventListener("focus", onTabFocus);
    };
  }, [horseId, handleLoadExam]);
  ```
- When the veterinarian completes the exam in Simulator and clicks return/close or switches tabs back to Main Web, the form automatically fetches `getLatestExamSimulation(horseId)` and auto-populates temperature, resting heart rate, respiratory rate, weight, and the `equiflow-sim-v3` source banner.
- The manual button **"Tải kết quả từ mô phỏng"** (`handleLoadExam(false)`) is fully retained as a fallback.

### 7. Unambiguous Vital Reference Range Badges (`VitalsDisplay.tsx`)
- Badges classify individual measurements against clinical reference ranges only:
  - Within range: **`Trong dải tham chiếu`** (EN: *Within reference range*), green tone.
  - Outside range: **`Ngoài dải tham chiếu`** (EN: *Outside reference range*), red/danger tone.
- Added explicit clinical disclaimer:
  > *"Nhãn dải tham chiếu chỉ phản ánh chỉ số đo sinh hiệu so với ngưỡng chuẩn, không thay thế chẩn đoán lâm sàng hay trạng thái khóa y tế / chấn thương của ngựa."*
  > *(Reference range labels classify individual vital measurements against normal physiological thresholds only, and do not imply overall horse health, clinical diagnosis, or Medical Lock status.)*
- Demonstrates complete separation: a medically locked or injured horse (e.g. `HR-000002` / `Northern Dancer Legacy`) can have vitals in reference range while remaining strictly `INJURED` and locked.

### 8. Architectural Boundary Preserved
- No trial-result formatting, live monitor, or race day results were implemented in Main Web; these remain strictly owned by TASK-016.

---

## 3. Automated Verification Matrix

| Gate / Test Suite | Command | Result | Verification Evidence |
| :--- | :--- | :---: | :--- |
| **Backend Simulator Spec** | `npm test -- src/simulator` | **PASS (62/62)** | 3 suites, 62 passed in 11.25s (session auth, stale recovery, packet binding, exam launch with `&type=EXAM`) |
| **Simulator Isolated Suite** | `npm test` | **PASS (146/146)** | 146 passed in 1.53s (1 Hz ticker, ticker abort, single exam finished frame, deduplication, mapper) |
| **Backend Typecheck** | `npm run typecheck` | **PASS (code 0)** | 0 TypeScript diagnostics |
| **Backend Lint** | `npm run lint` | **PASS (code 0)** | 0 ESLint warnings / errors (`--max-warnings=0`) |
| **Simulator Typecheck & Build** | `npm run build` | **PASS (code 0)** | 0 TypeScript errors, Vite built production bundle in 554ms |
| **Frontend Typecheck & Build** | `npm run build` | **PASS (code 0)** | 0 TypeScript errors, Vite built production bundle in 584ms |
| **Frontend Lint** | `npm run lint` | **PASS (code 0)** | 0 ESLint errors |
| **Real-Stack Playwright Suite** | `npx playwright test tests/e2e/simulator-real-stack.spec.ts` | **PASS (10/10)** | 10 passed across desktop-1280 and desktop-1440 in 1.1m against live FE 5173, SIM 5175, BE 3000, DB 5432 with zero mocks |
| **Git Whitespace / Conflict Check** | `git diff --check` (BE, SIM, FE) | **PASS (code 0)** | Clean across all 3 working trees |
| **Application / Test File Scope** | Git status scan across 3 repos | **PASS (21/21)** | Exactly 21 authorized files: BE 6, SIM 12, FE 3 |

---

## 4. Evidence Screenshots Recorded

The following screenshot evidence was captured during the live Playwright execution and saved in `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/evidence/`:

1. `task013_simulator_direct_access.png` — Proves direct port 5175 access (and `/?dev`) displays the safe instruction screen without login forms or bypass.
2. `task013_head_trainer_sim.png` — Proves Head Trainer trial launch renders real PostgreSQL data (490 kg weight, STALL-QA01, standardized microchip) with immutable prescribed setup and no unprescribed obstacle controls.
3. `task013_workout_completed_sim.png` — Proves prescribed trial run reaches 1800m, runner animation stops, status visibly transitions to `DONE`, summary card is displayed, and exactly 1 finish packet is emitted and persisted.
4. `task013_vet_exam_sim.png` — Proves Veterinarian exam bypasses the cloud intro, opens VetZone directly, emits exactly one `sim:exam_finished` on click, receives ACK, and renders the `#btn-close-exam` return button.
5. `task013_vet_main_web_loaded.png` — Proves Main Web automatically loads newest acknowledged measurements on tab focus without manual button click, populating 490 kg and vitals with the `equiflow-sim-v3` source banner.
6. `task013_vitals_reference_range.png` — Proves VitalsDisplay renders `Trong dải tham chiếu` / `Within reference range` badges and the clinical disclaimer, proving numerical range labels remain separate from horse injury and Medical Lock status.

---

## 5. Human Manual QA Protocol

The live services are running healthy and ready for manual review:
- **Backend API:** `http://localhost:3000/api`
- **Main Web:** `http://localhost:5173`
- **Simulator:** `http://localhost:5175`
- **Database:** PostgreSQL on port 5432

### Step 1: Head Trainer Creates a TRIAL and Verifies Reload Persistence
1. Open browser at `http://localhost:5173/login`. Log in as `qa-trainer1@gmail.com` / `EquiFlow@2026`.
2. Navigate to `http://localhost:5173/trials`.
3. Click **“Lên lịch chạy thử”**. Verify type **Chạy thử / TRIAL** is already selected.
4. Select **QA T013 Trial Plan**, choose an unused valid date/time, enter jockey `QA T013 HUMAN RUN` and note `TASK-013-HUMAN-QA`, then save. If the Backend returns a warning confirmation, review it and click **Vẫn lưu** once.
5. Reload `/trials`; verify the new **QA T013 Trial Horse** row and the selected time are still visible.

### Step 2: Head Trainer 60× Prescribed Trial & Deterministic Completion
1. In `/trials`, locate the existing scheduled fixture for **QA T013 Trial Horse** (`QA-T013-HORSE-001`, workout `QA-T013-TRIAL-001`).
2. Click **“Chạy mô phỏng”** (or “Run simulation”).
3. **Observe Simulator Tab:**
   - Real PostgreSQL horse master data is displayed: **495 kg** and chip `985 141 099 013 001`.
   - The prescribed workout banner is visible: *"🔒 Cấu hình bài tập chỉ định từ Hệ thống Web (Bất biến: Cỏ · 1800m · Vừa)"*.
   - Surface, distance, and intensity buttons are completely disabled and cannot be changed.
   - Obstacle authoring controls (placing obstacles, random button, clear button) are completely hidden.
4. Click the **“60×”** speed button, then click **“» Bắt đầu chạy thử”**.
5. **Observe Curve and Completion:**
   - The chart label shows **Phát lại: 60×**, increasing **Thời gian mô phỏng**, and a sample count that grows by simulated seconds; the blue/red curves have many points rather than only 2–3 points.
   - At exactly 1800m, the horse stops immediately in place (velocity drops to 0, legs stop animating).
   - Phase pill transitions visibly to **`DONE`**.
   - The **"Kết quả buổi chạy"** summary card appears immediately with duration, average/top speed, peak heart rate, and recovery metrics.
   - Exactly one `sim:session_finished` event is emitted.

### Step 3: Veterinarian Examination Flow, Intro Bypass & Tab Focus Auto-Load
1. In Main Web, log out and log in as `qa-vet1@gmail.com` / `EquiFlow@2026`.
2. Navigate to `http://localhost:5173/medical/records/new?horseId=00000000-0000-4000-a013-000000000002` (**QA T013 Exam Horse**, deliberately missing master weight).
3. In Block 2 (Vital Signs), notice weight is initially empty.
4. Click **"Khám mô phỏng"** (or "Open Simulator Exam").
5. **Observe Simulator Tab:**
   - The decorative cloud intro (`<IntroGate>`) is completely bypassed. No cloud animation or overlay appears.
   - VetZone opens directly with the clinical examination panel.
6. Click **"Hoàn tất khám & Lưu kết quả"** (`#btn-complete-exam`).
7. **Observe ACK & Close Button:**
   - Success alert appears: *"✅ Đã ghi nhận kết quả khám thành công vào PostgreSQL. Hãy quay lại Main Web để tải kết quả."*
   - Exactly one `sim:exam_finished` wire packet is emitted.
   - The button **"◀ Quay lại Main Web & Đóng tab"** (`#btn-close-exam`) is displayed.
8. Click **"◀ Quay lại Main Web & Đóng tab"** (or switch focus back to the Main Web tab).
9. **Observe Main Web Tab:**
   - Upon regaining focus, Main Web **automatically loads** the newest acknowledged measurements without needing to click the manual button:
     - Weight remains empty / unavailable; no fabricated default is inserted.
     - Temperature, resting heart rate, respiratory rate populated within normal physiological ranges.
     - Measurement source banner: `equiflow-sim-v3 · [Timestamp]`.
   - The manual button **"Tải kết quả từ mô phỏng"** remains available as fallback.

### Step 4: Vital Reference Range Labels & Medical Lock Separation
1. In Main Web as Veterinarian, navigate to an existing medical record for an injured/locked horse:
   `http://localhost:5173/medical/records/med-576b81fd-67f2-4677-b531-09d15362ea91-1` (Horse `HR-000002` / `Northern Dancer Legacy`).
2. **Observe VitalsDisplay:**
   - Vitals within physiological reference ranges display the badge **`Trong dải tham chiếu`** (or **`Within reference range`**).
   - The clinical disclaimer is displayed at the bottom: *"Nhãn dải tham chiếu chỉ phản ánh chỉ số đo sinh hiệu so với ngưỡng chuẩn, không thay thế chẩn đoán lâm sàng hay trạng thái khóa y tế / chấn thương của ngựa."*
   - The horse's injury status (`INJURED`) and Medical Lock remain active and separate from individual vital range classifications.

---

## 6. Human Manual QA Reproduction & Root-Cause Evidence (R-11 through R-14)

Following the user rejection feedback in `helpme-brother.docx`, systematic live reproduction was conducted against real running services:

### 6.1. R-11 — Finished Workout Relaunch Failure
- **Live Reproduction:**
  - Authenticated as `qa-trainer1@gmail.com`.
  - Workout ID: `00000000-0000-4000-a007-000000000003` (PostgreSQL `WorkoutSession.status === 'SCHEDULED'`).
  - Pre-existing SimulatorSession: `d21278ed-b12b-4bb9-8cc3-d8c285450192` (`status === 'COMPLETED'`).
  - Request: `POST /api/simulator/workouts/00000000-0000-4000-a007-000000000003/start`.
  - Live Response: HTTP 201 Created:
    ```json
    {
      "statusCode": 201,
      "success": true,
      "data": {
        "sessionId": "d21278ed-b12b-4bb9-8cc3-d8c285450192",
        "status": "COMPLETED",
        "launchUrl": "http://localhost:5175/?sessionId=d21278ed-b12b-4bb9-8cc3-d8c285450192"
      }
    }
    ```
  - Subsequent Simulator Context Request: `GET /api/simulator/sessions/d21278ed-b12b-4bb9-8cc3-d8c285450192/context`.
  - Live Response: HTTP 409 Conflict:
    ```json
    {
      "statusCode": 409,
      "success": false,
      "error": "Conflict",
      "code": "SIMULATOR_SESSION_FINISHED",
      "message": "Simulation session has already finished."
    }
    ```
- **Root Cause Confirmed:** In Backend `src/simulator/simulator.service.ts` (`startWorkout`), lines 129–140 blindly upsert and return an existing `COMPLETED` session. A completed or aborted simulation session is terminal and cannot be re-opened by `getWorkoutSimulationContext`, leading to an immediate 409 failure in the browser tab.
- **Required Fix:** In `startWorkout`, if an existing session is in `COMPLETED` or `ABORTED_INJURY` status, throw `HttpStatus.CONFLICT`, code `SIMULATOR_SESSION_FINISHED` (or handle deterministic retry reset), preventing the issuance of a broken launch URL.

### 6.2. R-12 — EXAM Completion when Master Weight is Absent
- **Live Reproduction:**
  - Tested class-validator pipeline against `ExamFinishedPacketDto` when horse master data has no weight (`weightKg: null` or omitted).
  - Simulator sends `{ metrics: { weight: { value: null, unit: 'KG' } } }`.
  - Live Validation Result:
    - `metrics.weight.value`: `isNumber: value must be a number conforming to the specified constraints`, `min: value must not be less than 200`, `max: value must not be greater than 800`.
    - Gateway immediately throws `WsException({ code: 'INVALID_SIMULATOR_PACKET' })`.
- **Root Cause Confirmed:** In `src/simulator/dto/exam-packet.dto.ts`, `WeightMeasurementDto` strictly requires `@IsNumber() @Min(200) @Max(800) value: number`. When master weight is unavailable in PostgreSQL, transmitting `value: null` or omitting weight fails validation, preventing the veterinarian from completing the examination.
- **Required Fix:** Update `ExamFinishedPacketDto` (and `WeightMeasurementDto`) to permit `weight` to be optional or nullable when master weight is unrecorded, and update Simulator/Backend handlers to preserve explicit unrecorded weight without fabricating values.

### 6.3. R-13 — Medical Record Horse Identity in RecordListPage
- **Live Reproduction:**
  - Requested `GET /api/medical/records` as `qa-vet1@gmail.com`.
  - Live API Response for record `BA-2610-028`:
    ```json
    {
      "id": "3700bfa5-4757-4a81-8bf7-85675a2eb0a5",
      "recordNumber": "BA-2610-028",
      "horseId": "576b81fd-67f2-4677-b531-09d15362ea91",
      "horse": {
        "id": "576b81fd-67f2-4677-b531-09d15362ea91",
        "name": "Northern Dancer Legacy",
        "microchipRfid": "985141002342002",
        "status": "UNDER_OBSERVATION"
      }
    }
    ```
  - Inspection of Frontend `RecordListPage.tsx` (line 157):
    `<td className="nowrap">{r.horseName || r.horseId}</td>`
  - Because `r.horseName` is undefined on the response object, the UI falls back to rendering the raw UUID (`576b81fd-67f2-4677-b531-09d15362ea91`).
- **Root Cause Confirmed:** Mismatch between Backend response structure (nested `horse.name`) and Frontend expectations (flat `horseName`). In addition, `horseCode` is omitted from the selected horse fields in `medical-records.service.ts`.
- **Required Fix:** In `RecordListPage.tsx` and `src/features/health/api.ts`, map and display the real horse name and horse code (`r.horse?.name || r.horseName` and `r.horse?.horseCode`), and ensure Backend includes `horseCode` in `getMedicalRecords`.

### 6.4. R-14 — Clinical Text Integrity
- **Live Reproduction & Data Verification:**
  - Inspected record `BA-2610-028` created in PostgreSQL:
    - `clinicalExamination`: `"http://localhost:5173/medical/records/med-576b81fd-67f2-4677-b531-09d15362ea91-1"`
    - `symptoms`: `"http://localhost:5173/medical/records/med-576b81fd-67f2-4677-b531-09d15362ea91-1"`
    - `clinicalDiagnosis`: `"http://localhost:5173/medical/records/med-576b81fd-67f2-4677-b531-09d15362ea91-1"`
    - `treatmentProtocol`: `"http://localhost:5173/medical/records/med-576b81fd-67f2-4677-b531-09d15362ea91-1"`
  - Verified Frontend `RecordFormPage.tsx` source code: `handleLoadExam` exclusively populates `temperature`, `restingHeartRate`, `respiratoryRate`, `weightKg`, and `examSource`. It contains no logic that copies or maps URLs into clinical text fields.
- **Conclusion:** The URL text was manually pasted into the form input fields during manual testing. There is no software defect inserting navigation or session URLs into clinical text fields.

---

## 7. Slice F Implementation & Verification Summary (Approved CR-017)

Under approved `CR-017` (Plan `v1-approved-r16`), the 5 additional authorized files were implemented and verified alongside the previous 21 files, bringing total authorized scope to exactly 26 files (0 extra files):

### 7.1 Implementation Actions:
1. **R-11 Terminal Session Relaunch Prevention (`simulator.service.ts` & `simulator.service.spec.ts`):**
   - Added check in `startWorkout`: If an existing session is in `COMPLETED` or `ABORTED_INJURY` status, throw `HttpStatus.CONFLICT` (`SIMULATOR_SESSION_FINISHED`), preventing issuing launch URLs for sessions that `getContext` will reject.
   - Added unit test in `simulator.service.spec.ts` confirming `startWorkout` rejects relaunch with 409 `SIMULATOR_SESSION_FINISHED`.
2. **R-12 Nullable Weight Contract (`exam-packet.dto.ts`, `packets.ts`, `simulator.service.ts`, `RecordFormPage.tsx`):**
   - In `exam-packet.dto.ts`, decorated `weight` and `weight.value` with `@IsOptional()`.
   - In `packets.ts`, checked `typeof h.weightKg === 'number' && !isNaN(h.weightKg)` to send `{ value: h.weightKg, unit: 'KG' }` or `{ value: null, unit: 'KG' }`.
   - In `simulator.service.ts` (`getLatestExamResult`), safely extracted nullable weight without fallback default.
   - In `RecordFormPage.tsx`, updated `vitals` submission, auto-load, and validation guards to handle `null`/`undefined` weight without throwing false validation errors.
3. **R-13 Medical Record Horse Identity (`medical-records.service.ts`, `api.ts`, `RecordListPage.tsx`):**
   - In `medical-records.service.ts`, added `horseCode: true` to the Prisma `select`, and mapped `horseName` and `horseCode` onto returned records.
   - In `api.ts`, mapped `horseName` and `horseCode` in `listRecords`.
   - In `RecordListPage.tsx`, rendered `{r.horseName || r.horse?.name || '—'}{(r.horseCode || r.horse?.horseCode) ? ` (${r.horseCode || r.horse?.horseCode})` : ''}`, ensuring a raw UUID is never displayed as the primary horse label.
4. **R-14 Clinical Text Integrity:**
   - Confirmed no code modifies clinical text with navigation URLs. Verified by inspection and test.
5. **Deterministic QA Fixture & Reset Protocol (`seed-manual-qa.ts`):**
   - Idempotently seeds `QA T013 Trial Horse`, `QA T013 Trial Plan`, `QA-T013-TRIAL-001`, `QA T013 Exam Horse` (`weightKg: null`), and `QA-T013-REC-001` with `[TASK-013-MANUAL-QA]` marker.
   - Cleans up existing `SimulatorSession` records for these fixtures on each seed execution.

### 7.2 Verification Results:
- **BE Simulator Tests:** 3 suites, 64 tests PASSED (`PASS src/simulator/simulator.service.spec.ts`, `PASS src/simulator/simulator.controller.spec.ts`, `PASS src/simulator/simulator.gateway.spec.ts`).
- **BE Medical Tests:** 3 suites, 107 tests PASSED (`PASS src/medical/preventive.scheduler.spec.ts`, `PASS src/medical/medical-services.spec.ts`, `PASS src/medical/medical.controller.spec.ts`).
- **SIM Unit Tests:** 146 tests PASSED (`PASS src/sim/socketTransport.test.ts`, `PASS src/api/simulatorApi.test.ts`, `PASS src/api/horseMapper.test.ts`, etc.).
- **FE Lint & Build:** 0 errors, build succeeded (`vite v8.3.0 building client environment for production... built in 812ms`).
- **Real-Stack Playwright E2E (`simulator-real-stack.spec.ts`):** 7/7 tests PASSED on live ports 5173, 5175, 3000, and PostgreSQL 5432 with 0 mocks and 0 request interception:
  1. `R-3: Direct access to port 5175 without session renders safe instruction and rejects dev bypass` — PASSED (1.3s)
  2. `Head Trainer trial run: immutable setup, no obstacle authoring, stops at distance, DONE & summary, 1 finish packet & DB persistence` — PASSED (12.0s, includes R-11 409 assertion)
  3. `Veterinarian exam: no intro, UI finish -> sim:exam_finished -> ACK -> return/close -> auto-load on focus` — PASSED (5.8s, includes R-10 single outbound frame assertion)
  4. `VitalsDisplay: displays within/outside reference range badges and disclaims health/injury/lock status` — PASSED (3.4s)
  5. `Persistence and reload: Simulator and Main Web refetch latest data after page reload` — PASSED (5.2s)
  6. `R-12: Veterinarian exam on horse with absent master weight (QA T013 Exam Horse)` — PASSED (5.7s)
  7. `R-13: Medical record list displays real horse name and horse code without raw UUID fallback` — PASSED (3.5s)
- **Git Diff & Tree Boundary Check:**
  - `git diff --check`: 0 whitespace or patch conflicts across BE, SIM, and FE.
  - Exactly 26 authorized application/test files modified across the three repositories. Zero 27th file.
  - `Racehorse_Simulator_Web_v3` completely untouched.
  - Zero `.bat` files touched.
  - Zero Prisma schema changes or new migrations.

---

## 8. Slice G Implementation & Verification Summary (Approved CR-018)

### 8.1 Minimal implementation

1. `WorkoutDialog` accepts the existing `ExerciseType` as an optional `defaultType`; `TrialRunsPage` supplies `TRIAL`. Editing behavior and the default used by every other caller remain unchanged.
2. `TrialTab` records chart points per simulated second inside the existing fixed simulation substeps. Socket.IO telemetry remains driven by the existing 1 Hz real-clock ticker, so 60× changes wall-clock viewing duration without collapsing the curve or increasing network frequency.
3. The chart displays playback speed, simulated elapsed time and sample count. No new dependency, schema, migration, Backend runtime change, `_v3` edit or launcher edit was introduced by Slice G.
4. The real-stack E2E creates a distinctly marked TRIAL via the browser, verifies it survives reload, and transactionally deletes only that exact workout/audit residue. It also requires at least 90 chart samples at 60×.

### 8.2 Fresh verification evidence

- Backend full Jest outside the restricted temp-cache sandbox: **53/53 suites, 651/651 tests passed**.
- Backend typecheck and lint (`--max-warnings=0`): **PASS**.
- Simulator tests: **146/146 passed**; typecheck and production build: **PASS**.
- Frontend typecheck and production build: **PASS**. Frontend lint: **0 errors**; only pre-existing baseline warnings outside Slice G.
- Live real-stack Playwright, no route interception/mock:
  - `desktop-1440`: **8/8 passed**.
  - `desktop-1280`: **8/8 passed**.
  - Combined fresh project runs: **16/16 passed** against Main Web `5173`, Simulator `5175`, NestJS `3000` and PostgreSQL `equiflow`.
- `git diff --check`: **PASS** in Backend, Frontend and canonical Simulator.
- Post-test controlled reset: documented idempotent QA seed completed successfully. Direct PostgreSQL verification found `QA-T013-TRIAL-001` as `SCHEDULED`, `TRIAL`, 1800m, with no simulator session; Slice G E2E marker residue count is **0**.
- Final readiness: ports `3000`, `5173` and `5175` each returned HTTP **200** and were left running for reload-only Human QA.

### 8.3 Verification chronology disclosure

The initial RED attempt could not execute because the stack was not running. After PostgreSQL and the three npm services were started, the scheduling test exposed and corrected selector/confirmation handling in the test harness. A combined first run then hit the existing login-throttle retry beyond Playwright's 30-second default; the spec timeout was raised to 90 seconds without bypassing throttling. Both fresh browser projects subsequently passed completely.

## 9. Slice G Status Before Latest Human QA

Slice G implementation and automated/full-stack verification were complete, but human acceptance was not inferred. The task entered `AWAITING_USER_QA` and stopped. The later `trial_runs.docx` feedback below supersedes that gate state.

## 10. Human QA Follow-up from trial_runs.docx

The follow-up is treated as a TASK-013 rejection signal, but no exact approval command was inferred or manufactured.

1. **Future different-horse run:** the screenshot shows a workout scheduled for 2026-10-28 during QA on 2026-10-27. Main Web disables the launch action for `scheduledAt > now`; Backend independently returns `WORKOUT_NOT_STARTED`. The guard works, but the disabled reason is not sufficiently visible.
2. **Completed result transfer:** PostgreSQL contains completed Simulator results for `QA Zephyr Wind` and `QA T013 Trial Horse`. Live API calls return distance, duration, peak HR, top speed, surface and condition. Fresh Chromium navigation populated those exact objective values in both result forms. Recovery HR is null; performance score, completion judgment and professional comment remain blank.
3. **Required scope decision:** initial result hydration already exists, but an already-open form does not refresh on focus and does not identify Simulator-imported versus unavailable/human fields. Correcting that requires FE `SessionResultPage.tsx`, the twenty-ninth application/test file, and pulls a limited draft-hydration slice forward from TASK-016.

CR-019 was subsequently approved and exact `START TASK-013 CODEX` received. Corrective Slice H was implemented within the approved three-file boundary.

## 11. Slice H Implementation, Verification and Human QA Gate (Approved CR-019)

### 11.1 Minimal implementation

1. `TrialRunsPage.tsx` retains the existing FE scheduled-time block and Backend authority. A future row now displays its exact earliest launch date/time below the disabled Simulator button instead of relying on a hover-only title.
2. `SessionResultPage.tsx` reuses `GET /api/simulator/workouts/:workoutId/latest` on initial load, window focus and an explicit retry action while no Head Trainer result has been persisted. Dirty human edits are not overwritten by focus refresh.
3. A successful import is labeled `Loaded from Simulator` / `Đã tải từ Simulator`. Distance, duration, surface, condition, peak HR and top speed are imported. Recovery HR remains empty when unavailable; performance score, professional comment and abnormal signs remain human-only.
4. Completion is derived as `ACHIEVED` only for a `COMPLETED` session reaching the prescribed Simulator distance; aborted or short results derive `PARTIAL`. Importing a draft never submits the Head Trainer result.
5. `simulator-real-stack.spec.ts` verifies the visible future-time explanation and the open-form focus refresh, exact objective values, unavailable/subjective blanks and unchanged `WorkoutSession.status/resultRecordedAt` before the trainer explicitly saves.

### 11.2 RED → GREEN evidence

- RED: the future-workout browser check failed because `[data-testid="trial-launch-timing"]` did not exist.
- RED: the already-open result page failed because `[data-testid="simulation-result-source"]` did not appear after the Simulator completed.
- Intermediate GREEN check exposed an incorrect local completion comparison against `distance × repetitions`; the authoritative Simulator prescription and persisted result use `targetDistanceMeters`. The derivation was corrected to that existing contract.
- Focused real-stack checks: **2/2 passed** on `desktop-1280`.
- Full real-stack Playwright acceptance: **16/16 passed** across `desktop-1280` and `desktop-1440`, with live Main Web, canonical Simulator, NestJS and PostgreSQL and no request interception/mock fallback.
- Frontend production build/typecheck: **PASS**.
- Frontend lint: **PASS with 0 errors**; existing repository-wide baseline warnings remain outside Slice H.
- `git diff --check`: **PASS** in Backend, Frontend and canonical Simulator.
- Post-test QA reset: `npm run db:seed:manual-qa -- --confirm-local-qa` completed successfully against PostgreSQL `equiflow`, restoring deterministic named fixtures for reload-only Human QA.

### 11.3 Human Manual QA — ready

1. Keep Docker/PostgreSQL, Backend `3000`, Main Web `5173` and canonical Simulator `5175` running. Reload Main Web and sign in as `qa-trainer1@gmail.com` / `EquiFlow@2026`.
2. Open `http://localhost:5173/trials`. For a newly scheduled future trial, confirm **Chạy mô phỏng** is disabled and the exact **Có thể chạy từ ...** time is visible. This is expected; do not move the schedule or bypass Backend time validation.
3. Use the eligible named row `QA T013 Trial Horse` / `QA-T013-TRIAL-001`, open its result form in Main Web, then launch the Simulator from the trial row.
4. In Simulator, choose 60× and start. Confirm the runner stops at 1800 m, phase becomes DONE, and the summary remains visible.
5. Return to the already-open Main Web result tab. Confirm the blue **Đã tải từ Simulator** notice appears. If the browser did not deliver a focus event, press **Tải chỉ số từ Simulator** once; a normal full page reload must also load the same latest result.
6. Confirm distance/time/peak HR/top speed are populated; completion is **Đạt**; recovery HR is empty/unavailable; performance score and professional comment remain empty. Do not press **Lưu kết quả** unless intentionally completing the Head Trainer workflow.

### 11.4 Gate state

- TASK-013 is DONE and human-approved on 2026-10-27 (`APPROVE TASK-013` recorded in `APPROVALS.md`, superseding typo `APPROVE TASK-013v`).
- No commit, push, merge or TASK-014 work was performed.
- Execution is IDLE. Next eligible task is TASK-014 (unauthorized; awaits explicit human command `START TASK-014`).

### 11.5 Known accepted limitation

- **Simulator Reload Button Disabling on Dirty Edits:** In `SessionResultPage.tsx`, after the Head Trainer edits imported result fields (setting form state to dirty), the Simulator reload action button (`Tải chỉ số từ Simulator` / `Tải lại`) becomes disabled until the page is reloaded or edits are discarded. This guards in-progress trainer manual edits against unintended overwrite.
