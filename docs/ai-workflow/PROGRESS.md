# Delivery Progress

**Plan:** v1-approved-r22
**Plan approval:** APPROVED — explicit `APPROVE PLAN v1` recorded 2026-10-24  
**Active task:** NONE (IDLE)
**Next eligible task:** TASK-018 (TODO — not authorized)
**Planned first task:** TASK-001  
**Last updated:** 2026-10-29 (Asia/Bangkok)

This file reports progress only. It never authorizes implementation; `STATE.md`, recorded approval and a direct current-session `START TASK-XXX` command are all required.

## Summary

| State | Count |
| --- | ---: |
| TODO | 2 |
| BLOCKED | 0 |
| IN_PROGRESS | 0 |
| AWAITING_USER_QA | 0 |
| DONE | 18 |

## Task status

| Task | Status | Dependency/blocker |
| --- | --- | --- |
| TASK-001 | DONE | None (Approved 2026-10-24) |
| TASK-002 | DONE | Approved 2026-10-24 |
| TASK-003 | DONE | Approved 2026-10-24 |
| TASK-004 | DONE | Approved 2026-10-25 |
| TASK-005 | DONE | Approved 2026-10-25 |
| TASK-006 | DONE | Approved 2026-10-25; report in reports/TASK-006.md |
| TASK-007 | DONE | Approved 2026-10-25; report in reports/TASK-007.md |
| TASK-008 | DONE | Approved 2026-10-25; report in reports/TASK-008.md |
| TASK-009 | DONE | Approved 2026-10-25; report in reports/TASK-009.md |
| TASK-010 | DONE | Approved 2026-10-26; report in reports/TASK-010.md |
| TASK-011 | DONE | Approved 2026-10-26; report in reports/TASK-011.md |
| TASK-020 | DONE | Approved 2026-10-26; report in reports/TASK-020.md |
| TASK-012 | DONE | Approved 2026-10-26; report in reports/TASK-012.md |
| TASK-013 | DONE | Approved 2026-10-27; report in reports/TASK-013.md |
| TASK-014 | DONE | Approved 2026-10-28; report in reports/TASK-014.md |
| TASK-015 | DONE | Approved 2026-10-28; report in reports/TASK-015.md |
| TASK-016 | DONE | Approved 2026-10-28; report in reports/TASK-016.md |
| TASK-017 | DONE | Approved 2026-10-29; report in reports/TASK-017.md |
| TASK-018 | TODO — not authorized | TASK-006, TASK-015 |
| TASK-019 | TODO — not authorized | TASK-010, TASK-014–018, TASK-020 |

## Recent decisions

- TASK-017 was approved on 2026-10-29 (`APPROVE TASK-017`) following complete verification of real application contracts across NestJS API, Main Web UI, and Simulator Socket.IO, strictly non-destructive fixture isolation, correlated-only cleanup, sentinel concurrency preservation proof, accepted workout restoration, and passing Playwright tests on both viewports. Status is DONE. Execution is IDLE; TASK-018 remains unauthorized.

- TASK-017 was rejected on 2026-10-29 00:09 (`REJECT TASK-017`) requiring strictly correlated Notification/AuditLog cleanup (never deleting rows solely because IDs were absent from pre-test snapshot), sentinel concurrency preservation check, zero test-correlated residue assertions, and preservation of accepted workout restoration. Requirement R-10 has been fully resolved, verified with sentinel concurrency proof, zero-residue assertions, and confirmed passing across both viewports (`desktop-1280` in 18.0s, `desktop-1440` in 14.9s). TASK-017 is AWAITING_USER_QA.

- TASK-016 was approved on 2026-10-28 (`APPROVE TASK-016`) following complete verification of multi-trainer ownership scoping, fail-closed boundaries, TrialRunsPage filter auto-expansion, atomic finish/abort transitions, watchdog timers, and fail-safe deterministic fixture cleanup. Status is DONE.

- CR-023 was approved on 2026-10-28 and incorporated into v1-approved-r22: expands TASK-016 scope by 4 additional files to exactly 11 application/test files (adding BE training-plans.service.ts, workouts.service.ts, training-services.spec.ts, FE TrialRunsPage.tsx), scopes Head Trainer training plans, workouts, and trial runs to current user, enforces fail-closed cross-trainer mutations, filters Trial Runs actionable simulation rows, and expands date filter to make created trials immediately visible. Blocker is removed; execution returns to IDLE; TASK-016 requires a new direct START TASK-016. TASK-017 remains unauthorized.
- CR-022 was approved on 2026-10-28 and incorporated into v1-approved-r21: expands TASK-016 scope to exactly 7 application/test files (authorizing simulator.service.spec.ts and simulator.gateway.spec.ts), requires conditional atomic abort transitions only from PENDING/RUNNING, guarantees single persisted terminal outcome / broadcast, defines 5m absolute running watchdog starting at 1st tick, clears timers on finish/abort/reconnect/teardown, and requires 7 fake-clock/concurrency tests. Blocker is removed; execution returns to IDLE; TASK-016 requires a new direct START TASK-016. TASK-017 remains unauthorized.
- CR-021 was approved on 2026-10-28 and incorporated into v1-approved-r20: Simulator areas are simulation functions, not Main-Web personas. Direct canonical Simulator access loads the complete real horse/stall catalogue without login or role filtering. No CM/Groom inspection endpoint/UI, enum or migration is added. Backend-issued session binding remains mandatory only for authoritative write-back in TASK-016–018. TASK-015 returns to TODO and needs a new exact START.
- CR-020 was approved on 2026-10-28 and incorporated into v1-approved-r19: TASK-014 now owns exactly three root scripts. `setup-db.bat` resets/seeds local PostgreSQL, `start.bat` opens one four-tab real-stack terminal and waits for real health, and `stop.bat` may force-stop EquiFlow ports/container but must verify shutdown. The previous TASK-014 QA handoff is superseded; execution is IDLE and requires a new direct `START TASK-014`.
- CR-019 was approved on 2026-10-27 and incorporated into v1-approved-r18: keep the scheduled-time guard but expose its reason; refresh and identify the existing Simulator result draft on initial load/focus/manual retry; derive only defensible completion state and never fabricate recovery HR, score or trainer comments. Slice H passed 16/16 real-stack browser checks. TASK-013 is DONE and approved by `APPROVE TASK-013` on 2026-10-27 (superseding typo `APPROVE TASK-013v`). Known accepted limitation: after Head Trainer edits imported result fields, the Simulator reload button is disabled until page reload or edits discarded. Execution is IDLE; TASK-014 remains unauthorized.
- CR-018 approved on 2026-10-27 and incorporated into v1-approved-r17: decouple chart sampling from the real-time Socket.IO ticker so 60× remains playback acceleration while preserving a readable simulation-time curve; make the Trial Runs scheduling action open a TRIAL-preselected workflow; and authorize Codex to replace AGY as executor for this TASK-013 continuation only after direct `START TASK-013 CODEX`. Medical QA is provisionally accepted but remains a regression gate. TASK-014 remains unauthorized.
- CR-017 approved on 2026-10-27 and incorporated into v1-approved-r16. TASK-013 gains corrective Slice F with five exact additional files, terminal-session relaunch rejection, truthful unavailable EXAM weight, medical-record horse name/code mapping and deterministic idempotent `QA T013` fixtures. Execution is IDLE and still requires a new direct `START TASK-013`; TASK-014 remains unauthorized.
- CR-016 approved on 2026-10-27 and incorporated into v1-approved-r15 after human manual QA rejected TASK-013. Slice E requires deterministic workout completion, immutable prescribed workout configuration, no unprescribed obstacle controls, streamlined EXAM return/auto-load UX and unambiguous vital-range labels. Execution is IDLE; TASK-013 requires a new direct start. TASK-014 remains unauthorized.
- CR-015 approved on 2026-10-27 and incorporated into v1-approved-r14 after real Chromium QA rejected TASK-013. Corrective Slices C/D require PostgreSQL-backed horse master data, a complete Vet EXAM finish/result path, an eligible QA trial and real-stack browser acceptance. Execution is IDLE; a new direct `START TASK-013` is required. TASK-014 remains unauthorized.
- CR-014 approved on 2026-10-26 and incorporated into v1-approved-r13. TASK-013 is now a two-slice session-bound no-login cutover for the canonical v3 Simulator; `.bat` work remains isolated in unauthorized TASK-014. TASK-012 is DONE and human-approved on 2026-10-26. Execution is IDLE; TASK-013 is unauthorized.
- CR-013 approved on 2026-10-26 and incorporated into v1-approved-r12. TASK-020 is an additive local-only manual-QA dataset checkpoint with exactly two Backend tooling files; it requires its own `START TASK-020`, and TASK-012 remains unauthorized until TASK-020 is complete and separately approved.
- CR-012 approved on 2026-10-25 and incorporated into v1-approved-r11. TASK-010 remains one task with two sequential slices (Slice A: existing 5 files; Slice B: 5 corrective files: `AuditLogPage.tsx`, `Dockerfile`, `vite-env.d.ts`, `ci.yml`, `FE/AGENTS.md`), combined real-stack acceptance, real-only CI build, and exact-ID transactional cleanup. TASK-010 is DONE and human-approved.
- CR-011 approved on 2026-10-25 following human rejection of TASK-007. It expands TASK-007 to exactly 7 application/test files and requires query-level Horse Owner race-data isolation without foreign owner PII.
- Plan v1 was explicitly approved on 2026-10-24; CR-005 through CR-021 are incorporated into v1-approved-r20.
- TASK-001 baseline is BE `86d9bf0` and FE `4a73709`; canonical Simulator is clean.
- Current repository statuses before CR-013 documentation edits: Backend is ahead of origin/main by 11 commits (HEAD `dac87eb`); Frontend is ahead of origin/main by 9 commits (HEAD `844e50d`); canonical Simulator branch `refactor/remove-rfid-standardize-microchip` is ahead of its upstream by 1 commit (HEAD `3f52a7a`). All three were clean; only canonical CR-013 documentation is now modified in Backend. Push remains separately gated.

TASK-001 evidence is recorded in `reports/TASK-001.md`. TASK-002 through TASK-015 and TASK-020 are DONE with their canonical reports. TASK-014 root scripts are accepted as local-only and are intentionally not Git-deliverable. Execution is IDLE; commit/push and TASK-016 remain unauthorized until a new exact `START TASK-016`.
