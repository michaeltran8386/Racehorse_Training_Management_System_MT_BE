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

## CR-006 — Chuẩn hóa ma trận chuyển trạng thái giải đua (Tournament Status Transition Allow-list)
- **State:** INCORPORATED
- **Raised by:** Independent Reviewer / Human Feedback on TASK-003, 2026-10-24
- **Related plan:** v1-draft-r4 / TASK-003
- **Current behavior:** `tournaments.service.ts` và mock trước đây sử dụng danh sách cấm (deny-list) cục bộ, chỉ chặn chuyển từ/sang `COMPLETED` và mở giải khi quá deadline. Chưa có spec cụ thể xác định các trạng thái hợp lệ, dẫn đến việc giải đã hủy (`CANCELLED`) có thể chuyển ngược về `UPCOMING`, giải `UPCOMING` nhảy thẳng sang `CLOSED`, hoặc giải đã `CANCELLED` vẫn có thể bị ghi kết quả và khóa kết quả thành `COMPLETED`. Ngoài ra `POST /tournaments` và `PATCH /tournaments/:id` cho phép gán trực tiếp status `COMPLETED`.
- **Final proposal for approval (Planner revision):**
  1. Thay thế deny-list bằng allow-list chuyển trạng thái nghiêm ngặt (`ALLOWED_TRANSITIONS`):
     - `UPCOMING` -> `OPEN_REGISTRATION` (nếu chưa quá hạn đăng ký), `CANCELLED`
     - `OPEN_REGISTRATION` -> `CLOSED_REGISTRATION`, `CANCELLED`
     - `CLOSED_REGISTRATION` -> `CANCELLED`; không mở lại đăng ký. `COMPLETED` chỉ đạt được qua `lockResults` sau khi đủ kết quả, không qua API đổi trạng thái chung.
     - `CANCELLED` -> `[]` (trạng thái cuối cùng; giữ nguyên lịch sử/audit, muốn tổ chức lại phải tạo giải mới)
     - `COMPLETED` -> [] (trạng thái cuối cùng, bất biến)
  2. Cấm tạo mới giải (`POST /tournaments`) trực tiếp ở trạng thái `COMPLETED`, `CANCELLED`, hoặc `CLOSED_REGISTRATION`.
  3. Cấm cập nhật thông tin chung (`PATCH /tournaments/:id`) trực tiếp sang `COMPLETED`, và nếu có field `status` thì phải tuân thủ nghiêm ngặt allow-list như `changeStatus`.
  4. Cấm `recordResults` và `lockResults` trên giải có trạng thái `CANCELLED` hoặc `COMPLETED`.
  5. Đồng bộ toàn bộ quy tắc trên vào Mock Service Worker (`handlers.ts`) và Frontend UI buttons.
- **Human clarification / Planner assessment:** Human quyết định ngày 2026-10-24 rằng một giải đã đóng không được mở đăng ký lại. `CLOSED_REGISTRATION -> OPEN_REGISTRATION` phải bị loại bỏ; giải đã đóng chỉ có thể bị hủy hoặc được hoàn tất qua quy trình ghi/khóa kết quả. `PLAN.md` xác định `CANCELLED` là hủy nhưng giữ lịch sử/audit, nên `CANCELLED` là terminal. Cả nút `Mở lại đăng ký`, nút `Mở lại giải` và hai transition reopen tương ứng phải bị loại bỏ.
- **Required review correction independent of CR scope:** không expose `handleMock` qua `window.__handleMock` trong application runtime. Test phải dùng UI hoặc request path hiện có; nếu chỉ gọi trực tiếp mock handler thì phải mô tả là mock-handler evidence, không phải HTTP evidence.
- **Why this resolves the issue:** Ngăn chặn hoàn toàn việc bypass quy trình chốt kết quả và bảo toàn tính toàn vẹn trạng thái vòng đời của giải đua.
- **Impact:** Backend `tournaments.service.ts`, `tournaments.service.spec.ts`; Frontend `handlers.ts`, `RaceEntryPage.tsx`, `tournaments.spec.ts`.
- **Target plan version:** v1-approved-r5 / TASK-003.
- **Human decision:** 2026-10-24 — `APPROVE CR-006`.
- **Resolution:** incorporated into Plan v1-approved-r5 and the revised TASK-003 specification. This approval does not resume implementation; a new direct `START TASK-003` is required.

## CR-007 — Sửa luồng gọi kép khi khóa kết quả giải đua trong RecordResultsModal.tsx
- **State:** INCORPORATED
- **Raised by:** Independent Reviewer / Human QA on TASK-003, 2026-10-24
- **Related plan:** v1-approved-r5 / TASK-003
- **Current behavior:** Tại `Racehorse_Training_Management_System_MT_FE/src/features/racing/components/RecordResultsModal.tsx:139-142`, hàm submit thực hiện liên tiếp 2 lời gọi:
  ```ts
  await recordRaceResults(tournament.id, resultsPayload, lock);
  if (lock) {
    await lockRaceResults(tournament.id);
  }
  ```
  Khi người dùng (Club Manager) nhấn "Lock Official Results" (`lock === true`):
  1. Lời gọi đầu tiên `recordRaceResults(..., true)` gửi `POST /tournaments/:id/results` kèm `lockResults: true`. Cả Backend (`tournaments.service.ts`) lẫn Mock (`handlers.ts`) đã thực hiện khóa giải và chuyển trạng thái sang `COMPLETED`.
  2. Lời gọi thứ hai `lockRaceResults(tournament.id)` gửi `POST /tournaments/:id/lock-results`. Do giải đã ở trạng thái `COMPLETED`, endpoint trả về HTTP 400 `ALREADY_COMPLETED` (hoặc `CANNOT_CHANGE_COMPLETED`).
  - **Hệ quả:** Thao tác khóa kết quả bị catch error ở client, hiển thị thông báo lỗi "already locked" hoặc "completed", modal không tự đóng mặc dù dữ liệu giải đã được chuyển sang `COMPLETED`.
- **Conflict / Scope Constraint:** File `RecordResultsModal.tsx` nằm ngoài danh sách 5 file được phê duyệt cho TASK-003. Sửa file này sẽ vi phạm quy tắc Human Gate (tối đa 5 file, không tự ý sửa out-of-scope files).
- **Planner assessment:** Finding là hợp lệ và là lỗi hồi quy chức năng: request đầu đã commit việc lưu/khóa kết quả, request thứ hai thất bại khiến UI báo lỗi dù server đã hoàn tất. Đây không phải thay đổi nghiệp vụ mới; nó là sửa client để dùng đúng contract `/results` hiện hành. Không cần sửa Backend, schema hay endpoint.
- **Final proposal for approval:**
  1. Phê duyệt mở rộng phạm vi TASK-003 bao gồm file `Racehorse_Training_Management_System_MT_FE/src/features/racing/components/RecordResultsModal.tsx`.
  2. Chọn **Phương án A**: giữ duy nhất `recordRaceResults(tournament.id, resultsPayload, lock)`; xóa lời gọi `lockRaceResults` sau đó và xóa import không còn sử dụng. Không thay đổi API contract hoặc Backend.
  3. Bổ sung kịch bản Playwright E2E cho Club Manager thực hiện quy trình khóa kết quả chính thức và kiểm tra modal đóng thành công, giải chuyển sang tab Completed.
- **Impact:** Frontend `RecordResultsModal.tsx`, `tournaments.spec.ts`.
- **Acceptance criteria:** mỗi lần submit chỉ phát sinh một request ghi/khóa; Save Draft vẫn lưu nhưng không chuyển `COMPLETED`; Lock Official Results lưu đầy đủ kết quả, đóng modal không báo lỗi và đưa giải sang `COMPLETED`; Head Trainer không thể khóa; không hồi quy 30 test hiện có.
- **Automated verification:** Playwright phải assert nút khóa hiện hữu, thực sự click/submit và quan sát modal đóng cùng trạng thái Completed; chạy lại `tournaments.spec.ts`, `rbac-matrix.spec.ts`, FE typecheck, lint và build. Backend 34 test hiện có phải tiếp tục pass nếu AGY chạy lại full TASK-003 verification.
- **Manual QA:** Club Manager khóa một giải đủ kết quả đúng một lần; xác nhận không có toast lỗi và không còn request `/lock-results` từ modal. Kiểm tra Save Draft riêng. Head Trainer chỉ lưu nháp và không thấy/không dùng được hành động khóa.
- **Rollback:** hoàn tác riêng thay đổi tại `RecordResultsModal.tsx` và case Playwright bổ sung; không có migration hay dữ liệu cần rollback.
- **Risk:** thấp; `lockRaceResults` export vẫn được giữ để tránh thay đổi ngoài phạm vi, dù hiện không còn caller UI. Dữ liệu live test do TASK-003 tạo phải được ghi nhận, không xóa trực tiếp DB để né audit.
- **Approval command received:** `APPROVE CR-007`.
- **Human decision:** 2026-10-24 — `APPROVE CR-007`.
- **Resolution:** incorporated into Plan v1-approved-r6 and revised TASK-003 scope. Approval does not resume implementation; AGY still requires a new direct `START TASK-003`.
- **Target plan version:** v1-approved-r6 / TASK-003.

Workflow: `PROPOSED -> IMPACT_ASSESSED -> AWAITING_APPROVAL -> APPROVED/REJECTED -> INCORPORATED`.
AGY may append proposal and stop but must not rewrite approved Plan or implement out-of-scope changes.

## CR-008 — Chỉ Club Manager được ghi, sửa và khóa kết quả giải đua
- **State:** INCORPORATED
- **Raised by:** Human clarification, 2026-10-24
- **Related plan:** v1-approved-r6 / TASK-003 and TASK-004
- **Human authority clarification:** Head Trainer chỉ được xem điều kiện, đăng ký ngựa và rút/scratch ngựa khỏi giải. Toàn bộ xử lý giải — gồm tạo/sửa/xóa hoặc hủy, chuyển trạng thái, ghi/sửa kết quả và khóa kết quả — chỉ Club Manager được thực hiện.
- **Verified conflict:**
  1. Backend `tournaments.controller.ts` cho cả `HEAD_TRAINER` và `CLUB_MANAGER` gọi `POST /tournaments/:id/results`.
  2. Backend `tournaments.service.ts` chỉ cấm HT khi `lockResults: true`, nên HT vẫn ghi kết quả nháp và audit khi `lockResults: false`.
  3. Mock `handlers.ts`, `RaceEntryPage.tsx`, `RecordResultsModal.tsx` và `tournaments.spec.ts` mô hình hóa cùng quyền draft sai này.
  4. Plan actor matrix, TASK-003 và TASK-004 hiện cũng ghi HT được nhập/record results.
- **Final proposal for approval:**
  1. Giữ quyền Head Trainer: xem danh sách/chi tiết/kết quả đã công bố, xem eligibility, đăng ký ngựa và rút/scratch ngựa.
  2. Đổi `POST /tournaments/:id/results` thành Club Manager only tại controller, service và mock. Service phải từ chối non-CM trước mọi result upsert, audit, status change hoặc prize allocation.
  3. FE chỉ hiển thị hành động `Record Results` cho Club Manager. Head Trainer không được mở modal nhập kết quả hoặc thấy `Save Draft`/`Lock Official Results`; HT vẫn có thể xem kết quả của giải `COMPLETED` theo read-only flow.
  4. Club Manager tiếp tục dùng một request `recordRaceResults(..., lock)` theo CR-007 cho cả lưu chưa khóa và khóa chính thức.
  5. Thay các test khẳng định HT lưu draft bằng test phủ định: UI không có hành động ghi kết quả; live/controller request nhận 403; service test chứng minh không upsert, không audit, không đổi status và không tính thưởng. Giữ test HT đăng ký và rút ngựa thành công.
- **Impact / proposed exact TASK-003 scope:** bảy application/test files: sáu file đang được TASK-003 cho phép, cộng BE `src/tournaments/tournaments.controller.ts`. Không cần schema, migration, dependency hoặc API mới.
- **Plan revision after approval:** cập nhật actor matrix trong `PLAN.md`; TASK-003 acceptance/tests/manual QA; TASK-004 objective/acceptance; `HANDOFF.md`, `STATE.md`, `PROGRESS.md`; target `v1-approved-r7`.
- **Data consequence:** không xóa các draft result đã tồn tại. Sau thay đổi, chỉ Club Manager có thể xem xét, sửa hoặc khóa chúng. Không dùng direct DB cleanup.
- **Rollback:** hoàn tác riêng role decorator/service guard, mock/UI gate và focused tests; không có migration.
- **Risk if rejected:** HT tiếp tục có thể ghi đè dữ liệu kết quả và tạo audit hợp lệ dù human authority yêu cầu Club Manager độc quyền xử lý giải.
- **Approval command received:** `APPROVE CR-008`.
- **Human decision:** 2026-10-24 — `APPROVE CR-008`.
- **Resolution:** incorporated into Plan v1-approved-r7 and revised TASK-003/TASK-004 authority. Approval does not resume implementation; AGY requires a new direct `START TASK-003`.
- **Target plan version:** v1-approved-r7 / TASK-003 and TASK-004.

## CR-009 — Khép kín trình tự đăng ký, scratch và ghi/khóa kết quả
- **State:** INCORPORATED
- **Raised by:** Independent Claude review, verified by ChatGPT Planner, 2026-10-24
- **Related plan:** v1-approved-r7 / TASK-003
- **Verified blockers:**
  1. `recordResults` và `lockResults` hiện chỉ chặn `CANCELLED`/`COMPLETED`, nên CM có thể khóa một giải `UPCOMING` hoặc `OPEN_REGISTRATION` thẳng sang `COMPLETED`, bỏ qua `CLOSED_REGISTRATION` và thậm chí trước `raceDate`.
  2. `scratchHorseFromRace` đã tồn tại trong FE API nhưng không có caller UI. Playwright chỉ mở rồi đóng modal đăng ký; không submit đăng ký hoặc scratch dù TASK-003 yêu cầu bằng chứng thực tế.
  3. Test Save Draft chỉ kiểm tra card còn hiển thị, không kiểm tra status không đổi. Test CR-007 chưa có bằng chứng trực tiếp về việc không gọi `/lock-results`, dù việc modal đóng hiện đã bắt được regression gọi kép với mock handler.
  4. Mock registration/scratch chưa đồng bộ role/status/deadline với Backend; delete mock ưu tiên `registeredCount = 0` dù mảng registrations có thể không rỗng.
- **Proposed final state/action matrix:**
  1. `UPCOMING`: chưa mở đăng ký; HT không đăng ký/scratch; không ghi hoặc khóa kết quả.
  2. `OPEN_REGISTRATION`: HT/CM được đăng ký và HT/CM được scratch; không ghi hoặc khóa kết quả.
  3. `CLOSED_REGISTRATION`: không nhận đăng ký mới; HT/CM vẫn được scratch có lý do trước khi kết quả bị khóa; CM được ghi draft và khóa kết quả **chỉ khi `now >= raceDate`**.
  4. `CANCELLED` và `COMPLETED`: không đăng ký, scratch, ghi hoặc khóa; chỉ đọc/audit. `COMPLETED` chỉ đạt được từ `CLOSED_REGISTRATION` qua result locking sau thời điểm đua.
- **Final proposal for approval:**
  1. Enforce matrix trên trong Backend service và mock, với error codes ổn định và kiểm tra trước mọi write/audit/status/prize/horse mutation.
  2. FE chỉ hiển thị Register khi `OPEN_REGISTRATION`; mở entry-management cho `CLOSED_REGISTRATION` để HT/CM có thể scratch registration còn active nhưng không đăng ký mới.
  3. Bổ sung FE `src/features/racing/components/RaceRegistrationModal.tsx` làm file thứ 8 của TASK-003; dùng `scratchHorseFromRace` hiện có, không sửa `api.ts`, không thêm dependency/file thứ 9.
  4. Playwright phải thực sự submit HT registration rồi scratch, kiểm tra trạng thái UI sau từng thao tác; CM Save Draft chỉ trên giải CLOSED sau raceDate và phải assert status vẫn CLOSED; CM Lock chuyển CLOSED thành COMPLETED.
  5. Giữ regression CR-007 bằng hành vi: mock `/lock-results` vẫn trả lỗi nếu bị gọi sau completion, và test bắt buộc modal đóng không lỗi. Bổ sung bằng chứng live/browser Network cho đúng một `/results` và không `/lock-results`; không expose runtime test hook để đếm.
  6. Đồng bộ mock role/status/deadline cho register/scratch; tính delete safety từ cả `registeredCount` và `registrations.length` để không xóa khi một nguồn count stale.
- **Proposed exact scope:** tám application/test files: bảy file đã duyệt trong CR-008 cộng FE `src/features/racing/components/RaceRegistrationModal.tsx`. Không sửa FE `api.ts`, Prisma schema hoặc migration.
- **Automated verification:** BE tournament tests cho mọi state/action edge; HT/CM register/scratch; no-side-effect rejection; FE typecheck/lint/build; Playwright thực hiện register→scratch và CLOSED draft→lock trên cả hai viewport; RBAC suite.
- **Manual/live verification:** HTTP 400/403 và DB before/after cho các đường cấm; Network proof một `/results`, không `/lock-results`; không xóa/chỉnh DB trực tiếp. Dữ liệu test tồn dư từ revision cũ được ghi nhận riêng, không tự cleanup trong CR này.
- **Rollback:** hoàn tác state guards, scratch UI và focused tests; không migration hoặc data rewrite.
- **Risk if rejected:** giải có thể hoàn tất trước khi đóng đăng ký hoặc trước ngày đua; HT có quyền scratch trên API nhưng không thể thực hiện từ Web; test tiếp tục báo pass mà không chứng minh registration/scratch thật.
- **Approval command received:** `APPROVE CR-009`.
- **Human decision:** 2026-10-24 — `APPROVE CR-009`.
- **Resolution:** incorporated into Plan v1-approved-r8 and revised TASK-003 scope/acceptance. Approval does not resume implementation; AGY requires a new direct `START TASK-003`.
- **Target plan version:** v1-approved-r8 / TASK-003.

## CR-010 — Bắt buộc runtime và integration dùng API/PostgreSQL thật
- **State:** INCORPORATED
- **Raised by:** Human clarification, 2026-10-24
- **Related plan:** v1-approved-r8 / TASK-003 QA and TASK-010–019
- **Verified gap:** Main Web `.env.local`/`.env.example` currently enable `VITE_USE_MOCK=true`; FE `src/shared/lib/api.ts` dynamically routes runtime requests to `src/shared/mock/handlers.ts`; canonical Simulator `src/ui/App.tsx` also selects runtime mock mode and multiple screens consume sample operational data. Existing Plan allowed real/mock mode and mock-backed Playwright, so completion did not guarantee real persisted data.
- **Approved decision:** mock/fake is allowed only in isolated unit tests. Runtime, manual QA, integration/E2E and final acceptance must use the real NestJS API and PostgreSQL. Backend/DB failure must surface an explicit error and must never fallback to mock/sample data.
- **Plan/task impact:** bump to v1-approved-r9; TASK-003 remains stopped at AWAITING_USER_QA but requires real-stack QA evidence; TASK-010 closes Main Web runtime mock; TASK-013 closes Simulator runtime mock; TASK-014 launches the canonical real stack; TASK-015–018 require real-stack synchronization evidence; TASK-019 requires Network, DB before/after, restart persistence and no-fallback evidence.
- **Scope safety:** no application code is authorized by CR approval alone. Each future task still needs its own `START TASK-XXX`; if removal/migration exceeds the task's stated five-file boundary, AGY must propose a split CR instead of expanding silently.
- **Testing:** isolated unit tests may use mocks/fakes; mock-backed Playwright or application test hooks do not count as integration evidence. Real integration must use controlled test records in PostgreSQL through application/API paths, preserving audit rules.
- **Rollback:** revert the consumer/config change for the affected task while retaining additive Backend contracts/data; never restore silent mock fallback in an accepted runtime build.
- **Approval command received:** `APPROVE CR-010` plus explicit real API/PostgreSQL/no-fallback policy.
- **Human decision:** 2026-10-24 — `APPROVE CR-010`.
- **Resolution:** incorporated into Plan v1-approved-r9 and TASK-003 QA/TASK-010–019 acceptance. Does not approve TASK-003 or authorize execution.
- **Target plan version:** v1-approved-r9.

## DEFECT-001 — Lỗi hợp đồng dữ liệu tạo ngựa của Club Manager (property rfid should not exist)
- **State:** RESOLVED_BY_HUMAN_DIRECTIVE
- **Raised by:** Human during TASK-004 manual QA, 2026-10-25
- **Related plan:** Outside current TASK-004 diff / Horse Master-Data contract
- **Observed behavior:** Club Manager tạo ngựa trên Web bị lỗi HTTP 400 Bad Request từ Backend: `property rfid should not exist`. FE `HorseFormPage.tsx` (lines 221 & 236) gửi payload có trường `rfid`, nhưng Backend `CreateHorseDto`/`UpdateHorseDto` (`src/horses/dto/create-horse.dto.ts` & `update-horse.dto.ts`) không khai báo `rfid` và kích hoạt `forbidNonWhitelisted: true`.
- **Human instruction:** On 2026-10-25 10:07 (Asia/Bangkok), Human explicitly rejected TASK-004 with directive: `vẫn còn rfid, vui lòng mọi thao tác liên quan đến rfid xóa hẵng, đồng thời tạo database sao cho dư thừa để mà test thực tế`.
- **Resolution:** All `rfid` UI fields, state variables, generator functions, validation rules, and payload properties were completely deleted from Frontend (`HorseFormPage.tsx`, `HorseDetailPage.tsx`, `HorseListPage.tsx`, `types.ts`, and mock handlers). The frontend now strictly sends the canonical `microchip?: string` contract matching Backend `CreateHorseDto`/`UpdateHorseDto`. Verified: Club Manager horse creation via API succeeds with HTTP 201 Created.
- **Target plan version:** v1-approved-r9 / TASK-004 rejection rework.

## CR-011 — Ngăn rò rỉ dữ liệu giải đua và thông tin cá nhân (PII) của chủ ngựa khác và mở rộng phạm vi TASK-007 lên 7 tệp
- **State:** APPROVED
- **Approved by:** Human project owner via exact command `APPROVE CR-011` on 2026-10-25 (Asia/Bangkok).
- **Raised by:** Human Review / Rejection of TASK-007 (`REJECT TASK-007: Real-stack review found a Horse Owner race-data authorization leak`), 2026-10-25
- **Related plan:** v1-approved-r9 / TASK-007
- **Verified blocker:**
  1. Khi xác thực dưới vai trò Horse Owner (`owner@gmail.com`), endpoint `GET /api/tournaments/:id` trả về danh sách toàn bộ ngựa đăng ký (bao gồm ngựa thuộc sở hữu của chủ khác) và để lộ email cùng thông tin cá nhân (PII) của chủ ngựa khác (`horse.owner.email`, `fullName`, `id`).
  2. `TournamentsController.findOne` hiện không nhận `@CurrentUser() user?: CurrentUserPayload`, và `TournamentsService.findOne` truy vấn/trả về toàn bộ `registrations` không lọc theo quyền sở hữu của caller.
  3. Điều này vi phạm tiêu chí nghiệm thu của TASK-007: "Owner sees only owned horse/training/race/finance data; foreign IDs return 403/404 without leakage".
  4. TASK-007 hiện đã thay đổi 4 tệp code/spec (`me.service.spec.ts`, `financial.service.spec.ts`, `horses.service.spec.ts` ở Backend và `tests/e2e/rbac-matrix.spec.ts` ở Frontend).
  5. Việc sửa triệt để lỗ hổng rò rỉ dữ liệu giải đua ở Backend đòi hỏi thay đổi:
     - `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.controller.ts` (nhận `@CurrentUser()` và truyền cho service).
     - `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.ts` (lọc `registrations` và `result` theo `ownerId === user.userId` khi caller là `HORSE_OWNER`, bảo vệ PII chủ khác).
     - `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.spec.ts` (bổ sung negative test chứng minh Horse Owner không nhận dữ liệu đăng ký/kết quả hoặc PII của chủ khác).
  6. Tổng số tệp thay đổi sẽ là 7 tệp (4 tệp hiện tại + 3 tệp mới), vượt quá giới hạn 5 tệp (M-size) của TASK-007.
- **Proposed exact scope expansion:**
  Phê duyệt mở rộng phạm vi chính xác của TASK-007 thành 7 tệp:
  1. `Racehorse_Training_Management_System_MT_BE/src/accounts/me.service.spec.ts`
  2. `Racehorse_Training_Management_System_MT_BE/src/financial/financial.service.spec.ts`
  3. `Racehorse_Training_Management_System_MT_BE/src/horses/horses.service.spec.ts`
  4. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.controller.ts`
  5. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.ts`
  6. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.spec.ts`
  7. `Racehorse_Training_Management_System_MT_FE/tests/e2e/rbac-matrix.spec.ts`
- **Behavior & Acceptance additions:**
  1. `TournamentsController.findOne` nhận authenticated `@CurrentUser() user: CurrentUserPayload` và truyền vào `TournamentsService.findOne(id, user)`; caller không optional.
  2. `TournamentsService.findOne`: Giữ nguyên metadata giải đua; khi caller là `HORSE_OWNER`, ràng buộc truy vấn Prisma theo `horse.ownerId = user.userId` để chỉ trả về `registrations` và `result` của ngựa thuộc sở hữu của caller, đồng thời không trả owner ID/full name/email hoặc PII của chủ khác. Các vai trò không phải Horse Owner giữ nguyên hành vi hiện tại; CR-011 không mở rộng sang thay đổi quyền của các role đó.
  3. Playwright E2E kiểm tra foreign horse dùng ID ngựa thật đã seed của Owner 2 (`d2b6aac3-c3f8-4ee7-83f7-d7c7d260347b`), loại bỏ mock ID `/horses/horse-1`.
  4. Bổ sung test kiểm thử tiêu cực (negative tests) chứng minh Horse Owner không nhận được registrations/results hoặc PII của chủ khác.
  5. `reports/TASK-007.md` chỉ dùng NestJS API và PostgreSQL thật, loại bỏ toàn bộ phương án mock / fallback.
- **Risk if rejected:** Dữ liệu đăng ký, kết quả giải đua và email của các chủ ngựa khác tiếp tục bị lộ cho Horse Owner qua API `GET /tournaments/:id`.
- **Target plan version:** v1-approved-r10 / TASK-007.

## CR-012 — Phân tách TASK-010 thành hai slice kiểm soát, hoàn tất chuyển đổi Main Web sang real-only runtime, và điều chỉnh CI/Governance

- **State:** APPROVED by exact human command `APPROVE CR-012` on 2026-10-25.
- **Raised by:** Human Review / Rejection of TASK-010 (`REJECT TASK-010`), 2026-10-25; revised per human planning directive.
- **Related plan:** v1-approved-r10 / TASK-010; incorporated into Plan v1-approved-r11.
- **Verified gap & Scope trigger:**
  1. Main Web runtime mock cutover chưa triệt để trong các tệp ngoài scope 5 tệp ban đầu của TASK-010:
     - `Racehorse_Training_Management_System_MT_FE/src/features/dashboard/pages/AuditLogPage.tsx` tại dòng 197 vẫn rẽ nhánh theo `import.meta.env.VITE_USE_MOCK === "true"` và render Alert "Demo audit history" (dòng 198–206).
     - `Racehorse_Training_Management_System_MT_FE/Dockerfile` tại dòng 14 khai báo `ARG VITE_USE_MOCK=false` và dòng 17 khai báo `ENV VITE_USE_MOCK=$VITE_USE_MOCK`.
     - `Racehorse_Training_Management_System_MT_FE/src/vite-env.d.ts` tại dòng 4 khai báo `readonly VITE_USE_MOCK?: string;`.
     - `Racehorse_Training_Management_System_MT_FE/.github/workflows/ci.yml` tại dòng 122 build browser artifact với `VITE_USE_MOCK: 'true'`.
     - `Racehorse_Training_Management_System_MT_FE/AGENTS.md` tại dòng 67–68 chứa quy tắc lỗi thời: `"VITE_USE_MOCK=true routes calls to shared/mock/handlers.ts (browser data, OTP 123456), so every new API needs a matching mock handler"`, trực tiếp xung đột với quyết định kiến trúc real-only CR-010 đã duyệt.
  2. Giữ vững cổng Human Gate và giới hạn cỡ M (tối đa 5 tệp mỗi task/slice):
     - Không mở rộng bừa bãi một task M-size lên 10 tệp.
     - Phân chia nhiệm vụ TASK-010 thành hai slice kiểm soát:
       - **Slice A (5 tệp - Đã triển khai trong working tree):** Phân phối thông báo Medical Lock và chuyển đổi API runtime (`api.ts`, `.env.example`, `notifications.spec.ts`, `medical-locks.service.ts`, `medical-services.spec.ts`).
       - **Slice B (5 tệp - Corrective scope):** Dọn sạch mock runtime trong `AuditLogPage.tsx`, loại bỏ biến mock khỏi `Dockerfile` và `vite-env.d.ts`, điều chỉnh standalone CI trong `ci.yml`, và cập nhật `FE/AGENTS.md`.
  3. Trình tự Human Gate chuẩn xác:
     - Tuyệt đối không phê duyệt `APPROVE TASK-010` sau Slice A vì tiêu chí nghiệm thu của TASK-010 vẫn chưa hoàn tất.
     - Không tạo ra task riêng "TASK-010B" làm biến đổi cấu trúc phụ thuộc của plan khi chưa có plan revision chính thức.
     - Trình tự thực thi đúng quy trình:
       `APPROVE CR-012`
       -> Planner tích hợp vào Plan v1-approved-r11
       -> Human gửi lệnh `START TASK-010` (tiếp tục thực thi chính task TASK-010 đã bị reject, dành riêng cho 5 tệp Slice B)
       -> AGY triển khai 5 tệp Slice B
       -> AGY chạy toàn bộ nghiệm thu kết hợp của TASK-010 (automated baseline, local real-stack Playwright, browser Network tới `localhost:3000/api`, tính bền vững sau restart, lỗi hiển thị khi dừng Backend, quy trình cleanup PowerShell an toàn)
       -> Chuyển trạng thái TASK-010 sang `AWAITING_USER_QA`
       -> Human xem xét bằng chứng và gửi lệnh `APPROVE TASK-010`
       -> Human gửi lệnh `AUTHORIZE COMMIT TASK-010` -> STOP
       -> Chỉ khi đó Human mới gửi lệnh `START TASK-011`.
  4. Chiến lược kiểm thử tự động CI trung thực (`.github/workflows/ci.yml`):
     - Giai đoạn 2 (Build): Build real-only với production target, tuyệt đối không có `VITE_USE_MOCK`.
     - Giai đoạn 3 (Black-box Playwright): Standalone runner trên GitHub Actions không có Backend/PostgreSQL. Việc chạy integration Playwright trong môi trường thiếu backend sẽ bị lỗi mạng, còn bật mock thì vi phạm CR-010. Do đó, Playwright tích hợp trong standalone FE CI sẽ được **tạm dừng/vô hiệu hóa rõ ràng kèm giải thích minh bạch**; tuyệt đối không để CI âm thầm báo pass giả lập và không chạy mock-backed browser tests.
     - Kiểm thử Playwright trên real-stack là cổng nghiệm thu bắt buộc tại local/manual cho TASK-010.
  5. Chiến lược dọn dẹp dữ liệu kiểm thử an toàn trên PowerShell:
     - Đọc và lưu trữ `status` và `isMedicalLocked` gốc của ngựa trước khi thực hiện thao tác kiểm thử.
     - Chỉ nhắm mục tiêu vào đúng `createdLockId` vừa tạo.
     - Thu thập chính xác danh sách ID thông báo và ID audit log sinh ra từ lần chạy này.
     - Xóa đúng các ID nói trên trong một giao dịch Prisma duy nhất (`prisma.$transaction`).
     - Khôi phục giá trị trạng thái ngựa về đúng giá trị gốc đã lưu (không hard-code `RESTING`).
     - Xác nhận (assert) số lượng bản ghi tồn dư của các ID mục tiêu bằng 0; abort nếu kiểm tra an toàn thất bại.
     - Tuyệt đối không dùng bộ lọc `lockReason contains "tendon strain"`.

- **Approved exact 10 authorized files for TASK-010 across the two slices:**
  - **Slice A (5 files — already modified in working tree):**
    1. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-locks.service.ts`
    2. `Racehorse_Training_Management_System_MT_BE/src/medical/medical-services.spec.ts`
    3. `Racehorse_Training_Management_System_MT_FE/src/shared/lib/api.ts`
    4. `Racehorse_Training_Management_System_MT_FE/.env.example`
    5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/notifications.spec.ts`
  - **Slice B (5 corrective files authorized upon CR-012 approval):**
    1. `Racehorse_Training_Management_System_MT_FE/src/features/dashboard/pages/AuditLogPage.tsx`
    2. `Racehorse_Training_Management_System_MT_FE/Dockerfile`
    3. `Racehorse_Training_Management_System_MT_FE/src/vite-env.d.ts`
    4. `Racehorse_Training_Management_System_MT_FE/.github/workflows/ci.yml`
    5. `Racehorse_Training_Management_System_MT_FE/AGENTS.md`

- **Approved outcome:**
  1. Planner tích hợp CR-012 vào Plan v1-approved-r11 và phạm vi TASK-010 trong `TASKS.md`.
  2. Execution trở về `IDLE`; human phải gửi lệnh mới `START TASK-010` để AGY chỉ triển khai 5 tệp Slice B rồi chạy toàn bộ nghiệm thu kết hợp của TASK-010.
  3. Approval này không phê duyệt TASK-010, không cho phép commit/push và không cho phép bắt đầu TASK-011.

- **Risk if rejected:**
  - Main Web tiếp tục tồn tại các nhánh rẽ mock ẩn; bản build Docker và CI có thể kích hoạt lại mock data; `AGENTS.md` tiếp tục hướng dẫn sai lệch; nghiệm thu real-only không được khép kín.

- **Target plan version:** v1-approved-r11.
