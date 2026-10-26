# TASK-004 — Execution Report

- **Plan version:** v1-approved-r9
- **Status:** DONE (Approved by human QA on 2026-10-25)
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / starting: `6fff4e0` / ending: `6fff4e0` (canonical workflow coordination files updated, `prisma/seed.ts` expanded with abundant 16-horse dataset and multi-state tournaments)
  - Frontend: `main` / starting: `c5b4bc4` / ending: `c5b4bc4` (complete deletion of RFID fields/operations, modal viewport overflow fix, permissions route hardening, real-stack verification script)
- **Files Changed & Why:**
  1. `Racehorse_Training_Management_System_MT_FE/src/features/horses/pages/HorseFormPage.tsx`:
     - Completely removed `generateRfidCode()`, `rfid` state, `setRfid()` in `useEffect`, `rfid` regex validation, `finalRfid` variable, `rfid` property from both `createHorse` and `updateHorse` payloads, `setRfid()` from `andAddAnother`, and `DUPLICATE_RFID` error handler.
     - Removed the entire `<Field label={tr("RFID Tag Code (optional)")} ...>...</Field>` UI block from the form.
     - Payload now strictly contains canonical `{ name, breed, dob, gender, color, weightKg, microchip }`, perfectly aligning with Backend `CreateHorseDto`/`UpdateHorseDto`.
  2. `Racehorse_Training_Management_System_MT_FE/src/features/horses/pages/HorseDetailPage.tsx`:
     - Removed the `horse.rfid` quick-copy pill and the `RFID Tag Code` detail block and copy button.
  3. `Racehorse_Training_Management_System_MT_FE/src/features/horses/pages/HorseListPage.tsx`:
     - Updated search placeholder from `"Name, HR code, microchip or RFID"` to `"Name, HR code or microchip"`.
  4. `Racehorse_Training_Management_System_MT_FE/src/features/horses/types.ts`:
     - Removed `rfid?: string;` from `Horse`, `CreateHorsePayload`, and `UpdateHorsePayload` interfaces.
  5. `Racehorse_Training_Management_System_MT_FE/src/shared/mock/horsesData.ts` & `src/shared/mock/handlers.ts`:
     - Removed `rfid` properties, search filters, and `DUPLICATE_RFID` validation from mock data and mock handlers.
  6. `Racehorse_Training_Management_System_MT_FE/src/shared/components/ui/Modal.module.css`:
     - Reconfigured `.dialog` to flex column layout with `max-height: calc(100vh - 48px); overflow: hidden; display: flex; flex-direction: column;`.
     - Pinned header `.head` with `flex-shrink: 0; border-bottom: 1px solid var(--border);`.
     - Pinned footer `.foot` with `flex-shrink: 0; border-top: 1px solid var(--border); background: var(--surface);`.
     - Scrolled only `.body` with `flex: 1 1 auto; overflow-y: auto; min-height: 0;`.
     - Added responsive mobile styles (`max-width: 640px`): `.dialog` uses `width: calc(100vw - 24px); max-height: calc(100vh - 24px);`.
  7. `Racehorse_Training_Management_System_MT_FE/src/shared/components/ui/Modal.tsx`:
     - Wrapped modal rendering with `createPortal(..., document.body)` from `react-dom` to prevent ancestor layout transforms from trapping fixed positioning.
  8. `Racehorse_Training_Management_System_MT_FE/src/features/racing/components/RaceRegistrationModal.tsx`:
     - Removed nested scroll containers (`maxHeight: 220px, overflowY: auto` and `maxHeight: 180px, overflowY: auto`) so the single modal body handles scrolling cleanly.
     - Wrapped footer action buttons with `flexWrap: "wrap", gap: "0.5rem"` for mobile viewports.
  9. `Racehorse_Training_Management_System_MT_BE/prisma/seed.ts`:
     - Seeded 16 horses covering 100% of statuses (ACTIVE, IN_TRAINING, UNDER_OBSERVATION, INJURED, ISOLATED, RESTING, RETIRED).
     - Seeded active training plans (`GA-000095` through `GA-000103`) and 4 completed workouts in the past 30 days for 8 eligible tournament horses.
     - Seeded 7 tournaments across OPEN, CLOSED, UPCOMING, COMPLETED, CANCELLED states.
     - Initialized `training_plan` and `horse_code` counters to prevent code collisions.
  10. `Racehorse_Training_Management_System_MT_FE/tests/e2e/modal-viewport.spec.ts`:
      - Playwright test verifying header/footer pinning, single body scrolling, action visibility, and bounding box constraints across `1366x768`, `1280x720`, and `390x844` at 100% browser zoom against the live dev server (`http://localhost:5173`).
  11. `Racehorse_Training_Management_System_MT_FE/tests/e2e/verify-task004-real-stack.mjs`:
      - Reproducible real-stack integration verifier executing directly against live NestJS API (`http://localhost:3000/api`) and PostgreSQL (`equiflow-postgres`).
  12. Canonical coordination documents in `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/`:
      - `APPROVALS.md`: Appended human rejection commands and rework records.
      - `CHANGES.md`: Updated `DEFECT-001` to `RESOLVED_BY_HUMAN_DIRECTIVE`.
      - `STATE.md`: `active_task: NONE`, `active_task_status: IDLE`, `next_task: TASK-005`, `last_approved_task: TASK-004`.
      - `TASKS.md`: TASK-004 status `DONE`.
      - `PROGRESS.md`: Updated counts (`DONE: 4`, `AWAITING_USER_QA: 0`, `next_task: TASK-005`).
      - `HANDOFF.md`: Updated handoff state for TASK-004 DONE and IDLE execution awaiting START TASK-005.

---

## Acceptance Criteria Checklist (CR-010 & TASK-004)

- [x] **AC-1:** Head Trainer can plan, schedule, and run valid/due trials and workouts.
- [x] **AC-2:** Head Trainer can check race eligibility, register while OPEN, scratch with reason while OPEN or CLOSED, and view published completed tournament results.
- [x] **AC-3:** Head Trainer cannot record, edit, or lock tournament results (API returns HTTP 403; UI hides result entry).
- [x] **AC-4:** Head Trainer cannot mutate horse profile master data (`/horses/new`, `/horses/:id/edit`, `/horses/deleted`, transfer, delete all fail closed with client-side 403 page and backend HTTP 403; UI actions hidden).
- [x] **AC-5:** Head Trainer cannot mutate event definitions or change tournament statuses (API returns HTTP 403; UI actions hidden).
- [x] **AC-6:** Head Trainer cannot mutate accounts or permissions (`/accounts`, `/staff`, `/accounts/:id/permissions` render client-side 403 page and backend returns HTTP 403; self-profile has role read-only without permission switches).
- [x] **AC-7:** Route guard permits Head Trainer on `/plans/new` and `/training/plans/:id/edit`; blocks unauthorized actors with client-side 403 page; Club Manager receives client-side 403 on plan authoring and backend normalizes `createPlan` to false.
- [x] **AC-8 (Rejection Directive 1 — Complete RFID Removal):** All `rfid` UI fields, state variables, generator functions, validation rules, and payload properties were completely deleted from Frontend (`HorseFormPage.tsx`, `HorseDetailPage.tsx`, `HorseListPage.tsx`, `types.ts`, and mock handlers). Club Manager horse creation via API succeeds with HTTP 201 Created without `property rfid should not exist` error.
- [x] **AC-9 (Rejection Directive 2 — Abundant Database Seeding):** Database seeded with abundant, realistic dataset: 16 horses, 10 eligible horses in `seed-tourn-2` (including 8 unregistered candidate horses), 5 ineligible horses covering varied reasons, and 7 tournaments across OPEN, CLOSED, UPCOMING, COMPLETED, and CANCELLED states.
- [x] **AC-10 (Modal Viewport at 100% Zoom):** `RaceRegistrationModal` verified at `1366x768`, `1280x720`, and `390x844` viewports at 100% zoom with pinned header and footer, single body scrolling, and no nested scrollbars.

---

## Verification Evidence

### Section 1 — Live Club Manager Horse Creation (Proof of RFID Removal)

- **Test Command:**
  ```bash
  POST http://localhost:3000/api/horses
  Authorization: Bearer <Club Manager Token>
  Payload: {
    "name": "Test Victory 2562",
    "breed": "Thoroughbred",
    "dob": "2022-03-15",
    "gender": "Stallion",
    "color": "Bay Dark",
    "weightKg": 490
  }
  ```
- **Live Server Response:**
  ```json
  {
    "statusCode": 201,
    "success": true,
    "data": {
      "id": "3b5d004e-79ed-45cb-870e-bedd02b4219e",
      "horseCode": "HR-000101",
      "name": "Test Victory 2562",
      "microchip": "985043482926029",
      "microchipRfid": "985043482926029",
      "breed": "Thoroughbred",
      "dob": "2022-03-15T00:00:00.000Z",
      "gender": "Stallion",
      "color": "Bay Dark",
      "weightKg": 490,
      "status": "RESTING",
      "isMedicalLocked": false
    }
  }
  ```
- **Outcome:** **HTTP 201 Created**. No `property rfid should not exist` validation error. Microchip number automatically generated according to ISO standard (`985043482926029`).

---

### Section 2 — Abundant Controlled PostgreSQL Dataset

Live query evidence from `GET /tournaments/seed-tourn-2/eligibility`:

```text
Status code: 200
Eligible horses count: 10
Eligible horses:
 - Apollo Chariot (HR-000010): registered=false
 - Crimson Flash (HR-000014): registered=false
 - Desert Mirage (HR-000011): registered=false
 - Golden Eclipse (HR-000005): registered=false
 - Ironclad Titan (HR-000013): registered=false
 - Ocean Breeze (HR-000015): registered=false
 - Pegasus Dream (HR-000004): registered=true
 - Starlight Express (HR-000012): registered=false
 - Storm Runner (HR-000006): registered=false
 - Thunderbolt Swift (HR-000001): registered=true
Ineligible horses count: 5
 - Bucephalus Brave (HR-000016): reasons=["Insufficient recent training sessions (2/4 required in past 30 days)"]
 - Midnight Mirage (HR-000007): reasons=["Horse is currently under Veterinary Medical Lock","Horse health status is currently ISOLATED","Insufficient recent training sessions (0/4 required in past 30 days)"]
 - Northern Dancer Legacy (HR-000002): reasons=["Horse is currently under Veterinary Medical Lock","Horse health status is currently INJURED","Insufficient recent training sessions (0/4 required in past 30 days)"]
 - Red Velvet (HR-000008): reasons=["Insufficient recent training sessions (0/4 required in past 30 days)"]
 - Shadowfax Wonder (HR-000003): reasons=["Horse health status is currently UNDER_OBSERVATION","Insufficient recent training sessions (0/4 required in past 30 days)"]
```

**Seeded Tournaments Across Lifecycles:**
1. `seed-tourn-1`: "Grand Autumn Cup 2026" — `COMPLETED` with official results, rankings, times, and prize money.
2. `seed-tourn-2`: "Saigon Spring Sprint 2026" — `OPEN_REGISTRATION` (Sprint 1200m, Synthetic, future race date & deadline) with 8 unregistered eligible horses ready for manual registration and scratch.
3. `seed-tourn-open-2`: "Mekong Delta Championship 2026" — `OPEN_REGISTRATION` (Distance 1600m, Turf, future race date & deadline) with 0 registrations (100% clean open event).
4. `seed-tourn-closed-1`: "Central Highlands Gold Cup 2026" — `CLOSED_REGISTRATION` (Distance 2000m, Turf, registration deadline passed) with 2 confirmed registrations.
5. `seed-tourn-3`: "National Endurance Derby 2026" — `UPCOMING` (Distance 3200m, Dirt).
6. `seed-tourn-cancelled`: "Phu Tho Summer Classic 2026" — `CANCELLED`.
7. `seed-tourn-comp-2`: "Da Nang Grand Sprint 2026" — `COMPLETED`.

---

### Section 3 — Modal Viewport Verification

- **Test Spec:** `Racehorse_Training_Management_System_MT_FE/tests/e2e/modal-viewport.spec.ts`
- **Command:** `npx playwright test tests/e2e/modal-viewport.spec.ts`
- **Exit Code:** `0`
- **Results:** 6 passed (across `desktop-1280` and `desktop-1440` test projects)

| Viewport | Category | Dialog Box (y, h) | Viewport Height | Header Status | Footer Status | Actions Visible | Body Scrolls Only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1366 x 768** | Desktop Standard | `y = 24px`, `h = 720px` | 768px | Pinned (`flex-shrink: 0`) | Pinned (`flex-shrink: 0`) | Yes (Close, Scratch, Register) | Yes (`overflow-y: auto`, no inner scroll) |
| **1280 x 720** | Desktop Compact | `y = 24px`, `h = 672px` | 720px | Pinned (`flex-shrink: 0`) | Pinned (`flex-shrink: 0`) | Yes (Close, Scratch, Register) | Yes (`overflow-y: auto`, no inner scroll) |
| **390 x 844** | Mobile (iPhone 12/13/14) | `y = 12px`, `h = 820px` | 844px | Pinned (`flex-shrink: 0`) | Pinned (`flex-shrink: 0`) | Yes (wrapped flex footer) | Yes (`overflow-y: auto`, no inner scroll) |

**Verbatim Playwright Output:**
```text
Running 6 tests using 1 worker

[1366x768 (Desktop Standard)] dialogBox: y=24, h=720, vp.h=768
  ok 1 [desktop-1280] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 1366x768 (Desktop Standard) (zoom 100%) (4.7s)
[1280x720 (Desktop Compact)] dialogBox: y=24, h=672, vp.h=720
  ok 2 [desktop-1280] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 1280x720 (Desktop Compact) (zoom 100%) (4.5s)
[390x844 (Mobile iPhone 12/13/14)] dialogBox: y=12, h=820, vp.h=844
  ok 3 [desktop-1280] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 390x844 (Mobile iPhone 12/13/14) (zoom 100%) (4.6s)
[1366x768 (Desktop Standard)] dialogBox: y=24, h=720, vp.h=768
  ok 4 [desktop-1440] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 1366x768 (Desktop Standard) (zoom 100%) (4.8s)
[1280x720 (Desktop Compact)] dialogBox: y=24, h=672, vp.h=720
  ok 5 [desktop-1440] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 1280x720 (Desktop Compact) (zoom 100%) (4.3s)
[390x844 (Mobile iPhone 12/13/14)] dialogBox: y=12, h=820, vp.h=844
  ok 6 [desktop-1440] › tests\e2e\modal-viewport.spec.ts:21:5 › RaceRegistrationModal Viewport & Responsive Verification › Modal header/footer pinned, actions visible and only body scrolls at 390x844 (Mobile iPhone 12/13/14) (zoom 100%) (4.6s)

  6 passed (30.2s)
```

---

### Section 4 — Real-Stack Live Integration Evidence

- **Script:** `Racehorse_Training_Management_System_MT_FE/tests/e2e/verify-task004-real-stack.mjs`
- **Command:** `node tests/e2e/verify-task004-real-stack.mjs`
- **Exit Code:** `0`
- **Verbatim Standard Output:**

```text
=== TASK-004 Real-Stack Verification ===
Target API: http://localhost:3000/api

[1] Authenticating as Head Trainer...
-> Logged in as: David Nguyen (Head Trainer) (trainer@gmail.com), Role: HEAD_TRAINER, ID: 09b288ad-fe40-42fa-860b-d9ccd85e5844

[2] Discovering active Grooms dynamically via GET /training/grooms...
-> Selected Groom: John Smith (Groom Hand) (8d19fece-09f1-46a1-8830-0420a0b07ac6)

[3] Discovering active horse with available daily workout slots...
-> Selected horse for training plan: Test Victory 2562 (3b5d004e-79ed-45cb-870e-bedd02b4219e)

[R-3.1] Creating Training Plan as Head Trainer...
POST /training/plans -> Status: 201
-> Created Plan ID: 2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d, Code: GA-000151, Status: DRAFT
-> DB Verification: 2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d|GA-000151|DRAFT|3b5d004e-79ed-45cb-870e-bedd02b4219e

[R-3.1b] Editing Training Plan as Head Trainer...
PUT /training/plans/2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d -> Status: 200
-> DB Verification After Edit: 2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d|Derby 2026 Stamina Peak Plan (Updated)|58

[R-3.2] Scheduling Workout Session as Head Trainer...
POST /training/plans/2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d/workouts -> Status: 201
-> Created Workout ID: 57ddc82a-01fb-416b-8b22-523bbd943517, Status: SCHEDULED, Scheduled: 2026-10-25T03:00:00.000Z
-> DB Verification: 57ddc82a-01fb-416b-8b22-523bbd943517|CANTER|SCHEDULED|2fc0fe83-02d9-4d05-bdb5-8387fbd67a7d

[R-3.3] Starting Simulator Session with Real Workout ID...
POST /simulator/workouts/57ddc82a-01fb-416b-8b22-523bbd943517/start -> Status: 201
-> Created SimulatorSession ID: c894e929-dd19-4619-9332-d72ad010a5ee, Status: PENDING, Launch: http://localhost:5175/?sessionId=c894e929-dd19-4619-9332-d72ad010a5ee
-> DB Verification: c894e929-dd19-4619-9332-d72ad010a5ee|WORKOUT|PENDING|57ddc82a-01fb-416b-8b22-523bbd943517

[R-3.4] Discovering OPEN tournament and fetching eligibility...
-> Found OPEN tournament "Verification Target Tournament 2026" (7a93eb39-47a0-40ec-9505-95b4df501427) with 6 unregistered eligible horses
-> Selected candidate horse: "Apollo Chariot" (b661fa81-dcd9-40d3-9d12-8074e76bd57d)
GET /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/eligibility -> Status: 200, Total Eligible: 10

[R-3.5] Registering Horse for OPEN Tournament as Head Trainer...
POST /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/registrations -> Status: 201
-> Registration Created ID: f5050103-aa13-4bdc-b101-bfe4649a2179, Status: REGISTERED
-> DB Before Scratch: f5050103-aa13-4bdc-b101-bfe4649a2179|REGISTERED|7a93eb39-47a0-40ec-9505-95b4df501427|b661fa81-dcd9-40d3-9d12-8074e76bd57d

[R-3.6] Scratching Active Registration with Required Reason as Head Trainer...
DELETE /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/registrations/f5050103-aa13-4bdc-b101-bfe4649a2179?reason=... -> Status: 200
-> DB After Scratch: f5050103-aa13-4bdc-b101-bfe4649a2179|SCRATCHED_MEDICAL|Real-stack registration evidence for TASK-004 | Scratched: Precautionary veterinary rest advised by trainer

[R-3.7] Reading Published Completed Tournament Results as Head Trainer...
GET /tournaments/8994b37e-f99b-48c6-b614-17ad79014337 -> Status: 200
-> Tournament: CR-008 Verification Stakes 2026, Status: COMPLETED, Registrations: 1
-> Sample Official Result: Horse "Thunderbolt Swift", Rank: 1, Time: 98.75s, Prize: 0

[C-1] Verifying Club Manager cannot author plans or retain createPlan...
PUT /accounts/f9e2460b-dbb4-4a23-9de4-2cd89b07fa7a/permissions (createPlan=true) -> returned createPlan: false
-> DB Verification for CM createPlan: "false" (expected false or not set)
Club Manager POST /training/plans -> Status: 403 (Forbidden as expected)

[Negative Boundaries (R-e)] Verifying HTTP 403 Forbidden on Prohibited Endpoints...
  [PASS] Create Tournament (POST /tournaments) -> Status: 403 (Expected: 403)
  [PASS] Edit Tournament (PATCH /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427) -> Status: 403 (Expected: 403)
  [PASS] Change Tournament Status (PATCH /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/status) -> Status: 403 (Expected: 403)
  [PASS] Delete Tournament (DELETE /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427) -> Status: 403 (Expected: 403)
  [PASS] Record Tournament Results (POST /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/results) -> Status: 403 (Expected: 403)
  [PASS] Lock Tournament Results (R-e) (POST /tournaments/7a93eb39-47a0-40ec-9505-95b4df501427/lock-results) -> Status: 403 (Expected: 403)
  [PASS] Create Horse Profile (POST /horses) -> Status: 403 (Expected: 403)
  [PASS] Update Horse Profile (PUT /horses/3b5d004e-79ed-45cb-870e-bedd02b4219e) -> Status: 403 (Expected: 403)
  [PASS] Transfer Horse Owner (PATCH /horses/3b5d004e-79ed-45cb-870e-bedd02b4219e/transfer-owner) -> Status: 403 (Expected: 403)
  [PASS] Delete Horse (DELETE /horses/3b5d004e-79ed-45cb-870e-bedd02b4219e) -> Status: 403 (Expected: 403)
  [PASS] Restore Horse Profile (R-e) (POST /horses/3b5d004e-79ed-45cb-870e-bedd02b4219e/restore) -> Status: 403 (Expected: 403)
  [PASS] View Deleted Horses (GET /horses/deleted) -> Status: 403 (Expected: 403)
  [PASS] View Accounts (GET /accounts) -> Status: 403 (Expected: 403)
  [PASS] Mutate Permissions (PUT /accounts/09b288ad-fe40-42fa-860b-d9ccd85e5844/permissions) -> Status: 403 (Expected: 403)
  [PASS] Acknowledge Medical Alert (PATCH /training/alerts/alert-1) -> Status: 403 (Expected: 403)

=== Real-Stack Verification Completed Successfully ===
```

---

### Section 5 — Static Checks & Linters

1. **Frontend Typecheck:**
   - Command: `npm run typecheck`
   - Exit code: `0`
   - Output: `tsc --noEmit` passed with 0 errors.

2. **Frontend Linter:**
   - Command: `npm run lint`
   - Exit code: `0`
   - Output: Oxlint passed with 0 errors.

3. **Backend Full Unit & Integration Test Suites:**
   - Command: `npm test`
   - Exit code: `0`
   - Results: 52 suites passed, 509 tests passed, 0 failures.

---

## Section 6 — Step-by-Step Manual QA Guide for Real-Stack Verification

### Step 1: Verify Horse Creation as Club Manager (No RFID)
1. Sign in as Club Manager: `manager@gmail.com` / `EquiFlow@2026`.
2. Navigate to `/horses` $\rightarrow$ click **"+ Add Horse"** (`/horses/new`).
3. Verify that the form contains **NO** "RFID Tag Code" input field.
4. Fill in:
   - Name: `Shadow Phoenix`
   - Breed: `Thoroughbred`
   - Date of Birth: `2022-01-15`
   - Gender: `Stallion`
   - Color: `Bay Dark`
   - Weight: `495`
   - (Microchip automatically generated 15 digits)
5. Click **"Save"**: Confirm horse is created successfully with HTTP 201 and redirect to `/horses/:id`.
6. On the horse detail page, confirm that the Microchip is displayed and no RFID pills or errors appear.

### Step 2: Sign in as Head Trainer & Verify Modal Viewport
1. Sign out and sign in as Head Trainer: `trainer@gmail.com` / `EquiFlow@2026`.
2. Navigate to **Tournaments** (`/racing`) $\rightarrow$ **Open for Registration** tab.
3. Locate **"Saigon Spring Sprint 2026"** (`seed-tourn-2`) or **"Mekong Delta Championship 2026"** (`seed-tourn-open-2`).
4. Click **"Register Horse"**:
   - Inspect header: "Register Horses for Tournament" stays pinned at the top.
   - Inspect footer: buttons "Close", "Scratch", "Register" stay pinned at the bottom and are 100% visible at 100% browser zoom across `1366x768`, `1280x720`, and `390x844`.
   - Inspect list body: smoothly scrolls as a single unified container with NO nested scroll regions.

### Step 3: Test Abundant Eligible Horses (Register $\rightarrow$ Scratch Flow)
1. In the modal under **"Eligible Horses"**, observe the abundant pool of candidate horses (including `Apollo Chariot`, `Crimson Flash`, `Desert Mirage`, `Golden Eclipse`, `Ironclad Titan`, `Ocean Breeze`, `Starlight Express`, `Storm Runner`).
2. Click **"Register"** on any eligible candidate (e.g. `Apollo Chariot`):
   - Horse immediately moves to "Registered Horses" with `REGISTERED` badge.
3. Click **"Scratch"** on `Apollo Chariot`:
   - Enter reason: `Precautionary veterinary rest advised by trainer`.
   - Submit: Confirm horse status updates to `SCRATCHED_MEDICAL` with the reason recorded.
4. Notice that even after scratching, you still have 7+ eligible horses remaining to test additional registrations!

### Step 4: Verify Negative Boundary Controls & Route Guards
1. Switch to **Completed** tab $\rightarrow$ "View Results": Confirm results, times, and rankings are displayed in read-only mode. Confirm NO "+ Create Tournament", "Edit", "Cancel Event", or "Record Results" buttons appear.
2. Navigate to `http://localhost:5173/plans/new`: Loads plan wizard normally.
3. Navigate to prohibited URLs (`/horses/new`, `/horses/deleted`, `/accounts`, `/staff`): Confirmed immediate client-side **403 Forbidden** page.
