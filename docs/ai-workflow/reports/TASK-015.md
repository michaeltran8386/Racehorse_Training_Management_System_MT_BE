# TASK-015 — Execution Report

| Parameter | Value |
| :--- | :--- |
| **Task** | TASK-015 — Complete real horse/stall catalogue→SIM data flow |
| **Plan Version** | v1-approved-r20 |
| **Status** | DONE (Approved 2026-10-28) |
| **Authorizing Command** | `START TASK-015` (Plan: v1-approved-r20, approved CR-021 incorporated) |
| **Active Task / Next Task** | `NONE` (IDLE) / `TASK-016` (unauthorized) |
| **Authorized Scope Budget** | Exactly 5 files (Scope M) |
| **Modified Application & Test Files** | 1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.ts`<br>2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts`<br>3. `Racehorse_Simulator_Web/src/ui/App.tsx`<br>4. `Racehorse_Simulator_Web/src/api/horseMapper.test.ts`<br>5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts` |
| **Reproducible Real-Stack Verifier** | `scratch/verify_task015_real_stack.mjs` |
| **Canonical Simulator** | `Racehorse_Simulator_Web` (Port 5175) |
| **Reference Directory (Untouched)** | `Racehorse_Simulator_Web_v3` (0 modifications, 0 references) |
| **Preserved Root Scripts** | `setup-db.bat`, `start.bat`, `stop.bat` (0 modifications, untouched) |
| **Real Stack Under Test** | NestJS Backend (`http://localhost:3000`), PostgreSQL Docker (`equiflow:5432`), Frontend (`http://localhost:5173`), Canonical Simulator (`http://localhost:5175`) |

---

## 1. Summary of Approved Implementation (CR-021)

TASK-015 implements direct, unauthenticated catalogue loading for the canonical Simulator from PostgreSQL, adhering strictly to the approved runtime boundary of CR-021:

1. **Direct Catalogue Access Without Login Gate:**
   - Navigating directly to `http://localhost:5175/` without a `sessionId` or token no longer blocks the user or requires a login screen.
   - Simulator invokes `listHorses()` (`GET /api/simulator/horses`), retrieving all real horses from PostgreSQL where `deletedAt: null`.
   - Each horse is mapped using `toHorseProfile`, preserving:
     - Real PostgreSQL UUID as `id`.
     - Full 15-digit microchip (`microchip` / `microchipRfid`).
     - Active stall code (`stallCode` / `zone`).
     - Real weight (`weightKg`).

2. **Security & Session Boundary Invariants:**
   - Simulator URLs and storage contain NO long-lived JWT access tokens (R-1 compliant).
   - In direct mode, Socket.IO session transport is disconnected and non-authoritative.
   - Authoritative business write-back (workouts, trial runs, vet exams, results) still requires a backend-issued `sessionId` in the URL (e.g. `/?sessionId=<UUID>`).
   - When a session is present, REST context and Socket.IO bind the exact same persisted session actor (`session.actorUserId`), and unauthorized/inactive actors fail closed with HTTP 403.

3. **Visible Failure Without Mock Fallback:**
   - If the Backend or PostgreSQL is unreachable, `App.tsx` catches the failure and renders a clear error notification with role `status` and a "Thử tải lại" button.
   - The application **never** falls back to mock, sample, or default fake horses.

4. **HUD & Navigation Integration:**
   - When opened directly without a session, the top header displays `📋 Danh mục trực tiếp (N ngựa)` instead of a workout/exam badge.
   - Clicking "Ngựa" opens the `HorseList` modal containing the full PostgreSQL catalogue.
   - Clicking any horse opens `HorseCard` displaying its authoritative UUID, 15-digit microchip, active stall code, and weight.
   - Switching to the "Đường đua" screen populates the `HorsePicker` with real horses.

---

## 2. Automated Test Results & Verification Evidence

### 2.1 Backend Simulator Test Suite (`npm test -- src/simulator`)
- Command: `npm test -- src/simulator`
- Result: **77 passed, 77 total across 3 suites (Exit Code: 0)**
  - `src/simulator/simulator.service.spec.ts`: 44 passed (including `getHorsesForSimulator` tests)
  - `src/simulator/simulator.controller.spec.ts`: 7 passed
  - `src/simulator/simulator.gateway.spec.ts`: 26 passed

### 2.2 Backend Typecheck & Lint
- `npm run typecheck`: **Exit code 0 (0 type errors)**
- `npx eslint src/simulator/simulator.service.ts src/simulator/simulator.service.spec.ts`: **Exit code 0 (0 errors, 0 warnings)**

### 2.3 Simulator Web Tests & Build
- `npm test`: **148 passed, 148 total across all suites (Exit Code: 0)**
- `npm run build`: **Exit code 0 (Vite build completed cleanly in 373ms)**
- `git diff --check`: **Exit code 0 (clean, no trailing whitespace or formatting errors)**

### 2.4 Playwright Real Chromium E2E Suite (`tests/e2e/simulator-real-stack.spec.ts`)
```
Running 8 tests using 1 worker

  ok 1 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:118:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › TASK-015: Direct access to port 5175 without session loads real catalogue from PostgreSQL without login screen (6.6s)
  ok 2 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:156:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Slice G: Trial Runs scheduling creates a TRIAL row visible after reload (5.8s)
  ok 3 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:219:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Head Trainer trial run: immutable setup, no obstacle authoring, stops at distance, DONE & summary, 1 finish packet & DB persistence (12.3s)
  ok 4 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:387:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Veterinarian exam: no intro, UI finish -> sim:exam_finished -> ACK -> return/close -> auto-load on focus (6.4s)
  ok 5 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:514:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › VitalsDisplay: displays within/outside reference range badges and disclaims health/injury/lock status (3.4s)
  ok 6 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:554:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › Persistence and reload: Simulator and Main Web refetch latest data after page reload (5.6s)
  ok 7 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:583:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-12: Veterinarian exam on horse with absent master weight (QA T013 Exam Horse) (5.9s)
  ok 8 [desktop-1280] › tests\e2e\simulator-real-stack.spec.ts:676:3 › TASK-013: Real-stack Head Trainer & Veterinarian Simulator integration › R-13: Medical record list displays real horse name and horse code without raw UUID fallback (3.4s)

  8 passed (51.4s)
```

### 2.5 Real-Stack Verifier Script Output (`scratch/verify_task015_real_stack.mjs`)
```
=== TASK-015 Real-Stack Comprehensive Verifier ===

1. Authenticating through real /api/auth/login flow...
[PASS] Real login succeeded for CM, Trainer, and Groom.

2. Verifying horse, 15-digit microchip, active stall and groom assignment in PostgreSQL...
[PASS] Target Horse: 0headphone (42be0807-bc88-4079-b43e-acaf84ffc79b)
[PASS] Microchip: 985214907042538 (len=15)
[PASS] Active Stall: STALL-A08
[PASS] Assigned Groom ID: 8d19fece-09f1-46a1-8830-0420a0b07ac6
[PASS] Eligible Scheduled Workout ID: b99a95f8-b2c9-4065-a755-e91fab7f3d65

3. Proving CM and Groom session issuance endpoints do NOT exist...
[PASS] Club Manager workout session issuance is rejected with 403 (does not exist).
[PASS] Club Manager exam session issuance is rejected with 403 (does not exist).
[PASS] Groom workout session issuance is rejected with 403 (does not exist).
[PASS] Groom exam session issuance is rejected with 403 (does not exist).

4. Proving Head Trainer workout session issuance contains ONLY sessionId and NEVER token...
[PASS] Trainer start response: {
  sessionId: '8cb86409-ed6e-4b7b-b472-078128787f68',
  status: 'PENDING',
  launchUrl: 'http://localhost:5175/?sessionId=8cb86409-ed6e-4b7b-b472-078128787f68'
}
[PASS] launchUrl contains sessionId only and NEVER contains token (R-1 compliant).

5. Testing Simulator context retrieval without token (bound to session actor in PostgreSQL)...
[PASS] Head Trainer context: horse UUID=42be0807-bc88-4079-b43e-acaf84ffc79b, unmasked chip=985214907042538, stall=STALL-A08

6. Testing Assigned Groom session binding and microchip masking...
[PASS] Assigned Groom session context: masked chip=***********2538 (len=15), stall=STALL-A08

7. Testing Unassigned Groom session rejection (fails closed, leaks no data)...
[PASS] Unassigned Groom rejected with 403: You are not assigned to groom this horse.

8. Testing Horse Owner session rejection...
[PASS] Horse Owner rejected with 403.

9. Testing that arbitrary JWT cannot override session.actorUserId...
[PASS] Verified: arbitrary Groom JWT cannot override session.actorUserId (actor remains Trainer with unmasked chip).

10. Testing Club Manager observing Trainer session...
[PASS] Club Manager successfully observed session with unmasked microchip: 985214907042538

11. Testing Socket.IO connection binds same actor with auth.sessionId...
[PASS] Socket.IO connected with socket.id: EPh9NW8Gg6zXWDZmAAAF

12. Testing direct horse/stall catalogue endpoint (/api/simulator/horses)...
[PASS] Direct catalogue returned 48 horses from PostgreSQL
[PASS] Target horse preserved UUID=42be0807-bc88-4079-b43e-acaf84ffc79b, full chip=985214907042538, stallCode=STALL-A08, weightKg=344

=== ALL TASK-015 REAL-STACK VERIFICATIONS PASSED ===
```

---

## 3. Human QA Acceptance Procedure

To verify TASK-015 manually on the running local stack:

### Step 1: Direct Simulator Access (No Session, No Login Screen)
1. Open a browser tab directly to `http://localhost:5175/`.
2. **Expected:**
   - The Simulator opens immediately without redirecting to a login page.
   - There is NO username/password form.
   - The top header shows `📋 Danh mục trực tiếp (48 ngựa)` (matching PostgreSQL horse count).
   - Socket connection indicator displays "Ngoại tuyến" (since direct mode is non-authoritative).

### Step 2: Catalogue Browsing & Horse Profile Inspection
1. Click the **"Ngựa"** button on the bottom control dock.
2. **Expected:**
   - The `Đàn ngựa · 48` popup opens displaying real horses from PostgreSQL (e.g. `QA Zephyr Wind`, `0headphone`, `QA Stellar Flash`).
3. Click on **`QA Zephyr Wind`** (or `0headphone`).
4. **Expected:**
   - The `HorseCard` popup opens showing:
     - Full 15-digit microchip (`985214907042538` or `985141099000001`).
     - Real active stall code (e.g. `STALL-A08` or `STALL-QA01`).
     - Real weight (e.g. `490 kg`).
     - Accurate breed, gender, and status.

### Step 3: Track Navigation & HorsePicker
1. Click the **"Khu vực" -> "Đường đua"** button in the header.
2. Select the **"CHẠY THỬ"** (Trial) tab.
3. **Expected:**
   - The horse picker strip at the top contains all real horses from the PostgreSQL catalogue.
   - Selecting a horse updates the trial horse profile.

### Step 4: Verification of Visible Failure Without Fallback
1. Stop the Backend container/service or test with an invalid URL.
2. Reload `http://localhost:5175/`.
3. **Expected:**
   - A visible error box displays: *"Không thể nạp dữ liệu từ Máy chủ Backend."*
   - A *"Thử tải lại"* button is visible.
   - The Simulator does **NOT** fall back to fake/mock horses.

---

## 4. Current State & Handoff Gate

- **Active Task:** `NONE`
- **Active Task Status:** `IDLE`
- **Last Approved Task:** `TASK-015` (Approved 2026-10-28 via `APPROVE TASK-015`)
- **Next Task:** `TASK-016` (UNAUTHORIZED until explicit human `START TASK-016`)
- Antigravity IDE has completed all implementation and automated verification for TASK-015. Human approval `APPROVE TASK-015` is recorded in `APPROVALS.md`. Execution is IDLE and stops here.

