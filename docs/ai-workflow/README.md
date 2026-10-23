# AI Workflow — Shared Repository Handoff

**Planner:** ChatGPT (analysis, approved design and task specifications only)  
**Executor:** Google Antigravity IDE (one task, code, verification and report)  
**Approver:** Human project owner

## Start here
1. ChatGPT inspects codebase and creates draft `PLAN.md`, `TASKS.md`, `DECISIONS.md` and `HANDOFF.md`.
2. Human replies `APPROVE PLAN v1` to ChatGPT. ChatGPT records this in `APPROVALS.md` and sets `STATE.md` to `APPROVED` with `next_task: TASK-001`.
3. Human tells AGY `START TASK-001`. AGY reads all the files and implements **only** that task.
4. AGY runs tests, writes `reports/TASK-001.md`, sets `AWAITING_USER_QA`, and stops.
5. Human manually tests, then replies `APPROVE TASK-001` or `REJECT TASK-001: reason` to AGY.
6. On approval, AGY marks DONE and **stops**. Human must separately say `START TASK-002`.

## Files
- `PLAN.md`: only the currently approved plan or clearly labeled draft before approval.
- `TASKS.md`: tasks and verifiable acceptance criteria, with execution status.
- `DECISIONS.md`: architectural decisions, evidence and trade-offs.
- `CHANGES.md`: append-only change requests, impacts and approval decisions.
- `STATE.md`: current plan version, gate state, active/next task and blocker.
- `HANDOFF.md`: small, up-to-date entrypoint for the next authorized task.
- `APPROVALS.md`: explicit human approvals with dates/context; never fabrications.
- `PROGRESS.md`: concise plan/task progress summary; it never grants execution authority.
- `reports/TASK-XXX.md`: actual test evidence and reproducible manual QA.

## Ownership and concurrency
ChatGPT updates plans/specifications; AGY updates code, execution statuses and reports. Both may record human approvals received in their own conversation and append change requests. Do not edit the same file concurrently. If each agent has a different clone, synchronize via Git explicitly; do not claim files are synchronized merely because they share the remote repository.

## Scope change protocol
AGY records `CR-XXX` and blocks work. ChatGPT proposes a diff and impact to plan/tasks and awaits `APPROVE CR-XXX`. Only upon acceptance does ChatGPT bump plan version and update the handoff. AGY must receive a **new** `START TASK-XXX` to proceed.

## Safety
Do not run destructive database migrations, deployment, `git push`, `git merge`, secrets operations or other high-risk actions without separate approval. Review Git diffs; do not overwrite local changes. Plan-approval and task-approval are independent of IDE tool permissions.

