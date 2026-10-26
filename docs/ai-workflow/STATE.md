# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r12 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-012 |
| pending_change | NONE |
| last_approved_task | TASK-020 |
| last_approval_reference | APPROVE TASK-020 (2026-10-26) |
| last_plan_approval_reference | APPROVE CR-013 (2026-10-26), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-013 are approved and incorporated into v1-approved-r12. TASK-001 through TASK-011 and TASK-020 are DONE and human-approved. Execution is IDLE; next_task is TASK-012 awaiting explicit human START TASK-012 command.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
