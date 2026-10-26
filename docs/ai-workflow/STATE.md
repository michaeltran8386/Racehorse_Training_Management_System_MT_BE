# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r11 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-011 |
| pending_change | NONE |
| last_approved_task | TASK-010 |
| last_approval_reference | APPROVE TASK-010 (2026-10-26) |
| last_plan_approval_reference | APPROVE CR-012 (2026-10-25), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-012 are approved and incorporated into v1-approved-r11. TASK-001 through TASK-010 are DONE and human-approved. Execution is IDLE awaiting explicit authorization or start for the next eligible task (TASK-011).

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
