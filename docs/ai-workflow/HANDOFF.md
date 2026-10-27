# Current Handoff

## Gate state

- **Plan:** v1-approved-r18 — approved Plan v1 with CR-005 through CR-019 incorporated.
- **Last completed task:** TASK-013 — DONE and human-approved on 2026-10-27 (`APPROVE TASK-013`, superseding typo `APPROVE TASK-013v`).
- **Active task:** NONE.
- **Active task status:** IDLE.
- **Next eligible task:** TASK-014 (awaiting explicit human command `START TASK-014`).
- **Pending design change:** NONE.
- **Operational blocker:** NONE.
- **Do now:** Await explicit human command `START TASK-014`. Do not commit, push, merge, edit `_v3`, or start TASK-014.

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

Plan v1-approved-r18 is approved and incorporated. TASK-001 through TASK-013 and TASK-020 are DONE and human-approved. Existing TASK-013 work remains uncommitted in working trees across the 29 authorized files. Execution is IDLE. TASK-014 remains unauthorized until explicit human command `START TASK-014`.
