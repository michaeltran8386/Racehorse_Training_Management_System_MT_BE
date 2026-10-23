# Change Requests (append-only)

## CR-001 — Incident audience và chu kỳ nhắc 3 giờ
- **State:** INCORPORATED
- **Raised by:** Human, 2026-10-23
- **Related plan:** v1-draft-r2 / TASK-009, TASK-010
- **Current invariant:** `RULE-MED-02/03` yêu cầu sự cố nghiêm trọng báo ngay Vet, Head Trainer, Groom, Horse Owner và Club Manager.
- **Requested change:** Vet chịu trách nhiệm chính; sự cố báo Groom, Vet, Horse Owner; sau mỗi 3 giờ gửi lại nếu chưa ai “nhận được thông tin”.
- **Conflict:** bỏ Head Trainer/Club Manager khỏi catastrophic alert làm yếu hard invariant; “nhận được” chưa rõ là tạo notification, đọc, hay Vet acknowledge.
- **Final proposal for approval:**
  1. `CRITICAL`/catastrophic: thông báo ngay đủ 5 nhóm theo RULE-MED-02 — Veterinarian, Head Trainer, assigned Groom, Horse Owner và Club Manager.
  2. `MILD`/`MODERATE`: thông báo Veterinarian, assigned Groom và Horse Owner; không gửi đại trà cho HT/CM.
  3. “Đã nhận xử lý” là Vet chuyển incident từ `REPORTED` sang `UNDER_REVIEW`. `readAt` của notification không được xem là clinical acknowledgement.
  4. Scheduler nhắc lại mỗi 3 giờ khi incident vẫn `REPORTED` và `reviewedAt` còn null; dừng ngay sau Vet acknowledgement hoặc khi incident kết thúc.
  5. Dedupe bằng khóa `INCIDENT_REMINDER:{incidentId}:{threeHourRound}:{recipientId}` qua `Notification.dedupeKey`; không cần field/schema mới theo code hiện tại.
  6. Chỉ Vet được thực hiện clinical review/acknowledgement. Club Manager được xem/audit; không thay Vet xác nhận lâm sàng.
  7. Incident không tự tạo MedicalRecord hoặc MedicalLock; chỉ Vet thực hiện bằng thao tác riêng.
- **Why this resolves the conflict:** giữ nguyên hard invariant cho sự cố nghiêm trọng, đồng thời áp dụng đúng audience ba nhóm và chu kỳ 3 giờ cho sự cố thông thường.
- **Impact:** incident review guard, notification routing, scheduler, dedupe tests, FE status action và E2E; dự kiến không cần Prisma migration.
- **Human decision:** 2026-10-23 — `APPROVE CR-001`.
- **Resolution:** approved proposal incorporated into Plan v1-draft-r3 and TASK-009/TASK-010; task execution remains unauthorized.
- **Target plan version:** v1-draft-r3.

## CR-002 — Groom sửa Supply Catalog
- **State:** RESOLVED_NO_CHANGE
- **Raised by:** Human, 2026-10-23
- **Related plan:** v1-draft-r2 / TASK-006
- **Current behavior:** `supplies.controller.ts` chỉ Club Manager create/update/toggle; staff được xem. Review/deliver/adjust inventory chỉ Club Manager.
- **Conflict:** yêu cầu viết “chỉ Groom được thêm/sửa Supply Catalog” rồi ngay sau đó “chỉ Club Manager quản lý catalog và phê duyệt”. Hai authority duy nhất không thể cùng đúng.
- **Alternatives:**
  - **A (recommended):** Groom chỉ xem catalog/tồn kho và tạo request; Club Manager create/update/toggle catalog, adjust inventory, review/deliver.
  - **B:** Groom create/update catalog nhưng không toggle active, adjust inventory, review/deliver; Club Manager giữ toàn quyền và approval.
- **Impact nếu B:** đổi RBAC BE/FE, audit, permission vocabulary, controller/service tests và E2E.
- **Human decision:** 2026-10-23 — chọn phương án A: “KHÔNG, Chỉ có mỗi Club Manager được quyền kiểm soát, Groom chỉ view và gửi yêu cầu nếu thấy thiếu.”
- **Resolution:** giữ authority hiện hành của SRS/code; không mở quyền catalog cho Groom. Incorporated into Plan v1-draft-r2.
- **Target plan version:** v1-draft-r2.

## CR-003 — Vị trí Git cho workflow liên-repo
- **State:** INCORPORATED
- **Raised by:** ChatGPT, 2026-10-23
- **Related plan:** v1-draft-r2 / B-001
- **Current behavior:** root chứa workflow/start/stop nhưng không phải Git repo; BE/FE/SIM là ba repo độc lập.
- **Desired outcome:** ChatGPT và AGY chia sẻ handoff qua Git.
- **Final proposal for approval:**
  1. Dùng `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/` làm **canonical tracked coordination home** vì Backend đã có Git remote và là system of record.
  2. Sau approval, copy nguyên bộ workflow hiện tại vào vị trí canonical; cập nhật root `AGENTS.md` và BE `AGENTS.md` trỏ tới vị trí này.
  3. Root `docs/ai-workflow/` chỉ giữ vai trò local mirror trong giai đoạn chuyển tiếp và phải ghi rõ `NON-CANONICAL`; không dùng để suy ra approval/state.
  4. Mọi thay đổi workflow sau đó được ghi ở bản canonical trước. Không tạo Git repo lồng ở root, không dùng submodule và không tạo remote mới.
  5. Không push trong bước chuyển; commit/push vẫn cần quyền riêng theo Human Gate.
- **Why this resolves the blocker:** dùng ngay remote đã tồn tại, tạo một nguồn Git authoritative duy nhất và tránh meta-repo/nested-repo phức tạp.
- **Impact:** thêm tài liệu workflow vào BE repo, cập nhật pointer/rules; không thay application runtime.
- **Human decision:** 2026-10-23 — `APPROVE CR-003`.
- **Resolution:** Backend workflow home established as canonical; root workflow becomes a non-authoritative mirror. Commit/push remains separately gated.
- **Target plan version:** v1-draft-r3.

## CR-004 — Sắp xếp WEB → SIM → ĐỒNG BỘ và loại phần workflow của SRS
- **State:** INCORPORATED_BY_HUMAN_DIRECTION
- **Raised by:** Human, 2026-10-23
- **Related plan:** v1-draft-r2
- **Original plan:** canonicalize Simulator trước, sau đó hoàn thiện Web và integration; dùng `srsv4.txt` nói chung trong source hierarchy.
- **Requested change:** sắp xếp task theo WEB → SIM → ĐỒNG BỘ; đọc `srsv4.txt` nhưng loại phần workflow.
- **Interpretation applied:** dùng phần 1, 2, 4, 5, 6, 7; loại toàn bộ phần 3 “CÁC LUỒNG NGHIỆP VỤ CỦA HỆ THỐNG”.
- **Impact:** renumber/reorder 19 task; cập nhật dependencies, checkpoints, HANDOFF, STATE, PROGRESS và ADR mapping. Không đổi application code.
- **Human decision:** Explicit direction in current conversation; incorporated into draft, not a Plan approval.
- **Target plan version:** v1-draft-r2.

## CR-005 — Khóa `editHorses` theo Club Manager và làm rõ TASK-002
- **State:** INCORPORATED
- **Raised by:** Independent Claude final review, verified by ChatGPT Planner, 2026-10-24
- **Related plan:** v1-draft-r3 / corrective follow-up to TASK-001 / TASK-002
- **Verified gap:** `editHorses` has no `ownerRoles` in either BE `src/users/permissions.ts` or FE `src/shared/lib/permissions.ts`. A stored or newly submitted `editHorses: true` value can therefore survive normalization for Head Trainer. FE may show horse-master mutation controls while BE horse endpoints still reject them through `@Roles(CLUB_MANAGER)`.
- **Data impact:** no destructive migration is required. Once `ownerRoles: [CLUB_MANAGER]` is present, existing stored non-CM values are forced to `false` by `normalizePermissions` when read or updated; raw JSON may remain unchanged until a later account update but is not exposed as authority.
- **Minimal proposal for approval:**
  1. Keep TASK-001 and its historical approval `DONE`; do not delete or rewrite the approval ledger.
  2. Before TASK-002 can start, establish a clean Git baseline for the approved TASK-001 changes and canonical workflow documents.
  3. Revise TASK-002 to add `ownerRoles: [CLUB_MANAGER]` for `editHorses` in FE and BE and add focused regression tests proving a Head Trainer cannot receive this permission from stored or submitted data.
  4. Clarify TASK-002 acceptance: Head Trainer must receive 403 and see no controls for horse master-record create/edit/transfer/delete/restore. This does not remove operational status transitions explicitly allowed by `horse-rules.ts`; Vet remains limited to approved medical transitions.
  5. Treat mock permission-parity improvements, dead CM alert UI and comments about `SEED_VERSION` as optional follow-ups unless a focused TASK-002 test proves they are required for its acceptance criteria.
  6. Record the two previously out-of-scope TASK-001 files as human-accepted corrective QA changes; do not retroactively change the original task specification.
- **Expected implementation scope after approval:** BE `src/users/permissions.ts`, `src/users/permissions.spec.ts`; FE `src/shared/lib/permissions.ts`, `tests/e2e/rbac-matrix.spec.ts`. TASK-002's horse lifecycle files remain subject to its existing objective and must be revalidated at START; if total verified scope exceeds five files, AGY must block and request a split rather than expand silently.
- **Acceptance additions:** non-CM stored/submitted `editHorses: true` normalizes to false in FE and BE; Club Manager can retain the permission; HT horse-master controls remain hidden; Backend continues to return 403 for HT master mutations; permitted HT operational status transitions are not regressed.
- **Tests:** focused BE permission tests; FE RBAC mock test; existing TASK-002 horse authorization tests; typecheck/lint for touched repositories.
- **Risk if rejected:** TASK-001 defaults remain correct, but a custom/stale permission map can recreate FE/BE authorization drift for Head Trainer.
- **Human decision:** 2026-10-24 — `APPROVE CR-005`.
- **Resolution:** incorporated into Plan v1-draft-r4 and TASK-002. TASK-001 remains DONE; no whole-Plan approval, application change or TASK-002 START was authorized by this command.
- **Target plan version:** v1-draft-r4.

Workflow: `PROPOSED -> IMPACT_ASSESSED -> AWAITING_APPROVAL -> APPROVED/REJECTED -> INCORPORATED`.
AGY may append proposal and stop but must not rewrite approved Plan or implement out-of-scope changes.

