# Task Breakdown — Plan v1-approved-r4

> Approved specification with CR-005 incorporated. AGY may edit execution status/evidence only after `STATE.md` names the task as `next_task` and the human separately sends `START TASK-XXX`. One task per run.

| ID | Goal | Depends on | Status |
| --- | --- | --- | --- |
| TASK-001 | Align FE/BE permission contract | None | DONE |
| TASK-002 | Enforce Club Manager horse authority | 001 | DONE |
| TASK-003 | Finalize tournament lifecycle and controls | 001 | TODO |
| TASK-004 | Enforce Head Trainer boundaries | 002, 003 | TODO |
| TASK-005 | Expose Vet Medical and constrain status changes | 001 | TODO |
| TASK-006 | Enforce Groom supply view/request boundary | 001 | TODO |
| TASK-007 | Enforce Horse Owner scope and profile boundary | 001 | TODO |
| TASK-008 | Scope operational notifications by horse/actor | 002, 005–007 | TODO |
| TASK-009 | Implement incident audience and 3-hour escalation | 008 | TODO |
| TASK-010 | Align Medical Lock notifications and ownership | 008, 009 | TODO |
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

- **Objective:** Replace unsafe “permanent delete” semantics with explicit Close/Cancel/limited unused-record delete.
- **Dependencies:** TASK-001.
- **Files likely touched:** BE `src/tournaments/tournaments.service.ts`, `src/tournaments/tournaments.service.spec.ts`, `src/tournaments/dto/change-tournament-status.dto.ts`; FE tournament page/API and focused Playwright spec after verifying exact paths.
- **Acceptance:** only CM creates/edits/changes event status; HT eligibility/register/scratch/results works; delete rejects registration/result/completed history; Close/Cancel remains queryable and audited.
- **Automated:** focused tournament unit tests, type/lint; focused FE race E2E.
- **Manual QA:** CM creates→opens→closes/cancels; HT registers/scratches/records; attempt prohibited deletes.
- **Scope:** M; split FE into a follow-up CR before work if verified scope exceeds 5 files.

## TASK-004 — Head Trainer boundaries

- **Objective:** Complete HT screens/actions without horse master-data or tournament-management leakage.
- **Dependencies:** TASK-002, TASK-003.
- **Files likely touched:** FE `src/shared/lib/permissions.ts`, verified training/race action component, `tests/e2e/rbac-matrix.spec.ts`, `tests/e2e/training.spec.ts`; BE controller spec only if a guard gap is proven.
- **Acceptance:** HT can plan/schedule/run trial, check eligibility, register/scratch and record results; cannot mutate horse profile, event definition/status, accounts or permissions.
- **Automated:** FE RBAC/training E2E, typecheck/lint; focused BE guard spec if touched.
- **Manual QA:** navigate all HT menu items and direct URLs; prohibited API/UI actions fail closed.
- **Scope:** M (3–5 files).

### Checkpoint WEB-1

- Permission, horse authority, tournament lifecycle and HT boundaries pass UI/API checks; server remains authority.

## TASK-005 — Vet Medical visibility and status boundary

- **Objective:** Keep all required Medical screens visible to Vet and separate view permission from write authority.
- **Dependencies:** TASK-001.
- **Files likely touched:** BE `src/medical/medical.controller.ts`, `src/medical/medical-access.service.ts`, `src/medical/medical.controller.spec.ts`; FE `src/shared/lib/permissions.ts`, `tests/e2e/medical.spec.ts`.
- **Acceptance:** Vet can perform the specified medical workflow and lock actions; other `viewMedical` holders cannot write Vet records; Vet status changes are limited to medical transitions; non-medical lifecycle mutation is rejected server-side.
- **Automated:** medical controller/services specs, FE medical E2E, type/lint.
- **Manual QA:** Vet completes record→lock→release; Owner/Groom read scoped records but write attempts fail.
- **Scope:** M (5 files).

## TASK-006 — Groom supply view/request boundary

- **Objective:** Enforce the resolved rule that only Club Manager controls Supply Catalog while Groom can view assigned inventory and request replenishment when short.
- **Dependencies:** TASK-001. CR-002 is resolved with no catalog permission for Groom.
- **Files likely touched:** BE `src/supplies/supplies.controller.ts`, `src/supplies/supplies.controller.spec.ts`, `src/inventory/inventory.controller.spec.ts`; FE `src/features/master-data/pages/SuppliesCatalogPage.tsx`, focused supplies E2E.
- **Acceptance:** Groom can view catalog/assigned inventory and create a positive-quantity request; cannot create/update/toggle catalog, adjust stock, review, reject or deliver; CM retains all catalog and approval/delivery controls.
- **Automated:** focused supply/inventory authorization tests, FE E2E, type/lint.
- **Manual QA:** run identical catalog/request actions as Groom and CM and verify denied mutations leave data unchanged.
- **Scope:** M (5 files).

## TASK-007 — Horse Owner scope and profile boundary

- **Objective:** Guarantee ownership isolation and remove direct self-permission editing.
- **Dependencies:** TASK-001.
- **Files likely touched:** BE `src/accounts/me.service.ts`, `src/accounts/me.service.spec.ts`, proven horse/financial scope service; verified FE profile page; `tests/e2e/rbac-matrix.spec.ts`.
- **Acceptance:** Owner sees only owned horse/training/race/finance data; foreign IDs return 403/404 without leakage; profile/password/notification work; permission change is request-only.
- **Automated:** focused BE scope/me tests and FE RBAC E2E.
- **Manual QA:** two-owner cross-access matrix plus self-profile actions.
- **Scope:** M; split if verified scope exceeds 5 files.

## TASK-008 — Scope operational notifications

- **Objective:** Route account, shift, stall, horse, supply and financial notifications to exact actors without scope leakage.
- **Dependencies:** TASK-002, TASK-005, TASK-006, TASK-007.
- **Files likely touched:** BE `src/notifications/notifications.service.ts`, `src/notifications/notifications.service.spec.ts`, at most two proven producer services; FE `tests/e2e/notifications.spec.ts`.
- **Acceptance:** owner/groom horse notices only for owned/assigned horse; account change reaches target; restock reaches CM/requester; no unrelated recipient rows.
- **Automated:** notification service specs with negative recipients; FE notification E2E; type/lint.
- **Manual QA:** execute one scoped horse change and verify related/unrelated inboxes.
- **Scope:** M; only two producer families per run, otherwise create an approved split.

## TASK-009 — Incident audience and 3-hour escalation

- **Status:** TODO — contract fixed by approved CR-001; not authorized until dependencies complete and a separate START.
- **Objective:** Implement the approved incident audience, acknowledgement and repeat policy without spam.
- **Dependencies:** TASK-008.
- **Files likely touched:** BE `src/incidents/incidents.service.ts`, its spec, notification scheduler/new focused spec, Prisma schema + one additive migration only if the approved semantics require fields.
- **Acceptance:** immediate audience follows severity/CR; reminder occurs every 3 hours only while unacknowledged; acknowledgement stops reminders; retry dedupes per round/recipient; catastrophic injury halts the session and never auto-creates record/lock.
- **Automated:** fake-clock scheduler, concurrency/dedupe, incident service and Prisma validation/migration tests.
- **Manual QA:** create incident, advance test clock 3 hours, acknowledge as Vet and verify no later reminder.
- **Scope:** M after contract freeze; split migration/scheduler if scope exceeds 5 files.

## TASK-010 — Medical Lock notification ownership

- **Objective:** Align lock-created/lifted/extended notifications with approved responsibilities while keeping Vet-only mutation.
- **Dependencies:** TASK-008, TASK-009.
- **Files likely touched:** BE `src/medical/medical-locks.service.ts`, `src/medical/medical-services.spec.ts`; FE `tests/e2e/notifications.spec.ts`.
- **Acceptance:** only Vet mutates a lock; each affected actor receives only scoped events; CM audit behavior follows accepted CR-001; lock sync remains immediate; no duplicate for acting Vet unless policy requires it.
- **Automated:** medical service and notification E2E; type/lint.
- **Manual QA:** create/lift lock and inspect all actor inboxes plus the persisted audit/lock state.
- **Scope:** M (3 files).

### Checkpoint WEB-2

- Five-role matrix and approved CR-001 notification rules pass UI/API negative tests before the Web phase can close.

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
- **Included:** loading/expired/forbidden states, real/mock mode, Backend horse context and lock sync.
- **Excluded:** new authentication system or redesign.
- **Files likely touched:** SIM `src/ui/App.tsx`, `src/ui/FarmHub.tsx`, `src/ui/TrialTab.tsx`, `src/ui/VetZone.tsx`, `src/ui/HorseCard.tsx`.
- **Acceptance:** no login form; valid Main-Web session opens correct context; invalid session shows safe Vietnamese error; masked microchip is not reconstructed; Medical Lock disables heavy action immediately.
- **Automated:** SIM typecheck/test/build; focused pure tests for any extracted non-trivial branch.
- **Manual QA:** open valid, expired and forbidden sessions; exercise a lock-sync event.
- **Scope:** M (5 files).

## TASK-014 — Launcher uses canonical SIM

- **Objective:** Ensure one-click scripts install/start/stop the Git Simulator on port 5175.
- **Dependencies:** TASK-013.
- **Files likely touched:** root `start.bat`, `stop.bat`; canonical coordination files only if launcher evidence changes the handoff.
- **Acceptance:** no runtime reference to `_v3`; BE 3000, FE 5173 and SIM 5175 start once; stop closes them; missing dependencies produce actionable errors.
- **Automated:** script syntax/static path check and SIM build; do not terminate user processes during automated checks without authorization.
- **Manual QA:** run start/stop on Windows and visit all health URLs.
- **Scope:** S (2 files).

### Checkpoint SIM

- Canonical Git Simulator only; `_v3` untouched; no secondary login; full SIM gates pass before synchronization work begins.

## TASK-015 — Horse/stall Web→SIM flow

- **Objective:** Load real authorized horse/stall context into SIM; registration remains CM-only in Main Web.
- **Dependencies:** TASK-002, TASK-006, TASK-007, TASK-014.
- **Files likely touched:** BE `src/simulator/simulator.service.ts`, its spec; SIM `src/api/simulatorApi.ts`, `src/api/horseMapper.ts`, its test.
- **Acceptance:** context uses horse UUID as key; 15-digit microchip preserved/masked; active stall shown; unauthorized horse/session rejected; no Simulator-side duplicate source of truth.
- **Automated:** focused BE simulator tests + SIM mapper/API tests and build.
- **Manual QA:** CM creates/assigns horse in Web, launch SIM, verify data; Groom launch shows only assignment/masked chip.
- **Scope:** M (5 files).

## TASK-016 — Trial session realtime

- **Objective:** Complete Web-created trial → SIM telemetry → persisted result/live monitor.
- **Dependencies:** TASK-004, TASK-015.
- **Files likely touched:** BE simulator service/gateway specs; SIM `src/ui/TrialTab.tsx`; FE `src/features/training/pages/LiveMonitorPage.tsx` and focused simulator/live E2E path verified at task start.
- **Acceptance:** only authorized HT starts eligible active horse; Medical Lock/heavy rules block; 1 Hz telemetry appears live; finish/abort persists once; disconnect 15s and timeout 5m mark abort per contract.
- **Automated:** BE simulator specs, SIM tests/build, FE mock and live integration E2E, tick benchmark.
- **Manual QA:** normal finish, emergency stop, lock-before-start and network-disconnect scenarios.
- **Scope:** M; split transport/backend from FE if verified files exceed 5.

## TASK-017 — Incident→Vet→Lock round trip

- **Objective:** Prove advisory incident becomes a human-reviewed medical action and then synchronizes back to SIM.
- **Dependencies:** TASK-005, TASK-009, TASK-016.
- **Files likely touched:** BE incident/simulator/medical focused specs; FE incident/medical page components verified at task start; SIM `src/ui/VetZone.tsx` or `App.tsx` only if a UI gap is proven.
- **Acceptance:** incident persists and alerts; Vet reviews and explicitly creates record/lock; lock blocks active heavy action and future heavy/race entry; lift restores only allowed state; no automatic record/lock.
- **Automated:** focused BE integration/E2E, FE live E2E, SIM tests.
- **Manual QA:** produce injury in SIM, handle in Vet Web, observe lock/lift in SIM and affected actor views.
- **Scope:** must be split by repository if >5 files after exact gap check; no implementation until split is approved.

## TASK-018 — Supply request/delivery simulation

- **Objective:** Connect Groom request and CM approval/delivery to SIM truck/inventory feedback.
- **Dependencies:** TASK-006, TASK-015.
- **Files likely touched:** BE inventory service/spec; SIM `src/ui/SupplyPanel.tsx`, `src/sim/inventory.ts`, its test; FE inventory/restock E2E.
- **Acceptance:** positive quantity/capacity validation; no duplicate `DELIVERING`; CM-only review/deliver; transaction updates inventory once; truck animation 8s with 20s fallback; requester notified.
- **Automated:** inventory transaction/concurrency tests, SIM inventory tests/build, FE E2E.
- **Manual QA:** Groom request→CM approve→delivery animation→inventory refresh; repeat/double-click and timeout cases.
- **Scope:** M (5 logical files/tests).

### Checkpoint ĐỒNG BỘ

- Four synchronization scenarios work with real Backend and role accounts; mock mode remains usable; no duplicate persistence.

## TASK-019 — Full system acceptance

- **Objective:** Produce current, reproducible evidence for the approved plan without adding features.
- **Dependencies:** TASK-010, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018.
- **Source changes:** none; any defect opens CR or a scoped fix task.
- **Automated:** BE typecheck/lint/unit/e2e; FE typecheck/lint/full Playwright + real integration suite; SIM typecheck/test/build and map verification only if assets changed; 1 Hz benchmark.
- **Manual QA:** five-actor role matrix; horse/stall; trial normal/abort; incident/Vet/lock; supply delivery; tournament close/cancel/history; notification reminder; start/stop scripts.
- **Acceptance:** all gates pass at recorded revisions; no skipped/deleted tests or suppression; report lists tests not run and residual risk; status becomes `AWAITING_USER_QA`, never auto-DONE.
- **Evidence:** `docs/ai-workflow/reports/TASK-019.md` after execution only.

### Final checkpoint

- Human reviews evidence and manual QA. Only `APPROVE TASK-019` marks delivery done; it does not authorize deploy/merge/push.

