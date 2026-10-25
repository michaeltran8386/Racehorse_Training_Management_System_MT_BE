# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r10 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-008 |
| pending_change | NONE |
| last_approved_task | TASK-007 |
| last_approval_reference | APPROVE TASK-007 (2026-10-25) |
| last_plan_approval_reference | APPROVE CR-011 (2026-10-25), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-011 are approved and incorporated into v1-approved-r10. TASK-001 through TASK-007 are DONE and human-approved. Next task is TASK-008, awaiting explicit human START TASK-008 command.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
