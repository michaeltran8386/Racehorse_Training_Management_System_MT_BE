# Task Breakdown — Plan v1-approved-r22

> Approved specification with CR-005 through CR-023 incorporated. AGY remains the default executor. One task per run.

| ID | Goal | Depends on | Status |
| --- | --- | --- | --- |
| TASK-001 | Align FE/BE permission contract | None | DONE |
| TASK-002 | Enforce Club Manager horse authority | 001 | DONE |
| TASK-003 | Finalize tournament lifecycle and controls | 001 | DONE |
| TASK-004 | Enforce Head Trainer boundaries | 002, 003 | DONE |
| TASK-005 | Expose Vet Medical and constrain status changes | 001 | DONE |
| TASK-006 | Enforce Groom supply view/request boundary | 001 | DONE |
| TASK-007 | Enforce Horse Owner scope and profile boundary | 001 | DONE |
| TASK-008 | Scope operational notifications by horse/actor | 002, 005–007 | DONE |
| TASK-009 | Implement incident audience and 3-hour escalation | 008 | DONE |
| TASK-010 | Align Medical Lock notifications and ownership | 008, 009 | DONE |
| TASK-011 | Transplant REST/session packet contract into canonical SIM | 010 | DONE |
| TASK-020 | Expand controlled Web manual-QA dataset | 011 | DONE |
| TASK-012 | Reconcile SIM realtime engine and transport | 020 | DONE |
| TASK-013 | Bind canonical v3 SIM to Main-Web session with real browser/data acceptance | 012 | DONE |
| TASK-014 | Three-script local setup/start/stop launcher using canonical SIM | 013 | DONE |
| TASK-015 | Complete real horse/stall catalogue→SIM data flow | 002, 006, 007, 014 | DONE |
| TASK-016 | Complete trial session realtime flow | 004, 015 | DONE |
| TASK-017 | Complete incident→Vet→Lock round trip | 005, 009, 016 | DONE |
| TASK-018 | Complete supply request/delivery simulation | 006, 015 | AWAITING_USER_QA |
| TASK-019 | Full system acceptance and evidence | 010, 014–018, 020 | TODO |

## TASK-001 — FE/BE permission contract alignment

- **Objective:** Make role defaults and permission ownership identical across FE/BE before actor work.
- **Dependencies:** None.
- **Included:** Head Trainer horse-edit default, Vet alert ownership, CM account management and self-profile boundary.
- **Excluded:** actor-specific page completion and Simulator work.
- **Files likely touched:** BE `src/users/permissions.ts`, `src/users/permissions.spec.ts`; FE `src/shared/lib/permissions.ts`, `tests/e2e/rbac-matrix.spec.ts`.
- **Acceptance:** Head Trainer default has no horse edit/delete; `ackAlerts` matches Vet-only authority; `manageAccounts` remains CM-only; self-profile exposes profile/notification/request, never direct permission edit.
- **Automated:** BE permission spec/typecheck/lint; FE RBAC spec/typecheck/lint.
- **Manual QA:** inspect navigation and mutation controls for all five seeded roles.
- **Scope:** M (4 files).

## TASK-002 — Club Manager horse authority

- **Status:** DONE
- **Objective:** Make CM the only actor able to create/edit/delete/restore/transfer horse master records; restrict status transitions by domain.
- **Dependencies:** TASK-001.
- **Included corrective change:** add Club-Manager-only `ownerRoles` for `editHorses` in FE/BE and prove stored/submitted `true` normalizes to `false` for every non-CM role.
- **Boundary clarification:** HT must receive 403 and see no controls for master-record create/edit/transfer/delete/restore. Do not remove operational status transitions explicitly permitted by `src/horses/horse-rules.ts`. Vet remains limited to approved medical transitions.
- **Expected source/test files:** BE `src/users/permissions.ts`, `src/users/permissions.spec.ts`; FE `src/shared/lib/permissions.ts`, `tests/e2e/rbac-matrix.spec.ts`.
- **Verification-only unless a failing test proves a gap:** BE horse controller/service/lifecycle/rules and their existing tests; FE horse list/detail/status UI, mock handlers and `tests/e2e/horses.spec.ts`. Do not edit these silently; a required source change outside the four expected files must be recorded as a blocker and split/approved before continuing.
- **Acceptance:** non-CM cannot retain or receive `editHorses`; CM may retain it; HT master mutations return 403 and corresponding controls stay hidden; CM mutations remain audited; permitted HT operational and Vet medical status transitions are not regressed; delete/restore history remains intact.
- **Automated:** BE permission spec plus focused horse authorization/lifecycle tests, typecheck and lint; FE RBAC and horse E2E, typecheck and lint. Re-run TASK-001 RBAC coverage.
- **Manual QA:** try stored/custom `editHorses: true` as HT; repeat master create/edit/transfer/delete/restore as CM and HT; verify permitted HT operational and Vet medical status transitions.
- **Scope:** M (4 expected changed files; other paths are verification-only until a separately approved scope change).

## TASK-003 — Tournament lifecycle and controls

- **Status:** DONE
- **Objective:** Replace unsafe “permanent delete” semantics with explicit Close/Cancel/limited unused-record delete.
- **Dependencies:** TASK-001.
- **Approved files:** BE `src/tournaments/tournaments.controller.ts`, `src/tournaments/tournaments.service.ts`, `src/tournaments/tournaments.service.spec.ts`; FE `src/features/racing/pages/RaceEntryPage.tsx`, `src/features/racing/components/RaceRegistrationModal.tsx`, `src/features/racing/components/RecordResultsModal.tsx`, `src/shared/mock/handlers.ts`, `tests/e2e/tournaments.spec.ts`.
- **Acceptance:** only CM creates/edits/deletes/cancels/changes event status and records/edits/locks results. HT may screen eligibility, register only while OPEN, scratch/withdraw with a reason while OPEN or CLOSED, and view published completed results; HT cannot submit `/results`. No registration occurs in UPCOMING/CLOSED/terminal states. CM result draft and lock require `CLOSED_REGISTRATION` and `now >= raceDate`; only lock moves CLOSED to COMPLETED. Delete rejects registration/result/completed history; CLOSED cannot reopen; CANCELLED and COMPLETED are terminal; no runtime test hook. The CM result modal issues exactly one `/results` request per submit: Save Draft keeps status CLOSED, while Lock Official Results saves, completes, closes the modal and reports no false error; it must not issue a second `/lock-results` request.
- **Automated:** focused tournament unit tests cover every state/action edge, role checks and no-side-effect rejection; HT `/results` receives 403 before result upsert/audit/status/prize/horse mutation; type/lint/build. Existing mock Playwright evidence is regression-only and no longer counts as integration acceptance under CR-010. Acceptance requires real-stack browser/API/DB evidence for HT register→scratch, no registration outside OPEN, HT result-control absence, CM CLOSED/post-race Save Draft preserving CLOSED, Lock to COMPLETED, exactly one `/results` and zero `/lock-results`.
- **Execution Evidence:** `reports/TASK-003.md`.
- **Manual QA:** with `VITE_USE_MOCK` disabled and the real Backend/PostgreSQL running, verify the full UPCOMING→OPEN→CLOSED→COMPLETED sequence; HT registers in OPEN and scratches in OPEN/CLOSED but cannot register in UPCOMING/CLOSED; CM cannot write/lock before CLOSED or raceDate, Save Draft preserves CLOSED, Lock completes once; direct HT result request returns 403; attempt prohibited deletes. Restart Backend/Frontend and confirm the tournament state persists.
- **Scope:** M; eight application/test files explicitly approved by CR-009. Any ninth file requires another CR.

## TASK-004 — Head Trainer boundaries

- **Status:** DONE
- **Objective:** Complete HT screens/actions without horse master-data or tournament-management leakage.
- **Dependencies:** TASK-002, TASK-003.
- **Files likely touched:** FE `src/shared/lib/permissions.ts`, verified training/race action component, `tests/e2e/rbac-matrix.spec.ts`, `tests/e2e/training.spec.ts`; BE controller spec only if a guard gap is proven.
- **Acceptance:** HT can plan/schedule/run trial, check eligibility, register/scratch and view published tournament results; cannot record/edit/lock results or mutate horse profile, event definition/status, accounts or permissions.
- **Automated:** FE RBAC/training/racing E2E, typecheck/lint; focused BE guard spec if touched. Retain negative result-write coverage established by TASK-003.
- **Execution Evidence:** `reports/TASK-004.md`.
- **Manual QA:** navigate all HT menu items and direct URLs; verify register/scratch succeeds while result-entry and all other prohibited API/UI actions fail closed.
- **Scope:** M (3–5 files).

### Checkpoint WEB-1

- Permission, horse authority, tournament lifecycle and HT boundaries pass UI/API checks; server remains authority.

## TASK-005 — Vet Medical visibility and status boundary

- **Status:** DONE
- **Objective:** Keep all required Medical screens visible to Vet and separate view permission from write authority.
- **Dependencies:** TASK-001.
- **Files likely touched:** BE `src/medical/medical.controller.ts`, `src/medical/medical-access.service.ts`, `src/medical/medical.controller.spec.ts`; FE `src/shared/lib/permissions.ts`, `tests/e2e/medical.spec.ts`.
- **Acceptance:** Vet can perform the specified medical workflow and lock actions; other `viewMedical` holders cannot write Vet records; Vet status changes are limited to medical transitions; non-medical lifecycle mutation is rejected server-side.
- **Automated:** medical controller/services specs, FE medical E2E, type/lint.
- **Execution Evidence:** `reports/TASK-005.md`.
- **Manual QA:** Vet completes record→lock→release; Owner/Groom read scoped records but write attempts fail.
- **Scope:** M (5 files).

## TASK-006 — Groom supply view/request boundary

- **Status:** DONE
- **Objective:** Enforce the resolved rule that only Club Manager controls Supply Catalog while Groom can view assigned inventory and request replenishment when short.
- **Dependencies:** TASK-001. CR-002 is resolved with no catalog permission for Groom.
- **Files likely touched:** BE `src/supplies/supplies.controller.ts`, `src/supplies/supplies.controller.spec.ts`, `src/inventory/inventory.controller.spec.ts`; FE `src/features/master-data/pages/SuppliesCatalogPage.tsx`, focused supplies E2E.
- **Acceptance:** Groom can view catalog/assigned inventory and create a positive-quantity request; cannot create/update/toggle catalog, adjust stock, review, reject or deliver; CM retains all catalog and approval/delivery controls.
- **Automated:** focused supply/inventory authorization tests, FE E2E, type/lint.
- **Manual QA:** run identical catalog/request actions as Groom and CM and verify denied mutations leave data unchanged.
- **Scope:** M (5 files).

## TASK-007 — Horse Owner scope and profile boundary

- **Status:** DONE
- **Objective:** Guarantee ownership isolation and remove direct self-permission editing.
- **Dependencies:** TASK-001.
- **Approved files:** BE `src/accounts/me.service.spec.ts`, `src/financial/financial.service.spec.ts`, `src/horses/horses.service.spec.ts`, `src/tournaments/tournaments.controller.ts`, `src/tournaments/tournaments.service.ts`, `src/tournaments/tournaments.service.spec.ts`; FE `tests/e2e/rbac-matrix.spec.ts`.
- **Acceptance:** Owner sees only owned horse/training/race/finance data; foreign IDs return 403/404 without leakage; profile/password/notification work; permission change is request-only. Tournament metadata remains available, but authenticated tournament detail must pass the caller to the service and a `HORSE_OWNER` query must constrain registrations/results by `horse.ownerId = user.userId` before data is returned. No foreign registration, result, owner ID, full name or email may be present. Existing behavior for non-owner roles is unchanged.
- **Automated:** focused BE scope/me/tournament tests, including negative foreign registration/result/PII assertions; FE RBAC E2E using real seeded cross-owner IDs; real NestJS/PostgreSQL API verification; typecheck/lint and `git diff --check`.
- **Execution Evidence:** `reports/TASK-007.md`.
- **Manual QA:** two-owner cross-access matrix plus self-profile actions.
- **Scope:** M; exactly 7 application/test files approved by CR-011. Any eighth application/test file requires another CR.

## TASK-008 — Scope operational notifications

- **Status:** DONE
- **Objective:** Route account, shift, stall, horse, supply and financial notifications to exact actors without scope leakage.
- **Dependencies:** TASK-002, TASK-005, TASK-006, TASK-007.
- **Files touched (5 files):** BE `src/notifications/notifications.service.ts`, `src/notifications/notifications.service.spec.ts`, `src/accounts/accounts.service.ts`, `src/accounts/accounts.service.spec.ts`; FE `tests/e2e/notifications.spec.ts`.
- **Acceptance:** owner/groom horse notices only for owned/assigned horse; account change reaches target; restock reaches CM/requester; no unrelated recipient rows.
- **Automated:** notification service specs with negative recipients (42/42 BE unit tests passed); FE notification Playwright E2E (8/8 passed); typecheck clean; Backend lint clean (0 errors, 0 warnings); Frontend lint exited 0 with pre-existing baseline warnings outside TASK-008 scope.
- **Execution Evidence:** `reports/TASK-008.md`.
- **Manual QA:** execute one scoped horse change and verify related/unrelated inboxes.
- **Scope:** M (5 files).

## TASK-009 — Incident audience and 3-hour escalation

- **Status:** DONE
- **Objective:** Implement the approved incident audience, acknowledgement and repeat policy without spam.
- **Dependencies:** TASK-008.
- **Files touched (5 files):** BE `src/incidents/incidents.service.ts`, `src/incidents/incidents.service.spec.ts`, `src/incidents/incidents.scheduler.ts`, `src/incidents/incidents.module.ts`, `src/incidents/incidents.scheduler.spec.ts`.
- **Acceptance:** immediate audience follows severity/CR (5 groups for CRITICAL; 3 groups for MILD/MODERATE); reminder occurs every 3 hours only while unacknowledged; acknowledgement stops reminders; retry dedupes per round/recipient; catastrophic injury halts the session and never auto-creates record/lock. Non-Vet review rejected with 403 Forbidden.
- **Automated:** fake-clock scheduler, concurrency/dedupe, incident service and Prisma validation tests (26/26 passed); full Backend test suite (623/623 passed); typecheck clean; lint clean.
- **Execution Evidence:** `reports/TASK-009.md`.
- **Manual QA:** create incident, advance test clock 3 hours, acknowledge as Vet and verify no later reminder.
- **Scope:** M (5 files).

## TASK-010 — Medical Lock notification ownership

- **Status:** DONE
- **Objective:** Align lock-created/lifted/extended notifications with approved responsibilities and complete the Main Web real-only runtime cutover.
- **Dependencies:** TASK-008, TASK-009.
- **Authorized files:** exactly ten files across two sequential M-size slices under the same TASK-010:
  - **Slice A — already modified and preserved:** BE `src/medical/medical-locks.service.ts`, `src/medical/medical-services.spec.ts`; FE `src/shared/lib/api.ts`, `.env.example`, `tests/e2e/notifications.spec.ts`.
  - **Slice B — corrective work authorized by CR-012 after a new START:** FE `src/features/dashboard/pages/AuditLogPage.tsx`, `Dockerfile`, `src/vite-env.d.ts`, `.github/workflows/ci.yml`, `AGENTS.md`.
- **Acceptance:** only Vet mutates a lock; each affected actor receives only scoped events; CM audit behavior follows accepted CR-001; lock sync remains immediate; no duplicate for acting Vet unless policy requires it. Main Web runtime has no mock mode/import/fallback, defaults to the real API, and reports Backend/DB unavailability as an error.
- **Automated:** medical service tests; FE type/lint/build; notification browser integration against real Backend/PostgreSQL; static/build check proves application runtime cannot import `src/shared/mock/`. Production/CI build is real-only and contains no `VITE_USE_MOCK`; standalone FE CI must explicitly defer integration Playwright when Backend/PostgreSQL are unavailable rather than enable mock-backed tests.
- **Execution Evidence:** `reports/TASK-010.md`.
- **Manual QA:** create/lift lock through the real stack and inspect all actor inboxes plus persisted audit/lock state; restart services and confirm persistence; stop Backend and confirm an explicit error with no sample data. Cleanup must target captured lock/notification/audit IDs atomically, restore the captured original horse state, and assert zero targeted residue.
- **Scope:** two sequential M-size slices of exactly 5 files each. No intermediate TASK-010 approval, no parallel task, and no TASK-011 work before combined TASK-010 acceptance and human approval.

### Checkpoint WEB-2

- Five-role matrix and approved CR-001 notification rules pass real UI/API/DB negative tests; Main Web has no runtime mock/fallback before the Web phase can close.

## TASK-011 — REST/session packet contract in canonical SIM

- **Status:** DONE
- **Objective:** Port only validated API/session contract pieces from `_v3` into `Racehorse_Simulator_Web/`, preserving canonical microchip work.
- **Dependencies:** TASK-010.
- **Included:** session/context DTO mapping, API error handling, packet contract tests; compare before applying.
- **Excluded:** UI wiring, engine changes, launcher changes, deletion of `_v3`.
- **Files touched (4 files):** SIM `src/api/simulatorApi.ts`, `src/api/simulatorApi.test.ts`, `src/api/horsesApi.ts`, `src/sim/packetContract.test.ts`.
- **Acceptance:** real-mode client requests an existing session context; mapped horse keeps Backend `horse_id` and microchip masking; error envelopes surface code/message; packet test matches BE DTO/event names.
- **Automated:** SIM `npm run typecheck`, `npm test`, `npm run build` all pass cleanly.
- **Execution Evidence:** `reports/TASK-011.md`.
- **Manual QA:** inspect a known Backend session request; confirm no login UI was introduced; verify Backend error envelope surfacing.
- **Scope:** M (4 files).

## TASK-020 — Controlled Web manual-QA dataset expansion

- **Status:** DONE
- **Objective:** Add abundant, reproducible manual-QA fixtures to the existing local PostgreSQL database without creating another database/schema or mutating non-QA records.
- **Dependencies:** TASK-011.
- **Included:** deterministic QA-only users and cross-owner horses; stalls/assignments; training/workouts; medical/injury/lock/preventive data; tournaments/registrations/results; invoices/notifications/permission requests; incidents; supply stock/restock lifecycle; nutrition, daily-care/grooming, shifts and simulator-session history.
- **Excluded:** Prisma schema/migration, application behavior, production data, deletion/truncation, edits to the existing comprehensive seed, Frontend/Simulator changes and TASK-012 pre-work.
- **Authorized files:** BE `prisma/seed-manual-qa.ts`, BE `package.json`.
- **Safety:** require an explicit local-QA CLI confirmation; refuse `NODE_ENV=production`; print the target host/database before mutation; use stable valid IDs plus `QA-` codes/emails; upsert only QA-owned records; never `delete`, `deleteMany`, truncate or update a non-QA record.
- **Minimum QA dataset:** at least 12 QA users across all five roles/lifecycle cases; 24 QA horses across all horse statuses and at least three owners/four grooms; 24 QA stalls/allocations; 12 training plans and 48 workouts across lifecycle states; 12 medical records, 8 injuries, 6 lock histories and preventive schedules; 12 incidents across severity/review states; 12 tournaments across all statuses with at least 30 registrations and 12 results; 16 invoices and 30 notifications; stock balances for every seeded supply plus at least 12 restock requests across request states; 12 nutrition plans, 28 daily-care tasks and representative grooming/shift/simulator-session history.
- **Acceptance:** first run reaches every minimum count; second identical run creates zero additional QA rows; captured non-QA counts and stable row fingerprints are unchanged; real NestJS API/PostgreSQL checks prove five-role ownership/RBAC and list/filter/pagination usability; data persists after Backend restart; no mock/fallback is used.
- **Automated:** BE typecheck/lint; existing full BE unit baseline with the accepted medical E2E waiver unchanged; `npm run db:seed:manual-qa -- --confirm-local-qa` twice; inline Prisma verifier for minimum counts, idempotency and non-QA invariants; `git diff --check`.
- **Manual QA:** sign in as CM, HT, Vet, two Grooms and at least three Owners; inspect long lists and cross-owner boundaries across horse, training, medical, incident, tournament, finance, notification, supply/restock and daily-care screens; restart Backend and recheck representative records.
- **Scope:** S (exactly 2 application/tooling files). Canonical coordination/report files do not expand application scope. Any third application/tooling file requires a new CR.

## TASK-012 — Realtime engine and transport reconciliation

- **Status:** DONE
- **Objective:** Bring canonical SIM packet emission/ACK behavior to `_v3` parity without overwriting newer canonical rules.
- **Dependencies:** TASK-020.
- **Included:** 1 Hz emission, ACK/retry/idempotent event id, disconnect state, finished/incident packets.
- **Excluded:** React screens and Backend changes.
- **Files likely touched:** SIM `src/sim/packets.ts`, `src/sim/engine.ts`, `src/sim/engine.test.ts`, `src/sim/socketTransport.ts`, `src/sim/socketTransport.test.ts`.
- **Acceptance:** tick is 1 Hz ±5%; retry reuses event id; ACK stops retry; disconnect/finish cannot duplicate persistence events; catastrophic injury aborts but does not auto-lock.
- **Automated:** focused Node tests plus full SIM test/typecheck/build.
- **Manual QA:** simulate lost ACK and reconnect; observe one logical incident/session finish.
- **Scope:** M (5 files).

## TASK-013 — Canonical v3 SIM session-bound bootstrap, real session data and browser acceptance

- **Status:** DONE
- **Objective:** Run the v3 product from canonical Git `Racehorse_Simulator_Web/`, remove the direct Simulator login, bind REST context plus Socket.IO actor identity to the Main-Web-issued session, and make the Head Trainer workout and Veterinarian examination paths truthfully usable with PostgreSQL-backed horse master data in a real browser.
- **Dependencies:** TASK-012.
- **Execution shape:** one human-gated task with eight sequential slices and one combined acceptance gate. Slices A-G are existing uncommitted work; approved CR-019 adds corrective Slice H after Human Manual QA. There is no intermediate task approval between slices.
- **Slice A — Backend/session transport:** validate the supplied `sessionId` for REST context and Socket.IO; accept only eligible `PENDING`/`RUNNING` sessions, apply a five-minute launch timeout to stale `PENDING` sessions without a schema migration, resolve the actor from `SimulatorSession.actorUserId`, and reject missing/invalid/terminal/expired sessions. Remove the no-token fallback that impersonates a default Head Trainer.
- **Slice A authorized files:** BE `src/simulator/simulator.service.ts`, `src/simulator/simulator.service.spec.ts`, `src/simulator/simulator.gateway.ts`, `src/simulator/simulator.gateway.spec.ts`; SIM `src/sim/socketTransport.ts`, `src/sim/socketTransport.test.ts`.
- **Slice B — canonical v3 UI:** bootstrap from `sessionId`, load the exact real session/horse/workout-or-exam context, connect transport with that session, apply lock sync immediately, and remove every reachable login/mock/sample-data path while preserving the v3 map, UI, animation and engine behavior.
- **Slice B authorized files:** SIM `src/ui/App.tsx`, `src/ui/FarmHub.tsx`, `src/ui/TrialTab.tsx`, `src/ui/VetZone.tsx`, `src/ui/HorseCard.tsx`.
- **Slice C — real horse/exam correction:** include real `weightKg` and active stall (or explicit absent value) in the session context; use PostgreSQL master values rather than ID-hash/default master data; fields that are model outputs must be clearly represented as simulated values; an EXAM session must expose one clear completion action that publishes the existing `sim:exam_finished` contract, receives ACK, persists once, and becomes the latest result loadable by Main Web. Remove the misleading 480 kg initial form value. Missing required master data must be displayed as unavailable or rejected explicitly, never fabricated.
- **Slice C additional authorized files:** BE `src/simulator/simulator.types.ts`, `prisma/seed-manual-qa.ts`; SIM `src/api/simulatorApi.ts`, `src/api/simulatorApi.test.ts`, `src/api/horseMapper.ts`, `src/api/horseMapper.test.ts`; FE `src/features/health/pages/RecordFormPage.tsx`. Slice C may also update the already-authorized BE `src/simulator/simulator.service.ts`, `src/simulator/simulator.service.spec.ts` and SIM `src/ui/App.tsx`, `src/ui/VetZone.tsx`, `src/ui/HorseCard.tsx`. No schema/migration is authorized.
- **Slice D — browser-ready real-stack gate:** add FE `tests/e2e/simulator-real-stack.spec.ts` as the only additional browser-test file. Prepare one deterministic QA-owned `TRIAL + SCHEDULED` workout that is eligible at verification time, belongs to a Head Trainer, is not medically locked and appears in the default Trial Runs date range. Reuse the already-running Docker/npm services where healthy; do not edit or use `.bat` launchers. Leave reproducible Human Manual QA URLs/accounts/fixture identity ready so the human can reload ports 5173/5175 and retest without source edits or DB surgery.
- **Slice E — deterministic completion and streamlined human flow:** ensure a Main-Web-issued workout uses its prescribed surface/distance/intensity and cannot be altered in Simulator; hide obstacle authoring when the Backend workout contains no obstacle prescription rather than inventing one. Reaching the prescribed distance must stop the runner/animation, transition visibly to DONE, show the summary and emit exactly one `sim:session_finished`. Keep formatting/loading the persisted trial result into Main Web and live-monitor completion in TASK-016. For EXAM sessions, bypass the decorative intro, open the Vet flow directly, emit exactly one `sim:exam_finished`, expose a clear return/close action after ACK, and make Main Web auto-load the newest acknowledged measurements when its tab regains focus while retaining the manual load button as fallback. Vital cards must say `Within reference range` / `Outside reference range` (localized) and must not imply the horse's overall injury status or Medical Lock state.
- **Slice E additional authorized files:** SIM `src/main.tsx`; FE `src/features/health/components/VitalsDisplay.tsx`. Slice E may update the already-authorized SIM `src/ui/App.tsx`, `src/ui/TrialTab.tsx`, `src/ui/VetZone.tsx`, `src/sim/socketTransport.ts`, `src/sim/socketTransport.test.ts`; FE `src/features/health/pages/RecordFormPage.tsx`, `tests/e2e/simulator-real-stack.spec.ts`; and existing focused BE Simulator service/gateway specs only where required to prove exactly-once completion. No obstacle schema/API authoring, trial-result Main-Web UI, new dependency or additional application/test file is authorized.
- **Slice F — QA-rejected contract corrections:** reject a terminal SimulatorSession for the same workout with 409 `SIMULATOR_SESSION_FINISHED` and never return its launch URL; preserve unavailable EXAM weight as omitted/null through packet validation, persistence and Main-Web loading without fabricating a value; map the medical-record list to the real horse name/code; and provision/reset only deterministic, idempotent `QA T013` fixtures so Human QA requires only reload, login, search and action.
- **Slice F additional authorized files:** BE `src/simulator/dto/exam-packet.dto.ts`, `src/medical/medical-records.service.ts`; FE `src/features/health/api.ts`, `src/features/health/pages/RecordListPage.tsx`; SIM `src/sim/packets.ts`. Slice F may update previously authorized BE Simulator service/spec and `prisma/seed-manual-qa.ts`, SIM packet/UI/transport tests, FE `RecordFormPage.tsx` and `tests/e2e/simulator-real-stack.spec.ts`. No schema/migration, new database, dependency, `.bat`, `_v3`, TASK-014 or later-task implementation is authorized.
- **Slice G — playback/chart and trial-scheduling correction:** preserve deterministic modeled results across 1×/10×/60× and keep Socket.IO telemetry at 1 Hz real time, but sample/render the visual curve by simulated elapsed time so 60× shortens wall-clock viewing without collapsing the chart to a few samples. Label playback speed and simulated elapsed time clearly. From the Trial Runs page, initialize the existing scheduling dialog as `TRIAL`; saving a valid distinct slot must produce a TRIAL row visible after reload while all existing Backend validation remains authoritative.
- **Slice G additional authorized files:** FE `src/features/training/pages/TrialRunsPage.tsx`, `src/features/training/components/WorkoutDialogs.tsx`. Slice G may update already-authorized SIM `src/ui/TrialTab.tsx` and FE `tests/e2e/simulator-real-stack.spec.ts`. No Backend/schema/migration/database recreation, broad QA-data deletion, dependency, `.bat`, `_v3`, TASK-014 or later-task implementation is authorized.
- **Slice G executor exception:** Codex may execute this TASK-013 continuation only after the human sends exact direct command `START TASK-013 CODEX`. Codex may update the execution/report fields for this slice and must stop at `AWAITING_USER_QA`. AGY remains the default executor for TASK-014 and later tasks.
- **Slice H — launch timing clarity and Simulator draft refresh:** keep future workouts blocked by the existing FE/Backend scheduled-time rule, but show the exact earliest launch time visibly. Reuse the existing latest-result API on initial mount, window focus and explicit retry while no persisted trainer result exists; identify imported and unavailable measurements; derive only `ACHIEVED` for a completed full-distance run or `PARTIAL` for an aborted/short run. Never infer recovery HR, performance score, professional comment or abnormal signs.
- **Slice H authorized files:** add FE `src/features/training/pages/SessionResultPage.tsx` and update already-authorized FE `src/features/training/pages/TrialRunsPage.tsx` plus `tests/e2e/simulator-real-stack.spec.ts`. No Backend, schema, migration, seed, dependency, Simulator source, `.bat`, `_v3`, TASK-014 or other later-task implementation is authorized.
- **Slice H executor exception:** Codex may execute this continuation only under exact direct `START TASK-013 CODEX`, update execution/report fields, and must stop at `AWAITING_USER_QA`.
- **Excluded:** root `start.bat`/`stop.bat`, `_v3` edits, schema/migration, a new authentication system, UI redesign, and TASK-014 or later work.
- **Acceptance:** canonical `Racehorse_Simulator_Web/` is the only Simulator source changed/tested; a valid Main-Web-issued workout or exam session opens the v3 UI without a second login; no runtime form or request to `/auth/login`; direct port 5175 access without a session shows a safe Vietnamese instruction; missing/invalid/terminal/expired/cross-actor sessions and Backend/DB failure fail closed; a terminal session is never returned as a usable launch; Socket.IO persists under the exact actor; the session horse UUID/name/weight/stall/microchip representation matches PostgreSQL and never uses a hash/default as master data; an eligible Head Trainer trial has a usable launch action and immutable prescribed setup; no unprescribed obstacle controls are exposed; at distance completion the runner stops, DONE/summary appears and one finish packet is persisted/broadcast; the exact session horse is discoverable by deterministic QA name/code; the same seed/config produces equivalent modeled finish/result at 1×/10×/60×; 60× changes only wall-clock viewing duration; its chart remains readable on a simulated-time axis while transport remains 1 Hz real time; “Lên lịch chạy thử” preselects TRIAL and a valid distinct slot is visible after reload; EXAM bypasses the decorative intro, completes with one acknowledged packet even when weight is unavailable, preserves unavailable weight without fabrication, offers return/close, and Main Web auto-loads the persisted available measurements on focus/reload; medical-record lists show real horse name/code rather than UUID; vital-range labels are not horse-health labels; Medical Lock disables heavy action immediately.
- **Automated:** focused BE service/gateway tests; SIM bootstrap/transport/API/mapper/engine tests including deterministic 1×/10×/60× result equivalence and readable simulated-time samples; FE focused typecheck/lint; full relevant BE and SIM tests, SIM typecheck/build; static scan proves no reachable login/runtime mock/sample fallback; real-stack Playwright/Chromium with no request interception or mock data. Browser coverage must create a TRIAL from the Trial Runs entry point and see it after reload, run the prescribed trial through completion at 60× with a readable curve, prove the runner stops and exactly one finish frame/handler/persistence result occurs, prove EXAM has no intro gate and emits exactly one completion, then prove focus/reload auto-load plus manual fallback.
- **Browser QA gate:** through UI, log in as real Head Trainer and Vet; prove Network calls to NestJS for trial list/start, EXAM start/context/latest result; prove Socket.IO connects to Backend and `sim:exam_finished` receives ACK; compare browser values with direct PostgreSQL reads; reload both apps and prove persistence/refetch; capture screenshots, console and sanitized Network evidence. API-only scripts do not satisfy this gate. Expected invalid-session 404 must be isolated from otherwise clean consoles.
- **Manual QA:** with existing Docker/npm processes left running, human reloads Main Web, creates one distinctly named trial through “Lên lịch chạy thử”, confirms TRIAL is preselected and the saved row appears after reload; launches the deterministic `QA T013` trial at 60× and sees a readable simulated-time curve, immutable prescribed setup, no unprescribed obstacle editor, automatic stop/DONE/summary at the exact distance; verifies retrying the finished workout gives a clear terminal message rather than a broken Simulator tab; launches the named EXAM directly without the cloud intro, completes it once with available measurements even when weight is absent, closes/returns, and observes Main Web auto-populate the newest acknowledged values without first pressing the fallback load button; verifies the medical-record list shows horse name/code, not UUID. Verify an injured/locked horse may have vitals within reference range while its separate horse status and Medical Lock remain injured/locked. Known accepted limitation: after the Head Trainer edits imported result fields, the Simulator reload button (`Tải chỉ số từ Simulator`) becomes disabled until the page is reloaded or edits are discarded. The executor must put a compact `HUMAN QA — READY` block at the top of the report with database name, QA accounts, exact names/codes/routes and expected outcomes, then stop at `AWAITING_USER_QA`.
- **Scope:** L, exactly 29 application/test files across eight sequential slices: the 28 previously authorized files plus `SessionResultPage.tsx` under CR-019. Canonical coordination/report/evidence files do not expand application scope; a thirtieth application/test file requires a new CR.

## TASK-014 — Launcher uses canonical SIM

- **Status:** DONE
- **Objective:** Provide an explicit three-script Windows lifecycle: reset/seed the local PostgreSQL database, start the complete real stack in one four-tab terminal, and force-stop all EquiFlow local runtime.
- **Dependencies:** TASK-013.
- **Corrective scope under CR-020:** preserve the uncommitted TASK-014 work, but supersede the prior two-file/three-tab QA handoff. Execution resumes only after a new direct `START TASK-014`.
- **Files likely touched:** exactly root `setup-db.bat`, `start.bat`, `stop.bat`; canonical coordination/report files do not expand application scope.
- **`setup-db.bat`:** warn that the operation resets local data; verify Node/npm/Docker and the canonical local target; start/create `equiflow-postgres`; fail non-zero on Compose, PostgreSQL readiness, dependency, Prisma or `npm run db:setup` failure; report success only after deterministic seed completion.
- **`start.bat`:** never reset or seed data; ensure required dependencies and Docker/PostgreSQL runtime are available; use `Racehorse_Simulator_Web`, never `_v3`; open exactly one Windows Terminal with four tabs for Backend 3000, Frontend 5173, canonical Simulator 5175 and PostgreSQL/Docker status or logs; bounded-poll BE health, FE and SIM before printing success or opening browsers; no mock flag or fallback data.
- **`stop.bat`:** human explicitly authorizes forced termination of the EquiFlow listeners on ports 3000/5173/5175 and stopping `equiflow-postgres`; verify afterward that all three ports are closed and the container is stopped, otherwise exit non-zero with diagnostics.
- **Acceptance:** the ordered lifecycle `stop.bat -> setup-db.bat -> start.bat` produces one real PostgreSQL-backed stack; four visible tabs use the canonical repos; BE health reports database connected, FE and SIM respond, no `_v3` or runtime mock path is used; false-success paths are eliminated; stop leaves no EquiFlow listener or database container running.
- **Automated:** static syntax/path/zero-`_v3` checks and existing relevant build checks; do not run the destructive reset or force-stop scripts automatically without separate runtime authorization.
- **Manual QA:** from a stopped local stack, run `setup-db.bat`, then `start.bat`; verify four tabs and `http://localhost:3000/api/health`, `http://localhost:5173`, `http://localhost:5175`; run `stop.bat` and verify the URLs/ports fail and `equiflow-postgres` is stopped; exercise at least one controlled failure and confirm non-zero/actionable output.
- **Delivery limitation:** the workspace root is not a Git repository, so these three root scripts cannot be distributed by pulling any of the three current repositories. The report must state this truthfully; resolving team distribution requires a separately approved repository-layout decision.
- **Scope:** S (exactly 3 root scripts).

### Checkpoint SIM

- Canonical Git Simulator only; `_v3` untouched; no secondary login or reachable runtime sample-data path; full SIM gates pass against real Backend/PostgreSQL before synchronization work begins.

## TASK-015 — Real horse/stall catalogue→SIM data flow

- **Status:** DONE — Approved 2026-10-28; report in reports/TASK-015.md
- **Objective:** Let the canonical Simulator open directly without a secondary login and browse the complete real horse/stall catalogue from Backend/PostgreSQL. Simulator functional areas are not Main-Web role views; do not add CM/Groom launch UI or role-filter the catalogue.
- **Dependencies:** TASK-002, TASK-006, TASK-007, TASK-014.
- **Files likely touched:** reconcile the existing public Simulator horse/stall catalogue endpoint/client and mapper baseline first; use the existing five-file budget unless a proven gap requires another CR. No schema/migration or Main-Web launch page is expected.
- **Acceptance:** direct port 5175 access has no login/session gate for catalogue browsing; all real horses and active stalls load from Backend/PostgreSQL; horse UUID is the key; full 15-digit microchip and active stall are preserved; reload/restart reflects persisted changes; Backend/DB failure is visible and never falls back to mock/sample/default horses; Simulator cannot mutate master data. Authoritative business write-back still requires the matching Backend-issued workflow session.
- **Automated:** focused BE catalogue/service tests plus SIM client/mapper tests, typecheck/build and real-stack browser coverage with no request interception or mock data. Prove direct catalogue load, a Web-side horse/stall change visible after Simulator reload, and fail-closed behavior when Backend is unavailable.
- **Manual QA:** open Simulator directly without `sessionId` or login; find multiple real horses and verify UUID/name/full chip/active stall against Main Web/PostgreSQL; change or reassign one horse/stall through authorized Main Web, reload Simulator and see the update; restart stack and verify persistence; stop Backend and confirm a visible error with no sample data. Do not test CM/Groom-specific Simulator views because they no longer exist by design.
- **Boundary:** TASK-016 owns trial telemetry/result write-back, TASK-017 owns incident/Vet/Medical Lock synchronization, and TASK-018 owns supplies. TASK-015 must not pre-implement them.
- **Scope:** M (maximum 5 application/test files); canonical coordination/report files do not count.

## TASK-016 — Trial session realtime

- **Status:** DONE — Approved 2026-10-28; report in reports/TASK-016.md
- **Objective:** Complete Web-created trial → SIM telemetry → persisted result/live monitor.
- **Dependencies:** TASK-004, TASK-015.
- **Approved CR-022 Contract:**
  1. `abortSession` and `recordFinished` perform a conditional atomic transition in database transaction only from `PENDING` or `RUNNING`. Neither delayed disconnect/timeout nor delayed finish can overwrite an already reached terminal outcome. Single persisted terminal outcome and broadcast.
  2. 5-minute rule is an absolute running-session watchdog beginning at the first accepted telemetry tick.
  3. Normal finish, accepted abort, client reconnect within 15s, and module teardown clear applicable timers. Reconnect within 15s preserves session. 15s expiry aborts once.
  4. Fake-clock and concurrency tests in the 2 Backend spec files cover all 7 scenarios specified in R-4.
- **Approved CR-023 Contract:**
  1. Head Trainer horse master-data visibility remains unchanged.
  2. Head Trainer training plans, workouts, and trial runs are strictly scoped to `trainingPlan.trainerUserId === current userId`.
  3. Club Manager and Veterinarian read visibility remains unchanged.
  4. Creating a workout or repeated workout against another trainer's plan must fail closed (403 Forbidden).
  5. Direct mutation/start requests for another trainer's workout must fail closed.
  6. Trial Runs must not render an actionable simulation row belonging to another trainer.
  7. After successful creation, the created trial must be visible immediately. If its date is outside the current filter, update/expand the filter to include that date before reload.
  8. Browser coverage with two real Head Trainer accounts and real PostgreSQL proves data isolation and immediate trial creation visibility.
- **Files touched (11 files):**
  - Prior 7 files (CR-022): BE `src/simulator/simulator.service.ts`, `src/simulator/simulator.gateway.ts`, `src/simulator/simulator.service.spec.ts`, `src/simulator/simulator.gateway.spec.ts`; SIM `src/ui/TrialTab.tsx`; FE `src/features/training/pages/LiveMonitorPage.tsx`, `tests/e2e/simulator-real-stack.spec.ts`.
  - 4 additional files (CR-023): BE `src/training/training-plans.service.ts`, `src/training/workouts.service.ts`, `src/training/training-services.spec.ts`; FE `src/features/training/pages/TrialRunsPage.tsx`.
- **Acceptance:** only authorized HT starts eligible active horse; Medical Lock/heavy rules block; 1 Hz telemetry appears live; finish/abort persists once; disconnect 15s and timeout 5m mark abort per contract; multi-trainer data scoping and fail-closed mutations enforced; created trial visible immediately on Trial Runs; all unit/integration/E2E tests pass.
- **Automated:** BE simulator specs (7 fake-clock/concurrency cases), BE training services specs, SIM isolated unit tests/build, FE/SIM real-stack integration E2E (including two-trainer scoping). No mock-backed E2E counts as acceptance.
- **Manual QA:** normal finish, emergency stop, lock-before-start, network-disconnect scenarios, multi-trainer trial isolation, and trial creation date visibility.
- **Scope:** M; expanded to exactly 11 application/test files via approved CR-022 and CR-023.

## TASK-017 — Incident→Vet→Lock round trip

- **Status:** DONE
- **Objective:** Prove advisory incident becomes a human-reviewed medical action and then synchronizes back to SIM.
- **Dependencies:** TASK-005, TASK-009, TASK-016.
- **Files likely touched:** BE incident/simulator/medical focused specs; FE incident/medical page components verified at task start; SIM `src/ui/VetZone.tsx` or `App.tsx` only if a UI gap is proven.
- **Acceptance:** incident persists and alerts; Vet reviews and explicitly creates record/lock; lock blocks active heavy action and future heavy/race entry; lift restores only allowed state; no automatic record/lock.
- **Automated:** focused BE integration/E2E, FE/SIM real-stack E2E, SIM isolated unit tests.
- **Execution Evidence:** `reports/TASK-017.md`.
- **Manual QA:** produce injury in SIM, handle in Vet Web, observe lock/lift in SIM and affected actor views.
- **Scope:** must be split by repository if >5 files after exact gap check; no implementation until split is approved.

## TASK-018 — Supply request/delivery simulation

- **Status:** DONE
- **Pending Change:** NONE.
- **Execution Evidence:** `reports/TASK-018.md` (r24 combined supply & audio verification complete; approved 2026-10-29).
- **Objective:** Connect Groom request and CM approval/delivery to SIM truck/inventory feedback.
- **Dependencies:** TASK-006, TASK-015.
- **Files likely touched:** BE inventory service/spec; SIM `src/ui/SupplyPanel.tsx`, `src/sim/inventory.ts`, its test; FE inventory/restock E2E.
- **Acceptance:** positive quantity/capacity validation; no duplicate `DELIVERING`; CM-only review/deliver; transaction updates inventory once; truck animation 8s with 20s fallback; requester notified.
- **Automated:** inventory transaction/concurrency tests, SIM isolated unit tests/build, FE/SIM real-stack E2E.
- **Manual QA:** Groom request→CM approve→delivery animation→inventory refresh; repeat/double-click and timeout cases.
- **Approved CR-024 contract:** CHANGES.md section 7 is the definitive approved specification. One request must flow from Groom proposal through CM approval/DELIVERING, automatic 8s Simulator animation, authorized ACK or server 20s fallback, atomic persisted credit and automatic Web/SIM refresh. Use real zone/supply identities and nullable persisted capacity; no independent local stock. Preserve legacy APPROVED receipt, workout/exam authority and unrelated concurrent data. Required tests include early/invalid ACK, duplicate/multi-tab/race, restart/offline recovery, capacity reservations and safe cleanup.
- **Scope:** 39 exact paths: CR-024 section 7.E (21) plus approved CR-025 (18 source/test/runtime asset paths). Includes existing sound integration; no new sound feature or dependency. Verify autoplay failure, missing assets, mute/volume persistence, lifecycle cleanup and real-stack delivery with audio enabled/disabled. Preserve local source music/NOW files and unused theme-main.wav outside delivery. One combined QA gate; fresh START TASK-018 required.

### Checkpoint ĐỒNG BỘ

- Four synchronization scenarios work with real Backend/PostgreSQL and role accounts; application runtime contains no mock mode/fallback; no duplicate persistence.

## TASK-019 — Full system acceptance

- **Objective:** Produce current, reproducible evidence for the approved plan without adding features.
- **Dependencies:** TASK-010, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018.
- **Source changes:** none; any defect opens CR or a scoped fix task.
- **Automated:** BE typecheck/lint/unit/e2e; FE typecheck/lint/full Playwright against real Backend/PostgreSQL; SIM typecheck/isolated unit tests/build plus real integration; static/build checks reject runtime imports or switches for mock data; 1 Hz benchmark.
- **Manual QA:** on one real-stack start: five-actor role matrix; horse/stall; trial normal/abort; incident/Vet/lock; supply delivery; tournament close/cancel/history; notification reminder; start/stop scripts; restart and verify persisted data; stop Backend/DB and verify visible failures without mock fallback.
- **Acceptance:** all gates pass at recorded revisions; browser Network proves Web/SIM requests reach the real Backend; DB before/after and restart evidence proves persistence; no runtime mock switch/import/fallback; no skipped/deleted tests or suppression; report lists tests not run and residual risk; status becomes `AWAITING_USER_QA`, never auto-DONE.
- **Evidence:** `docs/ai-workflow/reports/TASK-019.md` after execution only.

### Final checkpoint

- Human reviews evidence and manual QA. Only `APPROVE TASK-019` marks delivery done; it does not authorize deploy/merge/push.

