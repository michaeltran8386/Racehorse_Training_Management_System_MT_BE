# Canonical Workflow State

| Field | Value |
| --- | --- |
| plan_version | v1-approved-r18 |
| plan_status | APPROVED |
| active_task | NONE |
| active_task_status | IDLE |
| planned_first_task | TASK-001 |
| next_task | TASK-014 (TODO — unauthorized; awaiting START TASK-014) |
| pending_change | NONE |
| last_approved_task | TASK-013 |
| last_approval_reference | APPROVE TASK-013 (2026-10-27), superseding typo APPROVE TASK-013v |
| last_plan_approval_reference | APPROVE CR-019 (2026-10-27), amending APPROVE PLAN v1 |
| blockers | NONE |

Plan v1 and CR-005 through CR-019 are approved and incorporated into v1-approved-r18. TASK-001 through TASK-013 and TASK-020 are DONE and human-approved. TASK-013 was approved by the user (`APPROVE TASK-013`, superseding typo `APPROVE TASK-013v`). Known accepted limitation recorded: after Head Trainer edits imported result fields, the Simulator reload button is disabled until page reload or edits discarded. Execution is IDLE. TASK-014 remains unauthorized until explicit human command `START TASK-014`.

Allowed task statuses: `TODO`, `IN_PROGRESS`, `AWAITING_USER_QA`, `BLOCKED`, `DONE`; the active execution gate may additionally be `IDLE` when no task is running.
