# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r9 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-004 |
| pending_change | NONE |
| last_approved_task | TASK-003 |
| last_approval_reference | APPROVE TASK-003 (2026-10-24) |
| last_plan_approval_reference | APPROVE PLAN v1 (2026-10-24) |
| blockers | NONE |

Plan v1 and CR-005 through CR-010 are approved and incorporated into v1-approved-r9. TASK-001, TASK-002, and TASK-003 are DONE. TASK-003 was approved by human QA after verifying that result upserts, tournament status, horse statuses and financial credits were committed in one transaction; audit and notification were recorded after the transaction. Next task is TASK-004; awaiting explicit human START TASK-004.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
