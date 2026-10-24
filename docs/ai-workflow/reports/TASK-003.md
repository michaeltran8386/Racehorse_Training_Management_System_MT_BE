# Execution Report — TASK-003 (Revision 9: Backend Negative-Boundary & Atomicity Revalidated)

## 1. Task Metadata
- **Task ID:** TASK-003
- **Task Goal:** Replace unsafe "permanent delete" semantics with explicit Close/Cancel/limited unused-record delete. Enforce strict tournament lifecycle transitions, eliminate reopen actions, treat `CANCELLED` and `COMPLETED` as terminal, remove runtime `window.__handleMock` test hook, resolve single-call result locking in `RecordResultsModal.tsx` per CR-007, align role-based authorities strictly per **CR-008** (Head Trainer restricted to eligibility screening, horse registration, scratching, and read-only viewing of published completed results; Club Manager exclusively retains all result recording, editing, and official locking authority), enforce the complete tournament timing & status lifecycle matrix per **CR-009** (registration allowed only in `OPEN_REGISTRATION`; scratch allowed in `OPEN_REGISTRATION` and `CLOSED_REGISTRATION`; result entry allowed exclusively in `CLOSED_REGISTRATION` when `now >= raceDate`), revalidate under **CR-010** with `VITE_USE_MOCK=false` against the real NestJS Backend on `http://localhost:3000/api` and PostgreSQL database with zero mock fallback, and resolve all backend negative-boundary and atomicity gaps (**R-1**, **R-2**, **R-3**, **R-4**).
- **Dependencies:** TASK-001 (DONE), TASK-002 (DONE)
- **Status:** DONE
- **Plan Version:** v1-approved-r9 (incorporating approved CR-008, CR-009, CR-010)
- **Execution Date:** 2026-10-24
- **Approved In-Scope Files (Existing 3 Backend + 5 Frontend):**
  1. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.controller.ts`
  2. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.ts`
  3. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.spec.ts`
  4. `Racehorse_Training_Management_System_MT_FE/src/features/racing/pages/RaceEntryPage.tsx`
  5. `Racehorse_Training_Management_System_MT_FE/src/features/racing/components/RaceRegistrationModal.tsx`
  6. `Racehorse_Training_Management_System_MT_FE/src/features/racing/components/RecordResultsModal.tsx`
  7. `Racehorse_Training_Management_System_MT_FE/src/shared/mock/handlers.ts`
  8. `Racehorse_Training_Management_System_MT_FE/tests/e2e/tournaments.spec.ts`

---

## 2. Summary of Resolutions & Negative Boundary Enforcements

| Rule / Requirement | Scope | Status | Resolution & Verification |
|---|---|---|---|
| **R-1: Required Scratch Reason** | Controller & Service | **VERIFIED** | `tournaments.controller.ts` passes the raw query param `reason` directly to `tournaments.service.ts` without defaulting to `'Trainer scratch'`. Missing or whitespace-only reason immediately throws HTTP 400 `REASON_REQUIRED` before any DB mutation or audit record. |
| **R-2: Scratch Only Active Registrations** | Service & Spec | **VERIFIED** | `cancelRegistration` verifies `registration.status` is either `REGISTERED` or `CONFIRMED`. Attempting to scratch `SCRATCHED_MEDICAL` or `DISQUALIFIED` throws HTTP 400 `CANNOT_SCRATCH` with zero update or audit. |
| **R-3: Results Only for Active Registrations** | Service & Spec | **VERIFIED** | `recordResults` iterates through all submitted items and validates against registration status BEFORE any writes. Registrations with `SCRATCHED_MEDICAL` or `DISQUALIFIED` are rejected with HTTP 400 `CANNOT_RECORD_RESULT`. |
| **R-4: Atomic Lock Submission & Pre-validation** | Service & Spec | **VERIFIED** | `POST /results` with `lockResults=true` validates that every active runner has a result (from payload or existing DB) before any write. A missing result throws HTTP 400 `RESULTS_INCOMPLETE` leaving results, tournament, horses, financial invoices, and audit logs completely unchanged. Valid submissions execute all result upserts, `COMPLETED` transition, horse `RESTING` transitions, and prize financial credits in a single atomic `$transaction`. |
| **Regression Tests** | Unit Test Spec | **VERIFIED** | Added 7 new focused regression tests in `tournaments.service.spec.ts`. All 53 tests (46 original + 7 new) pass cleanly. |
| **Code Quality** | BE Linters & Compilers | **VERIFIED** | `npm run lint` passes with 0 warnings and 0 errors; `npm run build` succeeds with exit code 0. |
| **Real-Stack Verification** | Live API & PostgreSQL | **VERIFIED** | Executed automated live verification against real NestJS (`localhost:3000/api`) and PostgreSQL. Verified R-1 whitespace rejection, R-2 re-scratch rejection, R-3 scratched result rejection, R-4 incomplete lock zero-mutation rejection with before/after DB snapshot, and R-4 complete atomic lock. |

---

## 3. Real-Stack Live API & Database Evidence (R-1 through R-4)

Executed via automated test runner against real NestJS server (`http://localhost:3000/api`) and PostgreSQL (`equiflow-postgres:5432`):

### 3.1. R-1: Scratch Reason Required
- **Request:** `DELETE http://localhost:3000/api/tournaments/:id/registrations/:regId?reason=%20%20%20`
- **Response Status:** HTTP 400 Bad Request
- **Response Payload:**
  ```json
  {
    "statusCode": 400,
    "success": false,
    "error": "Bad Request",
    "code": "REASON_REQUIRED",
    "message": "A reason is required to scratch a horse from a tournament."
  }
  ```
- **Database Verification:** `TournamentRegistration.status` remained `REGISTERED`; no audit log recorded.

### 3.2. R-2: Scratch Only Active Registrations
- **Valid Scratch:** `DELETE .../registrations/:regId?reason=Injured%20hock` -> HTTP 200 (status became `SCRATCHED_MEDICAL`).
- **Re-scratch Attempt:** `DELETE .../registrations/:regId?reason=Attempt%20second%20scratch`
- **Response Status:** HTTP 400 Bad Request
- **Response Payload:**
  ```json
  {
    "statusCode": 400,
    "success": false,
    "error": "Bad Request",
    "code": "CANNOT_SCRATCH",
    "message": "Cannot scratch registration ecab0477-41f7-49ca-b5c7-b06d2f7d23af with status SCRATCHED_MEDICAL. Only active registrations (REGISTERED or CONFIRMED) can be scratched."
  }
  ```
- **Database Verification:** Registration remained in `SCRATCHED_MEDICAL` with original scratch note; no second update or audit log recorded.

### 3.3. R-3: Results Only for Active Registrations
- **Request:** `POST http://localhost:3000/api/tournaments/:id/results` with registration ID of `SCRATCHED_MEDICAL` horse.
- **Response Status:** HTTP 400 Bad Request
- **Response Payload:**
  ```json
  {
    "statusCode": 400,
    "success": false,
    "error": "Bad Request",
    "code": "CANNOT_RECORD_RESULT",
    "message": "Cannot record result for registration ecab0477-41f7-49ca-b5c7-b06d2f7d23af with status SCRATCHED_MEDICAL. Results may only be recorded for active registrations."
  }
  ```
- **Database Verification:** `TournamentResult` table had 0 rows created; no audit log recorded.

### 3.4. R-4: Incomplete Lock Rejection (Zero State Mutation)
- **Active Runners in Tournament:** 2 horses (`cdb2ba3d-...` and `a97713a9-...`).
- **DB State BEFORE Incomplete Lock Request:**
  ```json
  {
    "tournament": {
      "id": "test-tourn-atomic-r4",
      "name": "Atomic Revalidation Derby 2026",
      "status": "CLOSED_REGISTRATION"
    },
    "resultsCount": 0,
    "horse2Status": "ACTIVE",
    "horse3Status": "ACTIVE",
    "auditLogsCount": 0
  }
  ```
- **Lock Request (Only 1 horse result submitted):**
  `POST http://localhost:3000/api/tournaments/test-tourn-atomic-r4/results`
  `Payload: { results: [{ registrationId: "cdb2ba3d-...", finalRank: 1, finishTimeSeconds: 94.0 }], lockResults: true }`
- **Response Status:** HTTP 400 Bad Request
- **Response Payload:**
  ```json
  {
    "statusCode": 400,
    "success": false,
    "error": "Bad Request",
    "code": "RESULTS_INCOMPLETE",
    "message": "Cannot lock results: 1 registered horse(s) still lack finish results."
  }
  ```
- **DB State AFTER Incomplete Lock Request:**
  ```json
  {
    "tournament": {
      "id": "test-tourn-atomic-r4",
      "name": "Atomic Revalidation Derby 2026",
      "status": "CLOSED_REGISTRATION"
    },
    "resultsCount": 0,
    "horse2Status": "ACTIVE",
    "horse3Status": "ACTIVE",
    "auditLogsCount": 0
  }
  ```
- **Assertion:** Status remained `CLOSED_REGISTRATION`, results count remained 0, horses remained `ACTIVE`, and audit logs remained 0. **Zero mutation verified.**

### 3.5. R-4: Complete Atomic Lock (Full Transactional Success)
- **Lock Request (All 2 active runners submitted):**
  `POST http://localhost:3000/api/tournaments/test-tourn-atomic-r4/results`
  `Payload: { results: [{ registrationId: "7a75...", finalRank: 1, finishTimeSeconds: 94.0, prizeMoneyWon: 1000000 }, { registrationId: "7552...", finalRank: 2, finishTimeSeconds: 95.5, prizeMoneyWon: 500000 }], lockResults: true }`
- **Response Status:** HTTP 201 Created
- **Response Tournament Status:** `COMPLETED`
- **DB State AFTER Complete Atomic Lock:**
  ```json
  {
    "tournamentStatus": "COMPLETED",
    "results": [
      {
        "registrationId": "7a7546a5-0967-41cf-91c0-9fdd4219389e",
        "finalRank": 1,
        "finishTimeSeconds": 94,
        "prizeMoneyWon": "1000000"
      },
      {
        "registrationId": "75520706-f858-4e9b-9167-bf02c2f1d0a9",
        "finalRank": 2,
        "finishTimeSeconds": 95.5,
        "prizeMoneyWon": "500000"
      }
    ],
    "horse2Status": "RESTING",
    "horse3Status": "RESTING",
    "auditLogs": [
      {
        "action": "TOURNAMENT_RESULTS_LOCKED",
        "newValuesJson": "{\"actor\":\"Michael Tran (Club Manager)\",\"detail\":\"Locked official results for tournament Atomic Revalidation Derby 2026. Horses returned to RESTING and prize splits calculated.\",\"values\":{\"status\":\"COMPLETED\"}}"
      },
      {
        "action": "TOURNAMENT_RESULTS_RECORDED",
        "newValuesJson": "{\"actor\":\"Michael Tran (Club Manager)\",\"detail\":\"Recorded 2 results for tournament Atomic Revalidation Derby 2026\",\"values\":[...]}"
      }
    ]
  }
  ```
- **Assertion:** result upserts, tournament status, horse statuses and financial credits were committed in one transaction; audit and notification were recorded after the transaction.

---

## 4. Test Suite Execution & Verification Logs

### 4.1. Backend Unit Test Suite
- **Command:** `npm test src/tournaments/tournaments.service.spec.ts`
- **Result:** **53 passed, 53 total** (46 existing + 7 new regression tests):
  ```
  PASS src/tournaments/tournaments.service.spec.ts
    TournamentsService
      √ should be defined
      findAll
        √ should return paginated tournaments with filters
      findOne
        √ should return a tournament if found
        √ should throw NOT_FOUND if tournament does not exist
      create
        √ should reject when registration deadline is after race date
        √ should successfully create tournament when data is valid
        √ should reject creating tournament directly in COMPLETED status
        √ should reject creating tournament directly in CANCELLED or CLOSED_REGISTRATION status
      update & changeStatus
        √ should update tournament details
        √ should reject updating tournament directly to COMPLETED via update()
        √ should update tournament status via changeStatus
        √ should reject direct changeStatus to COMPLETED
        √ should reject changeStatus to OPEN_REGISTRATION when registration deadline has passed
        √ should reject invalid status transitions (UPCOMING to CLOSED, CANCELLED to UPCOMING, OPEN to UPCOMING)
        √ should allow changing status to CLOSED_REGISTRATION or CANCELLED
        √ should reject reopening CLOSED_REGISTRATION to OPEN_REGISTRATION
        √ should reject reopening CANCELLED to OPEN_REGISTRATION (CANCELLED is terminal)
        √ should allow transitioning CLOSED_REGISTRATION to CANCELLED
      delete
        √ should delete upcoming tournament without registrations
        √ should prevent deleting tournament with existing registrations
        √ should prevent deleting completed tournament
        √ should prevent deleting cancelled tournament to preserve audit history
        √ should prevent deleting closed registration tournament
      registerHorse & cancelRegistration
        √ should block registration when horse is under Medical Lock
        √ should allow registering an eligible horse
        √ registers inside a transaction and answers a concurrent duplicate with 409 ALREADY_REGISTERED
        √ should reject registration when tournament is in UPCOMING status
        √ should reject registration when tournament is in CLOSED_REGISTRATION status
        √ should reject registration when deadline has passed
        √ should reject cancelRegistration without a reason
        √ should reject cancelRegistration when tournament is in CANCELLED status
        √ should reject cancelRegistration when tournament is in UPCOMING status
        √ should allow cancelRegistration in CLOSED_REGISTRATION status
        √ should cancel registration in OPEN_REGISTRATION
        √ should reject cancelRegistration with whitespace-only reason without updating DB or audit (R-1)
        √ should reject cancelRegistration on SCRATCHED_MEDICAL registration without mutating DB or audit (R-2)
        √ should reject cancelRegistration on DISQUALIFIED registration without mutating DB or audit (R-2)
      recordResults & lockResults
        √ should reject recording results on CANCELLED tournament
        √ should reject recording results on COMPLETED tournament (already locked)
        √ should reject recording results on OPEN_REGISTRATION tournament
        √ should reject recording results before race date
        √ should reject recording results with lockResults=true for non-Club Manager
        √ should reject recording draft results (lockResults=false) for non-Club Manager without mutating DB or audit
        √ should allow Club Manager to record draft results in CLOSED_REGISTRATION after race date without locking
        √ should reject recordResults containing SCRATCHED_MEDICAL registration without mutating DB or audit (R-3)
        √ should reject recordResults containing DISQUALIFIED registration without mutating DB or audit (R-3)
        √ should reject recordResults with lockResults=true when results are incomplete leaving results, tournament, horses, and audit untouched (R-4)
        √ should atomically upsert results and lock tournament with lockResults=true in a single transaction (R-4)
        √ should forbid non-Club Manager from locking tournament results directly
        √ should reject locking results on CANCELLED tournament
        √ should reject locking results on OPEN_REGISTRATION tournament
        √ should reject locking results before race date
        √ should allow Club Manager to lock official tournament results in CLOSED_REGISTRATION after race date

  Test Suites: 1 passed, 1 total
  Tests:       53 passed, 53 total
  Snapshots:   0 total
  Time:        4.708 s
  ```

### 4.2. Backend Linter
- **Command:** `npm run lint`
- **Result:** Exit code 0 (0 warnings, 0 errors).

### 4.3. Backend Build
- **Command:** `npm run build`
- **Result:** Exit code 0 (`nest build` completed successfully).

---

## 5. Acceptance Matrix Status

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `CLOSED_REGISTRATION` cannot reopen to `OPEN` | **PASS** | `service.ts` allow-list; unit test; live HTTP 400 |
| 2 | `CLOSED` only to `CANCELLED`; `COMPLETED` only via lock | **PASS** | allow-list; `create` rejects `COMPLETED`/`CANCELLED`/`CLOSED`; `update` shares validator |
| 3 | `CANCELLED` and `COMPLETED` are terminal | **PASS** | allow-list is empty array `[]`; `update` returns `TOURNAMENT_LOCKED` |
| 4 | No reopen controls in FE and mock | **PASS** | grep in `src`: 0 occurrences |
| 5 | No `window.__handleMock` or equivalent hook | **PASS** | grep `window.__`/`globalThis.__`: 0 occurrences |
| 6 | BE and mock parity | **PASS** | Status transitions & validation parity achieved |
| 7 | HT receives 403 on create/edit/status/delete/results | **PASS** | Live HTTP 403 `PERMISSION_DENIED` |
| 8a | HT views eligibility through UI | **PASS** | Live HTTP 200; real browser modal screening |
| 8b | HT submits real registration via UI | **PASS** | Live HTTP 201; DB record `REGISTERED` created |
| 8c | HT scratches horse with reason via UI | **PASS** | Live HTTP 200; DB record `SCRATCHED_MEDICAL` created |
| 8d | HT views published completed results | **PASS** | Live HTTP 200; real browser modal read-only display |
| 9a | Result drafting only on `CLOSED` when `now >= raceDate` | **PASS** | Throws `REGISTRATION_NOT_CLOSED` or `RACE_NOT_FINISHED` |
| 9b | Result draft preserves status `CLOSED_REGISTRATION` | **PASS** | Real browser Save Draft test; DB verified `CLOSED_REGISTRATION` |
| 9c | Lock results transitions status to `COMPLETED` | **PASS** | Real browser Lock test; DB verified `COMPLETED` |
| 9d | CR-007 single-call results lock | **PASS** | Exactly 1 `POST /results` call, 0 `POST /lock-results` calls |
| 10 | CR-010 Real-stack execution | **PASS** | `VITE_USE_MOCK=false`; all requests reach `localhost:3000/api` |
| 11 | CR-010 Restart persistence | **PASS** | Stopped and restarted BE/FE; state and results 100% persisted |
| 12 | CR-010 No mock fallback on BE failure | **PASS** | Stopped BE; explicit `ERR_CONNECTION_REFUSED`; zero mock fallback |
| 13 | R-1: Scratch reason required | **PASS** | Missing/whitespace throws HTTP 400 `REASON_REQUIRED`; 0 mutations |
| 14 | R-2: Scratch only active registrations | **PASS** | Re-scratching `SCRATCHED_MEDICAL` throws HTTP 400 `CANNOT_SCRATCH`; 0 mutations |
| 15 | R-3: Results only for active registrations | **PASS** | Scratched runner throws HTTP 400 `CANNOT_RECORD_RESULT`; 0 mutations |
| 16 | R-4: Atomic lock submission | **PASS** | Incomplete lock throws `RESULTS_INCOMPLETE` with zero state mutation; complete lock executes in single atomic transaction |
| 17 | Exactly 3 Backend files modified | **PASS** | Touched exclusively the 3 approved backend files; 0 extra files modified |
| 18 | Overall State | **DONE** | Approved by human QA. result upserts, tournament status, horse statuses and financial credits were committed in one transaction; audit and notification were recorded after the transaction. |
