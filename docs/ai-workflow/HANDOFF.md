# Current Handoff to AGY

## Gate state

- **Plan:** v1-approved-r11 — approved Plan v1 with CR-005 through CR-012 incorporated.
- **Last completed task:** TASK-010 — DONE and human-approved on 2026-10-26.
- **Active task:** NONE.
- **Active task status:** IDLE.
- **Next eligible task:** TASK-011.
- **Pending design change:** NONE.
- **Operational blocker:** NONE.
- **Do now:** Await explicit human start (`START TASK-011`). TASK-010 has been approved and marked DONE. Execution is IDLE. Do not commit, push, or start TASK-011 without authorization.

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

CR-012 is approved and incorporated into v1-approved-r11. TASK-001 through TASK-010 are DONE and human-approved. Execution is IDLE awaiting explicit authorization or start for TASK-011; TASK-011 remains unauthorized.
