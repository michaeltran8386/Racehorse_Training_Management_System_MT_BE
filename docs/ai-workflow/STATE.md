# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r13 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-013 |
| pending_change | NONE |
| last_approved_task | TASK-012 |
| last_approval_reference | APPROVE TASK-012 (2026-10-26) |
| last_plan_approval_reference | APPROVE CR-014 (2026-10-26), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-014 are approved and incorporated into v1-approved-r13. TASK-001 through TASK-012 and TASK-020 are DONE and human-approved. Execution is IDLE; next_task is TASK-013 (unauthorized). Do not start TASK-013 without an explicit START TASK-013 command.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
