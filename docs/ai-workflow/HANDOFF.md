# Current Handoff to AGY

## Gate state

- **Plan:** v1-approved-r4 — explicitly approved by `APPROVE PLAN v1` on 2026-10-24; CR-005 incorporated.
- **Last completed task:** TASK-001 — DONE and human-approved on 2026-10-24.
- **Next authorized task:** NONE.
- **Active task:** NONE.
- **Pending design change:** NONE.
- **Operational blocker:** TASK-001 application/workflow changes do not yet have a clean Git baseline.
- **Do now:** Do not start or prepare TASK-002. Do not alter TASK-001 approval history.

## Incorporated CR-005

TASK-002 now includes the minimal permission correction:

- FE and BE must declare `editHorses` as Club-Manager-only through `ownerRoles`.
- Stored/submitted `editHorses: true` for non-CM roles must normalize to `false`.
- HT is prohibited from master-record create/edit/transfer/delete/restore but retains operational status transitions explicitly permitted by `horse-rules.ts`.
- Vet remains limited to approved medical transitions.
- Expected changed files are the four permission contract/test files in `TASKS.md`; horse/lifecycle/UI paths are verification-only unless a failing test proves a separately approved source change is required.

Plan/CR approval did not authorize code changes or start TASK-002.

## Required next actions

Establish a reviewed Git baseline for TASK-001 and canonical workflow documents using a separate commit authorization, or have the human commit them. Push remains a separate authorization.

After the baseline is clean, ChatGPT must verify it and update `STATE.md`/`HANDOFF.md` to `next_task: TASK-002`. The human must then separately send:

```text
START TASK-002
```

in the current AGY conversation. No other wording or prior approval starts the task.
