# Task Breakdown — Plan v1-approved-r11

> Approved specification with CR-005 through CR-012 incorporated. AGY may edit execution status/evidence only after `STATE.md` names the task as `next_task` and the human separately sends `START TASK-XXX`. One task per run.

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
| TASK-011 | Transplant REST/session packet contract into canonical SIM | 010 | TODO |
| TASK-012 | Reconcile SIM realtime engine and transport | 011 | TODO |
| TASK-013 | Wire canonical SIM UI with session bootstrap, no login | 012 | TODO |
| TASK-014 | Switch launcher to canonical SIM repo | 013 | TODO |
| TASK-015 | Complete horse/stall Web→SIM data flow | 002, 006, 007, 014 | TODO |
| TASK-016 | Complete trial session realtime flow | 004, 015 | TODO |
| TASK-017 | Complete incident→Vet→Lock round trip | 005, 009, 016 | TODO |
| TASK-018 | Complete supply request/delivery simulation | 006, 015 | TODO |
| TASK-019 | Full system acceptance and evidence | 010, 014–018 | TODO |

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

- **Objective:** Port only validated API/session contract pieces from `_v3` into `Racehorse_Simulator_Web/`, preserving canonical microchip work.
- **Dependencies:** TASK-010.
- **Included:** session/context DTO mapping, API error handling, packet contract tests; compare before applying.
- **Excluded:** UI wiring, engine changes, launcher changes, deletion of `_v3`.
- **Files likely touched:** SIM `src/api/simulatorApi.ts`, `src/api/simulatorApi.test.ts`, `src/api/horsesApi.ts`, `src/sim/packetContract.test.ts`.
- **Acceptance:** real-mode client requests an existing session context; mapped horse keeps Backend `horse_id` and microchip masking; error envelopes surface code/message; packet test matches BE DTO/event names.
- **Automated:** SIM `npm run typecheck`, `npm test`, `npm run build`.
- **Manual QA:** inspect a known Backend session request; confirm no login UI was introduced.
- **Scope:** M (4 files).

## TASK-012 — Realtime engine and transport reconciliation

- **Objective:** Bring canonical SIM packet emission/ACK behavior to `_v3` parity without overwriting newer canonical rules.
- **Dependencies:** TASK-011.
- **Included:** 1 Hz emission, ACK/retry/idempotent event id, disconnect state, finished/incident packets.
- **Excluded:** React screens and Backend changes.
- **Files likely touched:** SIM `src/sim/packets.ts`, `src/sim/engine.ts`, `src/sim/engine.test.ts`, `src/sim/socketTransport.ts`, `src/sim/socketTransport.test.ts`.
- **Acceptance:** tick is 1 Hz ±5%; retry reuses event id; ACK stops retry; disconnect/finish cannot duplicate persistence events; catastrophic injury aborts but does not auto-lock.
- **Automated:** focused Node tests plus full SIM test/typecheck/build.
- **Manual QA:** simulate lost ACK and reconnect; observe one logical incident/session finish.
- **Scope:** M (5 files).

## TASK-013 — Canonical SIM UI session bootstrap

- **Objective:** Wire canonical UI to session context/realtime while removing direct Simulator login.
- **Dependencies:** TASK-012.
- **Included:** loading/expired/forbidden/backend-unavailable states, real Backend session context and lock sync; remove runtime mock selection/fallback.
- **Excluded:** new authentication system or redesign.
- **Files likely touched:** SIM `src/ui/App.tsx`, `src/ui/FarmHub.tsx`, `src/ui/TrialTab.tsx`, `src/ui/VetZone.tsx`, `src/ui/HorseCard.tsx`.
- **Acceptance:** no login form or runtime mock mode; valid Main-Web session opens correct Backend context; invalid/expired/forbidden/unavailable states show safe Vietnamese errors; masked microchip is not reconstructed; Medical Lock disables heavy action immediately; no seed/sample operational data appears when API/DB fails.
- **Automated:** SIM typecheck/test/build; focused pure tests for any extracted non-trivial branch.
- **Manual QA:** using real Backend/PostgreSQL, open valid, expired and forbidden sessions; exercise a lock-sync event; stop Backend and confirm explicit failure without fallback data.
- **Scope:** M (5 files).

## TASK-014 — Launcher uses canonical SIM

- **Objective:** Ensure one-click scripts install/start/stop the Git Simulator on port 5175.
- **Dependencies:** TASK-013.
- **Files likely touched:** root `start.bat`, `stop.bat`; canonical coordination files only if launcher evidence changes the handoff.
- **Acceptance:** no runtime reference to `_v3`; BE 3000, FE 5173 and SIM 5175 start once against PostgreSQL; launcher never enables mock mode; stop closes them; missing Backend/DB/dependencies produce actionable errors and no fallback data.
- **Automated:** script syntax/static path check and SIM build; do not terminate user processes during automated checks without authorization.
- **Manual QA:** run start/stop on Windows and visit all health URLs.
- **Scope:** S (2 files).

### Checkpoint SIM

- Canonical Git Simulator only; `_v3` untouched; no secondary login or reachable runtime sample-data path; full SIM gates pass against real Backend/PostgreSQL before synchronization work begins.

## TASK-015 — Horse/stall Web→SIM flow

- **Objective:** Load real authorized horse/stall context into SIM; registration remains CM-only in Main Web.
- **Dependencies:** TASK-002, TASK-006, TASK-007, TASK-014.
- **Files likely touched:** BE `src/simulator/simulator.service.ts`, its spec; SIM `src/api/simulatorApi.ts`, `src/api/horseMapper.ts`, its test.
- **Acceptance:** context uses horse UUID as key; 15-digit microchip preserved/masked; active stall shown; unauthorized horse/session rejected; no Simulator-side duplicate source of truth.
- **Automated:** focused BE simulator tests + SIM isolated mapper/API tests and build; real-stack Web→API→DB→SIM integration for authorized and rejected sessions.
- **Manual QA:** using real Backend/PostgreSQL, CM creates/assigns horse in Web, launches SIM and verifies data; Groom launch shows only assignment/masked chip; restart and confirm the same persisted horse/stall context.
- **Scope:** M (5 files).

## TASK-016 — Trial session realtime

- **Objective:** Complete Web-created trial → SIM telemetry → persisted result/live monitor.
- **Dependencies:** TASK-004, TASK-015.
- **Files likely touched:** BE simulator service/gateway specs; SIM `src/ui/TrialTab.tsx`; FE `src/features/training/pages/LiveMonitorPage.tsx` and focused simulator/live E2E path verified at task start.
- **Acceptance:** only authorized HT starts eligible active horse; Medical Lock/heavy rules block; 1 Hz telemetry appears live; finish/abort persists once; disconnect 15s and timeout 5m mark abort per contract.
- **Automated:** BE simulator specs, SIM isolated unit tests/build, FE/SIM real-stack integration E2E, tick benchmark. No mock-backed E2E counts as acceptance.
- **Manual QA:** normal finish, emergency stop, lock-before-start and network-disconnect scenarios.
- **Scope:** M; split transport/backend from FE if verified files exceed 5.

## TASK-017 — Incident→Vet→Lock round trip

- **Objective:** Prove advisory incident becomes a human-reviewed medical action and then synchronizes back to SIM.
- **Dependencies:** TASK-005, TASK-009, TASK-016.
- **Files likely touched:** BE incident/simulator/medical focused specs; FE incident/medical page components verified at task start; SIM `src/ui/VetZone.tsx` or `App.tsx` only if a UI gap is proven.
- **Acceptance:** incident persists and alerts; Vet reviews and explicitly creates record/lock; lock blocks active heavy action and future heavy/race entry; lift restores only allowed state; no automatic record/lock.
- **Automated:** focused BE integration/E2E, FE/SIM real-stack E2E, SIM isolated unit tests.
- **Manual QA:** produce injury in SIM, handle in Vet Web, observe lock/lift in SIM and affected actor views.
- **Scope:** must be split by repository if >5 files after exact gap check; no implementation until split is approved.

## TASK-018 — Supply request/delivery simulation

- **Objective:** Connect Groom request and CM approval/delivery to SIM truck/inventory feedback.
- **Dependencies:** TASK-006, TASK-015.
- **Files likely touched:** BE inventory service/spec; SIM `src/ui/SupplyPanel.tsx`, `src/sim/inventory.ts`, its test; FE inventory/restock E2E.
- **Acceptance:** positive quantity/capacity validation; no duplicate `DELIVERING`; CM-only review/deliver; transaction updates inventory once; truck animation 8s with 20s fallback; requester notified.
- **Automated:** inventory transaction/concurrency tests, SIM isolated unit tests/build, FE/SIM real-stack E2E.
- **Manual QA:** Groom request→CM approve→delivery animation→inventory refresh; repeat/double-click and timeout cases.
- **Scope:** M (5 logical files/tests).

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

