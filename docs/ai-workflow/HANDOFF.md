# Current handoff — TASK-019 DONE / IDLE / v1-approved-r28

2026-10-30: Human command `approve và authorize task-019` approves TASK-019 under Plan v1-approved-r28 and authorizes scoped commit preparation/execution in separate Backend and Frontend commits. Exact wording preserved; no claim that Human personally executed manual QA. Acceptance evidence remains one full FE run (207 pass / 1 fail / 3 skips) followed by green targeted 17/17, not a fresh all-green full run. No push, merge, deploy, original database writes, new feature or next task is authorized.

## Current gate

- active_task: NONE
- active_task_status: IDLE
- next_task: NONE
- pending_change: NONE
- last_approved_task: TASK-019
- All 20 planned tasks are DONE.
- Commit: authorized only for manifest below, not executed.
- Deployment: NOT_AUTHORIZED; production target/config smoke verification remains separate.

## Authorized commit manifest

Create two separate commits, one per repository. Review exact staged paths and diff; do not use git add . or git add -A. Existing technical results remain unchanged. If unexpected files appear, leave them unstaged and report. Do not change application behavior, rerun broad test suites, push, merge, rebase, pull, deploy or mutate original equiflow. Report commit hashes, subjects, manifests and Git status of all three repositories, then STOP. Codex does not execute a commit merely by recording this handoff.

### Backend — 22 paths

- `package.json`
- `prisma/baselines/pre-simulator.prisma`
- `prisma/baselines/README.md`
- `prisma/migrations/20261020000000_initial_baseline/migration.sql`
- `prisma/migrations/20261030000000_reconcile_acceptance_schema/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `scripts/verify-migration-chain.cjs`
- `scripts/verify-migration-chain.spec.cjs`
- `src/tournaments/tournaments.service.ts`
- `src/tournaments/tournaments.service.spec.ts`
- `test/medical.e2e-spec.ts`
- `test/tournament-lifecycle.e2e-spec.ts`
- `docs/ai-workflow/README.md`
- `docs/ai-workflow/STATE.md`
- `docs/ai-workflow/PLAN.md`
- `docs/ai-workflow/TASKS.md`
- `docs/ai-workflow/HANDOFF.md`
- `docs/ai-workflow/DECISIONS.md`
- `docs/ai-workflow/CHANGES.md`
- `docs/ai-workflow/APPROVALS.md`
- `docs/ai-workflow/PROGRESS.md`
- `docs/ai-workflow/reports/TASK-019.md`

### Frontend — 15 paths

- `playwright.config.ts`
- `tests/e2e/helpers/auth-setup.ts`
- `tests/e2e/audit.spec.ts`
- `tests/e2e/auth.spec.ts`
- `tests/e2e/dashboards.spec.ts`
- `tests/e2e/flow1-catalogs.spec.ts`
- `tests/e2e/horses.spec.ts`
- `tests/e2e/i18n.spec.ts`
- `tests/e2e/medical.spec.ts`
- `tests/e2e/modal-viewport.spec.ts`
- `tests/e2e/notifications.spec.ts`
- `tests/e2e/rbac-matrix.spec.ts`
- `tests/e2e/simulator-real-stack.spec.ts`
- `tests/e2e/tournaments.spec.ts`
- `tests/e2e/training.spec.ts`

### Exclusions

No Simulator commit for unrelated local files. Preserve unstaged/untracked NOW1.txt, NOW2.txt, music/, public/audio/theme-main.wav. Exclude .env, credentials/auth states, DB data, dist, cache, test-results, playwright-report, screenshots/traces and historical evidence PNGs. Root STATE mirror and local launchers are not Backend/Frontend Git deliverables. Do not modify/delete excluded files.

The following earlier handoff is historical; current gate above takes precedence.

# Current Handoff

## Current TASK-019 Gate — BLOCKED (Plan v1-approved-r27 pending CR-029)

TASK-019 is strictly BLOCKED under Plan v1-approved-r27. Targeted verification under CR-028 identified:
1. **Backend Application Defect (`tournaments.service.ts`):** Race condition during concurrent result locking allows multiple requests to pass the status check and double-credit owner invoices.
2. **Frontend Test Defect (`simulator-real-stack.spec.ts`):** Hardcoded obsolete zone UUIDs in TASK-018 trigger foreign key violations (`StockBalance_zoneId_fkey`) against `equiflow_task019_migrations_verify`.

CR-029 has been formally proposed in `CHANGES.md` with an exact 2-file manifest. Execution is STOPPED awaiting ChatGPT Planner review and Human approval.

## Gate state

- **Plan:** v1-approved-r27.
- **Last completed task:** TASK-018 — DONE.
- **Active task:** TASK-019.
- **Active task status:** BLOCKED.
- **Next eligible task:** TASK-019 (blocked on CR-029 approval).
- **Pending design change:** CR-029.
- **Approval blocker:** CR-029 proposed in `CHANGES.md`.
- **Do now:** STOP and await ChatGPT Planner incorporation and explicit Human approval (`APPROVE CR-029` -> fresh `START TASK-019`). Do not self-approve, modify out-of-scope files, commit, push, merge, or deploy.
- **Evidence:** `reports/TASK-019.md` records comprehensive test results, commands, exit codes, and blocker details.

## TASK-017 boundary

- Scope budget: maximum 5 files per repository (BE: 1 file, FE: 4 files, SIM: 1 file).
- Incident reporting never auto-creates MedicalLock or MedicalRecord (ADR-007).
- Incident clinical review is strictly restricted to licensed Veterinarians (CR-001); non-Vet reviews fail closed with HTTP 403 Forbidden.
- Incident review modal in Main Web provides direct shortcuts to Place Training Lock and Create Medical Record with automatic horse preselection.
- Medical lock placement/lift by Veterinarian emits `sys:medical_lock_sync` via Socket.IO. Connected Simulator session immediately enforces the lock by disabling heavy/moderate workouts and throttling running pace to safe light pace. Lifting the lock clears the block in real-time.
- Playwright integration tests enforce fail-safe cleanup in `finally` with zero DB residue.

## Approved CR-023 TASK-016 boundary

- Scope expands by 4 additional files to exactly 11 application/test files:
  1. BE `src/training/training-plans.service.ts`
  2. BE `src/training/workouts.service.ts`
  3. BE `src/training/training-services.spec.ts`
  4. FE `src/features/training/pages/TrialRunsPage.tsx`
  - Together with the 7 prior files (BE `simulator.service.ts`, `simulator.gateway.ts`, `simulator.service.spec.ts`, `simulator.gateway.spec.ts`; SIM `TrialTab.tsx`; FE `LiveMonitorPage.tsx`, `simulator-real-stack.spec.ts`).
- Head Trainer horse master-data visibility remains unchanged.
- Head Trainer training plans, workouts, and trial runs are strictly scoped to `trainingPlan.trainerUserId === current userId`.
- Club Manager and Veterinarian read visibility remains unchanged.
- Creating a workout or repeated workout against another trainer's plan must fail closed (403 Forbidden).
- Direct mutation/start requests for another trainer's workout must fail closed.
- Trial Runs must not render an actionable simulation row belonging to another trainer.
- After successful creation, the created trial must be visible immediately. If its date is outside the current filter, update/expand the filter to include that date before reload.
- Two-trainer real-stack browser test in `simulator-real-stack.spec.ts` verifies data isolation and immediate trial visibility.

## Approved CR-022 TASK-016 boundary

- Scope expands to exactly 7 application/test files by authorizing `src/simulator/simulator.service.spec.ts` and `src/simulator/simulator.gateway.spec.ts`.
- `abortSession` performs a conditional atomic transition in database transaction only from `PENDING` or `RUNNING`. Delayed disconnect/timeout must never overwrite `COMPLETED` or existing `ABORTED_INJURY`. Single persisted terminal outcome and broadcast.
- 5-minute rule is an absolute running-session watchdog beginning at the first accepted telemetry tick.
- Normal finish, accepted abort, client reconnect within 15s, and module teardown clear applicable timers. Reconnect within 15s preserves session. 15s expiry aborts once.
- Fake-clock and concurrency tests in the 2 Backend spec files cover all 7 scenarios specified in R-4.

## Approved CR-021 TASK-015 boundary

- Simulator functional areas are not Main-Web roles. Do not add Club Manager/Groom inspection-session endpoints, role-filtered catalogue views or Main-Web launch buttons.
- Direct canonical Simulator access has no secondary login/session gate for catalogue browsing and loads the complete real horse/stall dataset from Backend/PostgreSQL.
- Direct mode is non-authoritative: it cannot mutate horse/stall master data or persist official workout/exam/incident/lock/inventory outcomes without a matching Backend-issued workflow session.
- TASK-015 proves real catalogue identity/mapping, refresh/restart persistence and visible no-fallback failure within the existing five-file budget.
- TASK-016 owns trial write-back; TASK-017 owns incident/Vet/Medical Lock; TASK-018 owns supplies.

## Approved CR-020 corrective TASK-014 boundary

- Root `setup-db.bat` exclusively performs the intentional local database reset/seed and must fail closed on Docker, PostgreSQL, dependency, Prisma or seed failure.
- Root `start.bat` does not reset data. It starts the real stack in one Windows Terminal with exactly four tabs: Backend, Frontend, canonical `Racehorse_Simulator_Web`, and PostgreSQL/Docker visibility. It reports success only after bounded real health checks pass.
- Root `stop.bat` is explicitly authorized to force-stop EquiFlow listeners on 3000/5173/5175 and `equiflow-postgres`, then must verify shutdown rather than print unconditional success.
- Exact application scope is the three root scripts. `_v3`, application source, schema/migrations, dependencies and TASK-015 are out of scope.
- Required manual order is `stop.bat -> setup-db.bat -> start.bat -> verify four tabs and three health URLs -> stop.bat -> verify shutdown`.
- Existing uncommitted TASK-014 files are preserved. The previous `AWAITING_USER_QA` report is superseded and must be reconciled by AGY after the new start.
- The workspace root is not Git-tracked; therefore the report must disclose that root scripts cannot be delivered to teammates by pulling the current three repositories.

## Completed CR-019 corrective Slice H

- The different-horse row in the supplied screenshot is scheduled one day in the future. Both FE and Backend intentionally prevent starting it before its scheduled time; the missing piece is a visible reason, not removal of server authority.
- PostgreSQL and the live API contain the completed simulation results for both QA workouts. Fresh Chromium result pages populate objective metrics correctly. The remaining gap is refresh/source visibility when returning to an already-open form and explicit treatment of unavailable/subjective fields.
- Slice H added only FE `SessionResultPage.tsx` to scope and reused the already-authorized Trial Runs page and real-stack E2E. Recovery HR, score and trainer comment are not invented. The full real-stack browser file passed 16/16 across both configured desktop viewports.
- **Known accepted limitation:** after the Head Trainer edits imported result fields in `SessionResultPage.tsx`, the Simulator reload button (`Tải chỉ số từ Simulator` / `Tải lại`) becomes disabled until the page is reloaded or edits are discarded, protecting in-progress trainer edits against accidental overwrite.

## Approved CR-018 boundary

- Human QA rejected TASK-013 because the 60× run completed too quickly for the chart to communicate model variation and because the Trial Runs scheduling action did not reliably create another TRIAL row. The medical flow is provisionally accepted only and must be regression-tested unchanged.
- Root cause 1: `TrialTab.tsx` advances physics with `dtReal × speed` correctly, but appends chart samples from the 1 Hz real-clock transport ticker. At 60×, a roughly 135-second simulated run produces only a few chart points. Keep Socket.IO telemetry at 1 Hz real time, but sample/render the chart on simulation time so playback speed changes viewing duration, not the modeled result or curve meaning.
- Root cause 2: `TrialRunsPage.tsx` opens generic `WorkoutDialog`, whose type defaults to `CANTER`. Saving from “Lên lịch chạy thử” can therefore create a non-TRIAL workout that never appears in the Trial Runs list. The entry point must explicitly preselect `TRIAL` while retaining existing Backend validation.
- Additional authorized files are FE `src/features/training/pages/TrialRunsPage.tsx` and `src/features/training/components/WorkoutDialogs.tsx`; previously authorized SIM `src/ui/TrialTab.tsx` and FE `tests/e2e/simulator-real-stack.spec.ts` may be updated. No Backend/schema/database reset, new dependency or later-task work is authorized.
- Workflow exception: after the separate direct `START TASK-013 CODEX`, Codex may act as executor for this TASK-013 continuation only, run tests, update the task report/execution status and stop at `AWAITING_USER_QA`. AGY remains the default executor for all other tasks.

## Approved CR-017 corrective TASK-013 boundary

- Human QA confirmed three failures: `startWorkout` returned a terminal session/launch URL that context rejected; EXAM packets failed when master weight was unavailable; and medical-record lists displayed horse UUID instead of name/code. The URL stored in `BA-2610-028` was manual test input, not an application mapping defect.
- Same-workout terminal history remains terminal and must return 409 `SIMULATOR_SESSION_FINISHED`, never a launch URL or silent replacement. Fresh QA runs use a freshly prepared deterministic workout/session.
- Missing weight remains omitted/null and explicitly unavailable; available EXAM measurements still ACK/persist/load exactly once. No default or inferred weight is allowed.
- Medical-record lists display the real horse name/code. UUID is not the primary visible label.
- Five additional files are authorized: BE `src/simulator/dto/exam-packet.dto.ts`, `src/medical/medical-records.service.ts`; FE `src/features/health/api.ts`, `src/features/health/pages/RecordListPage.tsx`; SIM `src/sim/packets.ts`. Total TASK-013 scope is exactly 26 application/test files.
- QA uses deterministic `QA T013 Trial Horse`, `QA-T013-HORSE-001`, `QA T013 Trial Plan`, `QA-T013-TRIAL-001`, `QA T013 Exam Horse`, `QA-T013-EXAM-001` and marker `TASK-013-MANUAL-QA`. Preparation must be idempotent and touch no non-QA data. Human handoff requires a `HUMAN QA — READY` block so testing needs only reload, login, search and action.
- No new database/schema/migration/dependency, `.bat`, `_v3`, TASK-014 or later-task implementation is authorized.

## Approved CR-016 corrective TASK-013 boundary

- Human manual QA rejected the prior acceptance state: workout animation continued after the prescribed distance; Main-Web-issued workout configuration and obstacle controls remained operator-editable; the Vet flow required a decorative intro plus a manual result-load round trip; and vital cards used `Normal` wording that could be mistaken for the horse's overall injury state. Independent review also found the duplicate EXAM emit, which the current uncommitted R-10 correction has already reduced to one wire path and must remain covered.
- Slice E must stop and visibly finish the prescribed workout exactly once, keep Main-Web-issued surface/distance/intensity immutable, and hide unprescribed obstacle authoring. Persisted trial-result formatting/live monitoring remains TASK-016; no obstacle schema/API expansion is allowed here.
- EXAM sessions bypass the cloud intro, open the Vet flow directly, emit/persist/broadcast once, offer a return/close action after ACK, and cause Main Web to auto-load the latest result on focus while preserving manual load as fallback.
- Vital badges describe only numeric reference ranges; injury status and Medical Lock remain separate concepts. This wording correction does not automatically diagnose, create a record, apply a proposed horse status or change a Medical Lock.
- Exact new files are SIM `src/main.tsx` and FE `src/features/health/components/VitalsDisplay.tsx`; the approved TASK-013 total is 21 application/test files. A twenty-second file requires another CR.
- Execution is IDLE. Approval of CR-016 does not start/approve/commit TASK-013 or authorize TASK-014.

## Approved CR-015 corrective TASK-013 boundary

- Human browser QA rejected the prior acceptance state: Head Trainer had no eligible trial launch row; PostgreSQL weight 490 appeared as 535 in Simulator while Main Web initialized 480; valid Vet EXAM sessions had no UI action emitting `sim:exam_finished`, so latest-result loading returned 404.
- TASK-013 now has four sequential slices and exactly 19 application/test files. Existing Slices A/B remain intact. Slice C adds real weight/active-stall session data, removes hash/default master-data presentation, completes EXAM finish/ACK/persistence/latest-result loading, and clears the 480 kg default. Slice D adds one real-stack browser spec and a deterministic eligible QA trial.
- Additional authorized files are BE `src/simulator/simulator.types.ts`, `prisma/seed-manual-qa.ts`; SIM `src/api/simulatorApi.ts`, `src/api/simulatorApi.test.ts`, `src/api/horseMapper.ts`, `src/api/horseMapper.test.ts`; FE `src/features/health/pages/RecordFormPage.tsx`, `tests/e2e/simulator-real-stack.spec.ts`. Existing authorized service/spec and Simulator UI files may be corrected. A twentieth application/test file requires a new CR.
- Browser acceptance must use live FE 5173, SIM 5175, NestJS 3000 and PostgreSQL 5432 with no request interception/mock. It must cover HT launch, exact real horse fields, Vet EXAM finish and reload persistence, sanitized Network/Socket.IO/console evidence, screenshots and fail-closed cases. API-only evidence is insufficient.
- Reuse already-running Docker/npm services when healthy. Before `AWAITING_USER_QA`, leave exact fixture identity and manual steps ready so the human only reloads open pages. `.bat`, `_v3`, schema/migration and TASK-014 remain excluded.

## Approved CR-014 canonical v3 / no-login boundary

- `Racehorse_Simulator_Web/` is the only editable/testable Git source for the v3 Simulator product; `_v3` remains untouched reference material.
- TASK-013 is one human-gated task with two sequential slices: session-bound Backend/transport validation, then canonical v3 UI bootstrap. There is one combined QA gate after both slices.
- Simulator has no secondary login and no `/auth/login` runtime request. Main Web issues `sessionId`; REST context and Socket.IO validate the same eligible session and exact actor. Missing/invalid/terminal/stale-PENDING sessions fail closed; no default Head Trainer fallback is allowed.
- Runtime mock/sample fallback is forbidden. Direct port 5175 without a session shows a safe instruction to open from Main Web rather than a login form.
- Manual Docker/npm startup is the current operating mode. `start.bat`/`stop.bat` remain exclusively in TASK-014, which is TODO and unauthorized.

## Approved CR-013 dataset boundary

- TASK-020 is an additive local manual-QA dataset checkpoint after TASK-011 and before TASK-012; TASK-012 now depends on TASK-020.
- Authorized application/tooling scope is exactly BE `prisma/seed-manual-qa.ts` and `package.json`; no schema, migration, existing `prisma/seed.ts`, Frontend or Simulator change.
- The seed must require `--confirm-local-qa`, reject production, use deterministic QA identities and upsert only QA-owned records. Delete/truncate and non-QA mutation are forbidden.
- Acceptance requires minimum domain counts, two-run idempotency, invariant non-QA snapshot, five-role real API checks and persistence after Backend restart.

## Approved CR-012 execution boundary

- TASK-010 remains one task with two sequential M-size slices; there is no TASK-010B and no intermediate approval after Slice A.
- Slice A is the five existing dirty application/test files: BE `src/medical/medical-locks.service.ts`, `src/medical/medical-services.spec.ts`; FE `src/shared/lib/api.ts`, `.env.example`, `tests/e2e/notifications.spec.ts`.
- Slice B is exactly five FE files: `src/features/dashboard/pages/AuditLogPage.tsx`, `Dockerfile`, `src/vite-env.d.ts`, `.github/workflows/ci.yml`, `AGENTS.md`.
- Build/CI must be real-only with no `VITE_USE_MOCK`. Standalone FE CI may transparently defer integration Playwright when it has no Backend/PostgreSQL, but may not substitute mock-backed browser tests.
- Combined acceptance still requires local real-stack Playwright, browser Network calls to `localhost:3000/api`, PostgreSQL persistence after restart, explicit UI failure with Backend stopped, and exact-ID transactional cleanup restoring the captured original horse state.

## Approved CR-010 acceptance gate

- Mock/fake is permitted only in isolated unit tests; mock-backed Playwright is regression-only and cannot approve TASK-003 or later integration work.
- Runtime, manual QA, integration/E2E and final acceptance must use the real NestJS API and PostgreSQL data.
- Browser Network, DB before/after and restart evidence must prove real requests and persistence.
- Backend/DB failure must be visible; Web/SIM may not fallback to mock/sample data.
- TASK-010 closes Main Web runtime mock; TASK-013 closes Simulator runtime mock; TASK-014 starts the real canonical stack; TASK-015–019 use real-stack acceptance.

## Approved CR-009 boundary

- Register only while OPEN; scratch while OPEN or CLOSED before terminal state.
- Record/lock results only while CLOSED and at/after raceDate; only lock moves CLOSED to COMPLETED.
- Add `RaceRegistrationModal.tsx` as the eighth exact file to expose existing scratch API; no ninth file is authorized.
- E2E must actually register then scratch, assert CLOSED remains after Save Draft, and preserve single-call lock behavior without runtime test hooks.

## Approved CR-008 boundary

- Head Trainer: eligibility, register, scratch; read-only access to published results.
- Club Manager only: record/edit draft results, lock official results and all tournament lifecycle management.
- CR-008 added BE `src/tournaments/tournaments.controller.ts` as the seventh file; CR-009 subsequently approves the eighth file listed above.
- Replace HT draft-success evidence with 403/no-side-effect Backend coverage and UI absence; preserve HT register/scratch success coverage.

## Approved TASK-003 correction scope

- Remove `CLOSED_REGISTRATION -> OPEN_REGISTRATION`; a closed tournament may only be cancelled or completed through result locking.
- Keep `CANCELLED` and `COMPLETED` terminal; remove both reopen buttons and handlers.
- Remove runtime `window.__handleMock` exposure and replace the test with user-visible/request-path coverage or live Backend manual API evidence.
- Retain the verified R-1/R-2/R-3/R-4 protections.
- CR-007 expands the exact scope to six files by adding FE `src/features/racing/components/RecordResultsModal.tsx`. In that modal, retain the single transactional `recordRaceResults(tournament.id, resultsPayload, lock)` call; remove the subsequent `lockRaceResults` call and its unused import. Do not change the Backend API contract.

Current plan/gate: v1-approved-r28; TASK-019 AWAITING_USER_QA. Earlier task instructions retained in this historical section do not grant execution authority.
