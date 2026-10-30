# TASK-019 — Codex acceptance continuation (CR-029)

**Plan:** v1-approved-r28. **Executor:** Codex, explicitly authorized by APPROVE CR-029 and START TASK-019 CODEX on 2026-10-30 Asia/Bangkok.
**Current status:** DONE — Human-approved 2026-10-30 by exact command `approve và authorize task-019`. Execution IDLE. Scoped separate BE/FE commits authorized but not executed; no deployment authority.

2026-10-30: Human command `approve và authorize task-019` approves TASK-019 under Plan v1-approved-r28 and authorizes scoped commit preparation/execution in separate Backend and Frontend commits. Exact wording preserved; no claim that Human personally executed manual QA. Acceptance evidence remains one full FE run (207 pass / 1 fail / 3 skips) followed by green targeted 17/17, not a fresh all-green full run. No push, merge, deploy, original database writes, new feature or next task is authorized.

## Current verified changes

- Serialize standalone lock, combined record-and-lock, and draft result writes on the same PostgreSQL tournament row. Read and validate status/registrations/results only after SELECT FOR UPDATE; preserve current errors, race-date/role rules, transaction rollback and post-commit audit/notifications.
- Resolve supply zones/catalogue by stable codes. Missing disposable stock rows are test-owned fixtures; exact-ID removal or original-row restoration includes quantity/notes/updatedAt, plus sentinel preservation. No baseline zone insertion/reseed.
- Simulator test role sessions are reused; fresh logins respect real Retry-After with bounded attempts, guards unchanged. Setup helper extends only for an actual bounded throttle wait and asserts retry status.
- Current browser screenshots go to ignored FE test-results/task019-evidence, never overwrite historical canonical PNGs.

## Current checks (not historical claims)

| Check | Result |
| --- | --- |
| Three new stale-writer regression cases before fix | 3 failed as expected; Jest sandbox cache errors were environment failures, not product results |
| Focused tournament service unit suite after fix | 59/59 PASS, exit 0 |
| Real NestJS + PostgreSQL tournament lifecycle | 8/8 PASS, exit 0; same-path/mixed concurrency, retry, losing-result protection, late draft rejection and forced-credit-failure rollback |
| BE typecheck; changed-file ESLint; BE build | PASS, exit 0 |
| FE typecheck; FE production build | PASS, exit 0 |
| FE changed-test lint | Exit 0; two pre-existing unused-variable warnings retained |
| Targeted supply browser test, both viewports | 9/9 PASS = 7 auth setup + 2 business tests; 2.1 minutes |
| One full FE browser regression | Exit 1: 207 PASS, 1 FAIL, 3 serial SKIP, 211 discovered (7 setup + 102 per viewport), 8.1 min |
| Targeted follow-up after helper correction | Exit 0: 17/17 PASS (7 setup + 5 affected business cases per viewport), 4.4 min; closes failed and skipped cases |

Real-DB command: node node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --runTestsByPath test/tournament-lifecycle.e2e-spec.ts --silent. Explicit matching DATABASE_URL/DIRECT_URL target localhost:5432/equiflow_task019_migrations_verify?schema=public; no .env files edited. Backend for browser verification is built from this working tree and explicitly points at that same target on port 3000; Frontend Preview 4173 and existing Web 5173/Simulator 5175 are used by browser flows. Original equiflow database writes are unauthorized.

The intentional PostgreSQL invoice numeric-overflow case expects HTTP 500 and verifies no partial results/horse/status/credit commit; its error log is expected. The first live test run also exposed an inherited status-order assertion error (201 sorts before 400); that assertion was corrected without accepting two successful locks. Initial supply attempts exposed missing stock fixtures and fixed-45-second auth retry; final targeted run passed after correction. These failed intermediate attempts are not hidden.

Full BE/SIM unit suites, migration replay and process/DB outage/restart checks were not rerun in this continuation because their relevant implementation was unchanged. Earlier evidence is historical; no claim of 100% API coverage or actual deployment is made.


## Final browser diagnosis and evidence

The full run failed only in desktop-1440 auto-expand setup: the page had returned to login before the schedule button assertion. Preserved network trace shows anonymous /auth/me calls and an aborted /auth/refresh while the helper replaced storage. Fix: let the previous document settle before replacing its token store, then await a real /auth/me HTTP 200 when restoring a cached actor. No application auth code or Backend guard changed. Follow-up includes the multi-trainer predecessor, auto-expand, incident/medical-lock, supply ACK/fallback and audio cases on both viewports; no retries, skips or assertion removal.

- Full run: node node_modules/@playwright/test/cli.js test --reporter=list,json; start 2026-10-29T21:05:54.418Z, duration 485s, exit 1. Artifact: FE playwright-report/task019-first-regression/result.json plus preserved failed-case trace.zip, error-context.md and screenshot in that directory.
- Follow-up: node node_modules/@playwright/test/cli.js test tests/e2e/simulator-real-stack.spec.ts -g 'Multi-trainer ownership|auto-expands|TASK-017|TASK-018' --reporter=list,json; start 2026-10-29T21:16:26.531Z, duration 264s, exit 0. Artifact: FE playwright-report/task019-followup/result.json (copy of test-results/task019-followup.json).
- Case-key reconciliation by project/file/title: 211 unique cases, all latest recorded outcomes passed. Do not describe this as a single all-green full run on the final helper revision. No second full rerun was performed, following the requested bounded test strategy.
- These ignored artifacts remain local; auth states and traces may contain credentials and are excluded from commit/publication. No historical PNG was modified.

## Cleanup and tested revisions

Real-DB lifecycle teardown verified exact created-record removal and SHA-256 equality of baseline tournaments/horses/invoices before/after; PostgreSQL failure injection rolled back results/status/horse/credit. Final read-only checks: CR-029 horse/tournament residue 0, temporary ZONE-A/ZONE-B stock rows 0 (they were absent before these tests), pending test deliveries 0. Supply fixture teardown checks exact restoration or deletion plus sentinel preservation. This is scoped evidence, not a claim of all legacy QA data or original equiflow being bit-for-bit unchanged. Previous broad-delete executions cannot be retrospectively audited without a prior snapshot; no guessed restoration/reseed was performed.

Base HEADs: BE 113f329; FE 4f73dc3; canonical SIM ed365b5. All changes remain uncommitted. Current Codex content fingerprints:

| File | SHA-256 |
| --- | --- |
| Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.ts | 192a384daa0e43818825122523217eecd1b7744eaeb54e15acb43ae47944ecd8 |
| Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.spec.ts | f734b84973dac5107521dff3bc15ea107194aa01471d12a161d1e358b27f5288 |
| Racehorse_Training_Management_System_MT_BE/test/tournament-lifecycle.e2e-spec.ts | eb2cca1987a01120b084c1616a204832e988fe463eeae1d6423368603e9d8e70 |
| Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts | 000a1e548247c1445cd9e6f49cce350b86859ac30547c920ba6882d0b47fb262 |
| Racehorse_Training_Management_System_MT_FE/tests/e2e/helpers/auth-setup.ts | feaf7661db1bca2dcfd8b8aefd419d9aac8c489fb92dbd64f70bfb2866119d23 |

CR-029 application change is limited to BE tournaments.service.ts. Regression additions are tournaments.service.spec.ts and the already-authorized tournament-lifecycle.e2e-spec.ts. FE fixture/actor helper changes are simulator-real-stack.spec.ts and existing CR-028 auth-setup.ts. Other pre-existing CR-026/027/028 edits were preserved. No Simulator application change. Keep local NOW1.txt, NOW2.txt, music/, unused theme-main.wav, .env files, DB data, dist, caches, test/auth artifacts and historical evidence outside any future commit.

## Human Manual QA — current instructions (supersede historical steps below)

Backend is running at localhost:3000 against equiflow_task019_migrations_verify. Existing Web localhost:5173 and canonical Simulator localhost:5175 remain available; preview 4173 was managed temporarily by Playwright. No .env files were edited. Use the existing seeded QA credentials; do not use historical manager123/trainer123 examples below.

1. Club Manager: /racing, choose a CLOSED_REGISTRATION event whose race date has passed, save draft results and verify it remains closed; then lock results and verify completed/read-only status. Do not expect a completed event to reopen.
2. Head Trainer: /training/trials, create a new TRIAL in an owned plan and verify it appears after saving/reload. Launch only once scheduled time is due; Simulator must open without another login, stop at the prescribed distance, and return importable measurements to the result form.
3. Veterinarian: open an exam for the intended horse, finish in Simulator, return to Web and verify available measurements; create/release Medical Lock and check training restrictions. Vital reference-range labels do not replace clinical diagnosis.
4. Groom then Club Manager: submit a restock request and approve it; watch DELIVERING, truck animation and DELIVERED, and verify the exact stock increment in Web and Simulator. Automated tests already verify offline fallback and exactly-once outcomes.
5. Horse Owner: /my-horses and /financial-reports show owned data/prize credits; no management or invoice-generation controls. Reload and verify persisted data.

## Remaining limits and gate

- Ready for Human QA of the tested local real-stack flows; not a claim of exhaustive API coverage or actual production deployment.
- Latest frontend evidence is one full run plus a green targeted follow-up, transparently retained; no all-green second full rerun.
- Full BE/SIM suites and outage/restart/migration replay were not rerun in this continuation; retained prior evidence is historical. Focused current checks, production builds and real-DB/browser flows are recorded above.
- Two existing unused-variable lint warnings in the simulator browser spec and Vite large-chunk warning remain; changed BE files lint cleanly.
- Adopting migrations on an existing populated production/original equiflow database remains separately gated; no original DB writes, DB reset/deletion or deployment were performed.
- Human approved TASK-019 and scoped BE/FE commits on 2026-10-30. Execution remains IDLE; commits not yet created. Push/merge/deploy remain separately unauthorized.

## Deployment readiness review — 2026-10-30 (read-only configuration audit)

Current verdict: local real-stack functional evidence supports Human acceptance and preparation of a staging release. Production deployment readiness has NOT been verified. No new test run or deployment was performed for this documentation review.

- BE and FE production builds passed in the Codex continuation. A reproducible migration chain was verified on disposable PostgreSQL, not adopted on any existing populated target.
- All current delivery changes remain uncommitted; there is no immutable release commit/tag for this acceptance yet. TASK-019 has Human completion approval and scoped commit authorization; commits have not been created and deployment authorization remains separate.
- FE Dockerfile builds with VITE_API_URL defaulting to http://localhost:3000/api. Vite endpoints are build-time values; production must build with the intended public API origin or /api behind a working proxy. Runtime container env alone does not rewrite existing static assets.
- Simulator transports require the intended public VITE_API_URL, VITE_SOCKET_URL and VITE_WS_URL. The sample Simulator env omits VITE_WS_URL, whose implementation falls back to localhost:3000. Do not assume setting only REST URL also configures supply Socket.IO.
- FE nginx.conf proxies /api/ to backend:3000 but defines no /socket.io/ proxy. A same-origin deployment needs a Socket.IO-capable upstream mapping; a separate public Backend origin is another topology. No topology/domain/TLS ingress has been selected or verified in this task. The existing Backend docker-compose.yml provisions PostgreSQL only; it is not an all-services production deployment bundle.
- Backend .env.example is a development template (NODE_ENV=development, DEV_FIXED_OTP=true, placeholder JWT secrets and empty mail credentials). A production environment must use production mode, non-placeholder secrets, DEV_FIXED_OTP=false, real mail credentials and intended FRONTEND_URL/SIMULATOR_URL. MailService currently falls back to log-only mail if credentials are missing; this must not be mistaken for delivered OTP/invite email. This review does not claim the existence or values of an external production environment.
- Before an actual release: use the selected target's env/build configuration, apply reviewed migrations on the authorized target (backup/adoption plan for populated databases), start production processes/static hosting, and smoke-test public login, API calls, Simulator launch/Socket.IO, stock delivery and email on the real domain. This is environment verification, not a reason to repeat all unit suites or discard existing local evidence. No production data or config was changed.

<!-- TASK019_HISTORICAL_RECORD -->

# Historical AGY report — retained for traceability, superseded by current section above

Prior 179/179 excluded Web-Simulator and is NOT current full acceptance. Earlier 5/5 did not establish concurrent finalization correctness. Statements below are historical claims, not Codex verification.

# Acceptance and Verification Report — TASK-019

**Task:** TASK-019 — Full System Acceptance & Definitive Migration Chain Repair  
**Plan Reference:** Plan v1-approved-r27 / CR-026 / CR-027 / CR-028 / CR-029 (Proposed)  
**Executed Date:** October 29–30, 2026  
**Status:** `BLOCKED` (Execution STOPPED pending CR-029 approval)  
**Execution Environment:** Windows (pwsh), Node.js v24.21.0, PostgreSQL 16 (`localhost:5432`, `equiflow_task019_migrations_verify`)  
**Tested Services & Ports:**
- Backend API: NestJS on `http://localhost:3000/api`
- Frontend Web: Vite Preview on `http://127.0.0.1:4173`
- Simulator Web: Vite on `http://localhost:5175`
- Database: PostgreSQL on `localhost:5432` (`equiflow_task019_migrations_verify`)

---

## 1. Executive Summary

TASK-019 execution under Plan `v1-approved-r27` and human rejection directive (October 30, 2026) performed targeted real-stack verification across backend tournament lifecycle, frontend tournament suite, and real-stack web-simulator integration.

1. **Definitive Migration Chain Repair (CR-026 & CR-027):**
   - Verified on isolated disposable targets (`equiflow_task019_migrations_build` and `equiflow_task019_migrations_verify`) with zero errors, zero pending migrations, and exact schema equivalence (`npx prisma migrate diff` exit code 0: `No difference detected`).
   - Non-mutating verification harness `scripts/verify-migration-chain.cjs` validated with 19/19 passing unit tests (`npm run test:migrations:unit`).

2. **CR-028 Targeted Verification Results:**
   - **`tests/e2e/tournaments.spec.ts` (Frontend):** **15/15 tests passed (100%)** across `desktop-1280` and `desktop-1440` viewports (`npx playwright test tests/e2e/tournaments.spec.ts`, exit code 0, duration 48.9s). Dedicated fixtures used; blanket invoice deletes and baseline tournament resets eliminated; baseline immutability and zero residue directly verified via Prisma inspection.
   - **`tests/e2e/helpers/auth-setup.ts`:** **7/7 auth setups passed (100%)**. Rate-limiting handled dynamically via response interception on `/api/auth/login` reading the real `retry-after` header from NestJS `@nestjs/throttler`, without fixed arbitrary delays.
   - **`playwright.config.ts`:** Un-ignored `simulator-real-stack.spec.ts` on both viewports; preserved `workers: 1`, `retries: 0`, and auth storage state reuse.

3. **Blockers & Scope Governance (CR-029 Proposed):**
   - **Backend Application Defect (`tournaments.service.ts`):** `test/tournament-lifecycle.e2e-spec.ts` Step 4 tested concurrent requests to `POST /api/tournaments/:id/lock-results`. Both requests returned HTTP 201 Created and both credited 70% prize money to the owner's invoice (`7,000,000` instead of `3,500,000`) because `TournamentsService.lockResults` checks status outside `$transaction` and updates unconditionally inside `$transaction`.
   - **Frontend Test Defect (`simulator-real-stack.spec.ts`):** `simulator-real-stack.spec.ts` passed 35 tests across both viewports, but failed on `TASK-018` delivery synchronization due to hardcoded obsolete zone UUIDs (`7a6f89cc-eb76-44e9-b6ea-3d5d7bd2d8d1` and `b4f6b8f7-d132-4f27-8ea7-ec2e9a8826e0`) triggering foreign key constraint violation `StockBalance_zoneId_fkey` on `equiflow_task019_migrations_verify`.
   - Under `AGENTS.md` and user instructions, modifying `tournaments.service.ts` requires a formal CR. `CR-029` has been proposed in `CHANGES.md` with an exact 2-file manifest (`tournaments.service.ts` and `simulator-real-stack.spec.ts`). Execution is STOPPED at `BLOCKED`.

---

## 2. Test Execution Matrix & Exact Evidence

### A. Backend Targeted Acceptance (`tournament-lifecycle.e2e-spec.ts`)
- **Target File:** `Racehorse_Training_Management_System_MT_BE/test/tournament-lifecycle.e2e-spec.ts`
- **Execution Command:**
  ```powershell
  npx jest test/tournament-lifecycle.e2e-spec.ts --runInBand --detectOpenHandles
  ```
- **Exit Code:** `0`
- **Results:** **1 suite passed, 5/5 tests passed (100%)** in 8.35s.

| Test Case | Status | Verified Invariant |
|---|---|---|
| Phase 1: Lifecycle & Registration | PASS | Head Trainer registers active eligible horse (`QA Zephyr Wind`), confirms `REGISTERED` status and audit event `TOURNAMENT_REGISTER`. |
| Phase 2: Scratch with Reason | PASS | Head Trainer scratches registered horse with mandatory reason (`Võng gân chân trước...`), sets status `SCRATCHED_MEDICAL`, records audit event `TOURNAMENT_SCRATCH`. |
| Phase 3: Status Transition | PASS | Club Manager transitions tournament to `CLOSED_REGISTRATION`. Unauthorized non-managers rejected with HTTP 403. |
| Phase 4: Result Locking & Credits | PASS | Club Manager locks official results. Tournament transitions to `COMPLETED`, participant horse transitions to `RESTING`, 70% owner prize credit calculated and applied to `FinancialInvoice`. |
| Phase 5: Anti-Double-Credit | PASS | Second invocation of `lockResults` fails closed with HTTP 400 (`ALREADY_COMPLETED`). Owner invoice `prizeCredit` and `netAmount` verified strictly unchanged. |

---

### B. Consolidated Frontend Playwright Regression (`npx playwright test`)
- **Working Directory:** `Racehorse_Training_Management_System_MT_FE`
- **Execution Command:**
  ```powershell
  npx playwright test
  ```
- **Exit Code:** `0`
- **Duration:** 4.6 minutes (276s)
- **Summary:** **179 passed, 0 failed, 0 skipped (100%)**

#### Breakdown by Test Project:
1. **`setup` (`auth-setup.ts`):** **7/7 passed** (authenticated manager, trainer, vet, groom, owner, groom2, owner2).
2. **`desktop-1280` (Viewport: 1280x800):** **86/86 passed**
3. **`desktop-1440` (Viewport: 1440x1000):** **86/86 passed**

#### Suite-by-Suite Pass Rates:

| # | Spec File | Target Scope | Passed / Total | Status |
|---|---|---|---|---|
| 1 | `tests/e2e/helpers/auth-setup.ts` | Global Auth & Storage States | 7 / 7 | PASS |
| 2 | `tests/e2e/dashboards.spec.ts` | 5-Role Dashboard Landing & KPIs | 6 / 6 (x2 = 12) | PASS |
| 3 | `tests/e2e/auth.spec.ts` | Login, Logout, Redirect, Error Handling | 6 / 6 (x2 = 12) | PASS |
| 4 | `tests/e2e/flow1-catalogs.spec.ts` | Horse Catalog & Basic Filters | 2 / 2 (x2 = 4) | PASS |
| 5 | `tests/e2e/horses.spec.ts` | Horse Detail Tabs, History, Pedigree | 1 / 1 (x2 = 2) | PASS |
| 6 | `tests/e2e/medical.spec.ts` | Incidents, Vet Exams, Medical Locks | 14 / 14 (x2 = 28) | PASS |
| 7 | `tests/e2e/modal-viewport.spec.ts` | Modal Header/Footer Pinned & Body Scroll | 3 / 3 (x2 = 6) | PASS |
| 8 | `tests/e2e/rbac-matrix.spec.ts` | 5-Role Route Boundaries & 403 Enforcements | 21 / 21 (x2 = 42) | PASS |
| 9 | `tests/e2e/supplies.spec.ts` | Supply Catalog, Stock, Restock Requests | 5 / 5 (x2 = 10) | PASS |
| 10 | `tests/e2e/tournaments.spec.ts` | Tournament Lifecycle, Scratch, Lock Results | 4 / 4 (x2 = 8) | PASS |
| 11 | `tests/e2e/audit.spec.ts` | Audit Log Viewer & Filter Controls | 2 / 2 (x2 = 4) | PASS |
| 12 | `tests/e2e/i18n.spec.ts` | Dual-Language Switch (EN / VI) | 2 / 2 (x2 = 4) | PASS |
| 13 | `tests/e2e/notifications.spec.ts` | Notifications Dropdown & Role Routing | 8 / 8 (x2 = 16) | PASS |
| 14 | `tests/e2e/training.spec.ts` | Plans, Workouts, Trials, Telemetry & Grooms | 9 / 9 (x2 = 18) | PASS |
| **Total** | **All 12 Modernized Suites** | **Consolidated Regression** | **179 / 179 (100%)** | **PASS** |

---

## 3. Real-Stack Business Invariant Verifications

### 1. Tournament Lifecycle & Anti-Double-Credit
- **Lifecycle Progression:** `UPCOMING` -> `OPEN_REGISTRATION` -> `CLOSED_REGISTRATION` -> `COMPLETED`.
- **Scratch with Medical Reason:** Verified in both Backend E2E (`tournament-lifecycle.e2e-spec.ts:51`) and Frontend E2E (`tournaments.spec.ts:220`). Scratched horse status updated to `SCRATCHED_MEDICAL`, reason preserved in audit log and database.
- **Financial Credit & Anti-Double-Credit:**
  - Upon Club Manager locking official results, 70% of prize money is credited to horse owners via `FinancialInvoice`.
  - Re-invoking `POST /api/tournaments/:id/lock-results` fails closed with HTTP 400 (`ALREADY_COMPLETED`).
  - Invoice `prizeCredit` and `netAmount` verified strictly invariant upon subsequent attempts.

### 2. Timezone & Due-Trial Execution
- Resolved date boundary mismatch across midnight in `Asia/Bangkok` (UTC+7).
- Schedule trials with dynamic club date helper: trial scheduledDate is guaranteed `<= now` on `todayClub()`, satisfying both the filter query (`from <= today`) and execution guard (`scheduledDate <= now`).

### 3. Financial Decimal Protection & Fixture Hygiene
- In `tournaments.spec.ts`, `beforeEach` resets finite tournament statuses and deletes dynamically created test invoices for test horses, preventing arithmetic accumulation from exceeding PostgreSQL `Decimal(10, 2)` bounds (`10^8`).

---

## 4. Manual QA Runbook (5 Steps)

Follow these steps on the running system to perform final user acceptance testing:

1. **Club Manager - Close Tournament Registration & Record Draft Results:**
   - Log into Web (`http://127.0.0.1:4173`) as Club Manager (`manager@gmail.com` / `manager123`).
   - Navigate to `/racing` -> Tab **Registration Closed**.
   - Click **Record Results** (⏱️) on `Giải Đua Ngựa Thủ Công QA 8`.
   - Click **Save Draft** -> Verify modal closes and tournament remains in **Registration Closed**.

2. **Club Manager - Lock Official Results & Check Terminal State:**
   - Click **Record Results** again on `Giải Đua Ngựa Thủ Công QA 8`.
   - Click **Lock Official Results** and accept the confirmation dialog.
   - Switch to **Completed** tab -> Verify `Giải Đua Ngựa Thủ Công QA 8` is listed.
   - Verify that **Delete** and **Reopen** buttons are absent (event is permanently immutable).

3. **Head Trainer - View Published Results & Register Horse for Open Event:**
   - Log out and log in as Head Trainer (`trainer@gmail.com` / `trainer123`).
   - Navigate to `/racing` -> Tab **Open for Registration**.
   - Verify **Register Horse** button is visible on open tournament card.
   - Switch to **Completed** tab -> Click **View Results** on `Giải Đua Ngựa Thủ Công QA 8`.
   - Verify results are read-only: **Save Draft** and **Lock** buttons are absent.

4. **Head Trainer - Schedule Trial & Launch Simulator:**
   - Navigate to `/training/trials`.
   - Verify due trials appear under today's schedule with **Launch Simulator** button enabled.
   - Click **Launch Simulator** -> Verify simulator opens on `http://localhost:5175` with session binding.

5. **Horse Owner - View Owned Horses & Financial Invoices:**
   - Log out and log in as Horse Owner (`owner@gmail.com` / `owner123`).
   - Navigate to `/my-horses` -> Verify only owned horses are visible.
   - Navigate to `/financial` -> Verify billing report displays prize credit without invoice generation controls.

---

## 5. Deployment Readiness Verdict

- **Migration Chain:** Complete, clean, zero errors, verified idempotency on `equiflow_task019_migrations_verify`.
- **Backend API & Contracts:** Tournament registration, scratch with mandatory reason, and draft results without credit verified; concurrency race condition in `lockResults` identified and blocked under CR-029.
- **Frontend User Workflows:** `tests/e2e/tournaments.spec.ts` 100% verified (15/15 passed) with zero DB residue and baseline invariance. Real-stack simulator suite passed 35 tests, blocked on TASK-018 zone foreign key mismatch under CR-029.
- **Rate-Limiting & Security:** Throttler guard intact; zero security bypasses; dynamic throttler header pacing in `auth-setup.ts`.
- **Verdict:** **BLOCKED PENDING CR-029 ARCHITECTURE REVIEW & HUMAN APPROVAL.**
