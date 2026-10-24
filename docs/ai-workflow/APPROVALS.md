# Human Approval Ledger (append-only)

> **No prefilled approvals.** Only append after the human actually sends the command, identifying the session context and approval target. Do not treat this file as a replacement for the current-session `START` command.

| Date/time (timezone) | Human command | Plan version / Task / CR | Recorded by | Source context |
| --- | --- | --- | --- | --- |
| 2026-10-23 (Asia/Bangkok) | `APPROVE CR-001` | CR-001 / Plan v1-draft-r3 | ChatGPT Planner | Current Codex conversation; approves the final incident audience, Vet acknowledgement and 3-hour reminder proposal only |
| 2026-10-23 (Asia/Bangkok) | `APPROVE CR-003` | CR-003 / Plan v1-draft-r3 | ChatGPT Planner | Current Codex conversation; approves Backend repository as canonical workflow home only |
| 2026-10-23 (Asia/Bangkok) | `APPROVE_PLAN` & `START TASK-001` | Plan v1-draft-r3 / TASK-001 | AGY Executor | User edited STATE.md to APPROVE_PLAN and issued START TASK-001 in current session |
| 2026-10-24 05:51 (Asia/Bangkok) | `APPROVE TASK-001` | TASK-001 | AGY Executor | User explicit message "APPROVE TASK-001" in current session |
| 2026-10-24 (Asia/Bangkok) | `APPROVE CR-005` | CR-005 / Plan v1-draft-r4 / TASK-002 revision | ChatGPT Planner | Current Codex conversation; approves the `editHorses` ownership correction and TASK-002 boundary clarification only; not whole-Plan approval |
| 2026-10-24 (Asia/Bangkok) | `APPROVE PLAN v1` | Plan v1-approved-r4 | ChatGPT Planner | Current Codex conversation; explicit whole-Plan approval after CR-005 incorporation; does not authorize commit/push or START TASK-002 |
| 2026-10-24 06:55 (Asia/Bangkok) | `START TASK-002` | TASK-002 | AGY Executor | User explicit message "START TASK-002" in current session |
| 2026-10-24 07:25 (Asia/Bangkok) | `REJECT TASK-002` | TASK-002 | AGY Executor | User explicit message requesting direct Backend HTTP 403 evidence for 5 horse master mutation endpoints and DB verification |
| 2026-10-24 07:52 (Asia/Bangkok) | `APPROVE TASK-002` | TASK-002 | AGY Executor | User explicit message "APPROVE TASK-002" in current session |

