# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r22 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-017 |
| pending_change | NONE |
| last_approved_task | TASK-016 |
| last_approval_reference | APPROVE TASK-016 (2026-10-28) |
| last_plan_approval_reference | APPROVE CR-023 (2026-10-28), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-023 are approved and incorporated into v1-approved-r22. TASK-001 through TASK-016 and TASK-020 are DONE and human-approved. Execution is IDLE. Next task is TASK-017 (unauthorized); awaits explicit human command START TASK-017.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
