# Task Verification Reports

Create `TASK-001.md`, `TASK-002.md`, etc., only when executed.

Report template:

```markdown
# TASK-XXX — Execution Report
- **Plan version:**
- **Status:** AWAITING_USER_QA / BLOCKED
- **Git branch / starting revision / ending revision:**
- **Pre-existing dirty working tree changes:**
- **Files changed and why:**
- **Implementation summary:**
- **Acceptance criteria:** checked / not checked with evidence
- **Tests actually run:** command, exit status, summary/result
- **Tests NOT run:** reason and risk
- **Regression concerns:**
- **Manual QA:** numbered exact actions, inputs, expected result
- **Known issues / CR:**
- **User feedback:**
- **STOP marker:** Await human APPROVE TASK-XXX or REJECT TASK-XXX
```

