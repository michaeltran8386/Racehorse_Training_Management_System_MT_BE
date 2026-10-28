# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r20 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-016 |
| pending_change | NONE |
| last_approved_task | TASK-015 |
| last_approval_reference | APPROVE TASK-015 (2026-10-28) |
| last_plan_approval_reference | APPROVE CR-021 (2026-10-28), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-021 are approved and incorporated into v1-approved-r20. TASK-001 through TASK-015 and TASK-020 are DONE and human-approved. Execution is IDLE; TASK-016 requires a new direct `START TASK-016`.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
