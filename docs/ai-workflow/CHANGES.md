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

## CR-013 — Controlled Web manual-QA dataset expansion

- **State:** APPROVED by exact human command `APPROVE CR-013` on 2026-10-26.
- **Raised by:** Human request to provide abundant data for manual Web QA after TASK-011.
- **Related plan:** v1-approved-r11 after TASK-011; incorporated into Plan v1-approved-r12.
- **Problem:** the baseline seed covers core accounts, horses, stalls and selected domain records, but does not provide enough deterministic cross-role/lifecycle volume for broad Web manual QA. Editing the baseline seed or ad-hoc live rows would make reruns and cleanup unsafe.
- **Approved change:**
  1. Insert `TASK-020 — Controlled Web manual-QA dataset expansion` after TASK-011 and make TASK-012 depend on it; keep existing TASK-012–019 IDs unchanged.
  2. Add exactly two Backend tooling files to task scope: `prisma/seed-manual-qa.ts` and `package.json`.
  3. Seed deterministic QA-only records into the existing local PostgreSQL database with stable QA IDs/codes/emails and idempotent upserts.
  4. Cover all Web-facing domains and role/ownership boundaries with the minimum counts specified in TASK-020.
- **Safety:** explicit `--confirm-local-qa` is required; production is rejected; target host/database is printed before mutation; no schema/migration, second database, delete/truncate, baseline `prisma/seed.ts` edit or non-QA mutation is authorized.
- **Acceptance:** two identical runs create no duplicates; non-QA counts and fingerprints remain unchanged; real NestJS/PostgreSQL five-role checks and restart persistence pass; no mock/fallback.
- **Human-gate result:** execution remains `IDLE`. This CR approval does not run the seed, start TASK-020, commit, push or authorize TASK-012. A separate exact `START TASK-020` is required.
- **Target plan version:** v1-approved-r12.

## CR-014 — Canonical v3 Simulator without secondary login; session-bound REST and Socket.IO

- **State:** APPROVED by exact human command `APPROVE CR-014` on 2026-10-26.
- **Raised by:** Human clarification after TASK-012 review: use the v3 Simulator product, do not use `.bat` yet, and never show a second Simulator login.
- **Related plan:** v1-approved-r12 while TASK-012 remains `AWAITING_USER_QA`; incorporated into Plan v1-approved-r13.
- **Verified gap:** canonical Git `Racehorse_Simulator_Web/` already contains the v3 product lineage, while the suffixed `_v3` directory has no `.git`. Both current UI copies still render `SimulatorLogin`. The Backend Socket.IO gateway accepts a connection without token/session and assigns a default Head Trainer, so merely hiding the form would create incorrect actor attribution and an unsafe trust boundary.
- **Approved change:** keep `Racehorse_Simulator_Web/` as the only editable/testable v3 source; expand TASK-013 into two sequential slices. Slice A validates Main-Web-issued session identity for REST context and Socket.IO, resolves the recorded actor, rejects missing/invalid/terminal/expired sessions and removes the default-trainer fallback. Slice B removes reachable login/mock/sample paths and bootstraps the v3 UI solely from the real session context.
- **Exact scope:** Slice A uses six files: BE `src/simulator/simulator.service.ts`, `src/simulator/simulator.service.spec.ts`, `src/simulator/simulator.gateway.ts`, `src/simulator/simulator.gateway.spec.ts`; SIM `src/sim/socketTransport.ts`, `src/sim/socketTransport.test.ts`. Slice B uses five SIM files: `src/ui/App.tsx`, `src/ui/FarmHub.tsx`, `src/ui/TrialTab.tsx`, `src/ui/VetZone.tsx`, `src/ui/HorseCard.tsx`.
- **Session rule:** accept only `PENDING`/`RUNNING`; stale `PENDING` launch sessions expire after five minutes using existing timestamps, without schema/migration. Missing/invalid/terminal/expired session or missing actor fails closed. Valid Head Trainer workout and Veterinarian exam launches enter v3 directly without `/auth/login`.
- **Launcher deferral:** root `start.bat` and `stop.bat` remain out of TASK-013 and TASK-014 remains TODO. Until a separate `START TASK-014`, developers start PostgreSQL, Backend, Frontend and canonical Simulator manually through Docker/npm.
- **Human-gate result:** TASK-012 remains `AWAITING_USER_QA`; CR approval does not approve/commit TASK-012, modify code, start TASK-013, start TASK-014, push or merge.
- **Target plan version:** v1-approved-r13.

## CR-015 — Complete TASK-013 with PostgreSQL-backed session data, Vet EXAM flow and real-browser acceptance

- **State:** APPROVED by exact human command `APPROVE CR-015` on 2026-10-27.
- **Raised by:** Human browser QA after TASK-013 returned `AWAITING_USER_QA`.
- **Related plan:** v1-approved-r13 / TASK-013; incorporated into Plan v1-approved-r14.
- **Verified browser failures:** Chromium against the live ports showed that Head Trainer Trial Runs returned an empty real API result and no launch action; PostgreSQL horse `Test Victory 2562` had `weightKg=490` while Simulator displayed 535 kg from `450 + hash % 100` and Main Web initialized 480 kg; a valid Vet EXAM session loaded one real horse and connected to NestJS Socket.IO, but the UI exposed no action that publishes `sim:exam_finished`, so `/exams/latest` returned 404. Direct access, `?dev`, invalid-session failure, session context loading and reload were verified fail-closed/real-stack.
- **Approved change:** retain the existing TASK-013 Slices A/B and add corrective Slices C/D. Slice C propagates PostgreSQL horse weight and active-stall truth through the session contract, removes fabricated master-data fallback, completes the existing EXAM packet path from Simulator UI through ACK/persistence to Main Web, and removes the misleading 480 kg form default. Slice D provides an eligible deterministic QA trial and adds a real-stack browser test.
- **Data boundary:** identity/master fields that exist in PostgreSQL must match PostgreSQL. Values produced by the simulation engine may remain model outputs but must not be presented as persisted master data. Missing master data is unavailable or an explicit error, never a hash/default substitute. Masked microchip data must not be reconstructed.
- **Exact scope:** TASK-013 is now exactly 19 application/test files: the 11 files already authorized by CR-014; seven additional Slice C files — BE `src/simulator/simulator.types.ts`, `prisma/seed-manual-qa.ts`; SIM `src/api/simulatorApi.ts`, `src/api/simulatorApi.test.ts`, `src/api/horseMapper.ts`, `src/api/horseMapper.test.ts`; FE `src/features/health/pages/RecordFormPage.tsx`; and one Slice D file, FE `tests/e2e/simulator-real-stack.spec.ts`. Slice C may update already-authorized service/spec and UI files. No schema/migration, `.bat`, `_v3`, dependency or twentieth application/test file is authorized.
- **Browser gate:** Playwright/Chromium must use the live `5173`/`5175` applications, NestJS `3000` and PostgreSQL `5432`, without route interception or runtime mock. It must launch Head Trainer workout and Vet EXAM from Main Web, observe REST and Socket.IO, compare UI/context/result to PostgreSQL, finish EXAM once, reload both apps, verify persistence/refetch, capture screenshots plus sanitized Network/console evidence, and exercise fail-closed cases. API-only verification cannot satisfy Human Manual QA readiness.
- **Human handoff:** reuse the already-running Docker/npm processes when healthy. Before returning `AWAITING_USER_QA`, AGY leaves a named eligible QA trial and exact non-secret manual steps ready; the human must only reload the open pages and perform the listed UI actions.
- **Sequence:** approval resets execution to `IDLE`, `next_task: TASK-013`. It does not resume code, approve/commit TASK-013, authorize TASK-014, push or merge. AGY requires a new direct `START TASK-013`.
- **Downstream impact:** the minimum single-session real horse/stall baseline moves forward from TASK-015 into TASK-013. TASK-015 retains broader cross-role authorization/synchronization verification and must reuse this baseline.
- **Target plan version:** v1-approved-r14.

## CR-016 — Deterministic workout completion and streamlined EXAM handoff

- **State:** APPROVED by exact human command `APPROVE CR-016` on 2026-10-27.
- **Raised by:** Human manual QA after TASK-013 returned to `AWAITING_USER_QA` under CR-015.
- **Related plan:** v1-approved-r14 / TASK-013; incorporated into Plan v1-approved-r15.
- **Observed failures and ambiguity:** the workout reached its prescribed distance but the runner animation continued; Main-Web-issued workout settings and obstacle authoring remained editable; the workout result was not formatted into Main Web; the EXAM round trip required entering Simulator, waiting/skipping the cloud intro, completing the exam, returning to Main Web and manually loading measurements; vital cards showed `Normal` for in-range measurements on an injured/locked horse, which was easily mistaken for overall health status. Independent review additionally identified two `sim:exam_finished` wire paths; the current uncommitted R-10 correction removes that duplicate path and must be preserved.
- **Approved TASK-013 correction:** add Slice E. A scheduled Main-Web workout uses immutable prescribed surface/distance/intensity. When no Backend obstacle prescription exists, Simulator hides obstacle authoring and must not fabricate obstacles. Reaching the prescribed distance stops movement, transitions to DONE, displays the summary and emits/persists/broadcasts one logical `sim:session_finished`.
- **Boundary with TASK-016:** TASK-013 proves Simulator finish semantics and exactly-once persistence only. Formatting/loading the trial result into Main Web and completing the live-monitor workflow remain TASK-016; CR-016 does not pull them forward.
- **Approved EXAM UX:** a valid Main-Web-issued EXAM bypasses the decorative intro and opens the Vet flow directly. One completion action emits one `sim:exam_finished`, awaits ACK, exposes return/close, and Main Web auto-loads the newest acknowledged result when its tab regains focus. The existing manual load action remains fallback.
- **Medical wording:** vital cards use `Within reference range` / `Outside reference range` (localized). These labels classify individual measurements only and remain separate from proposed/applied horse status and Medical Lock. No automatic diagnosis, medical-record creation, status application or lock mutation is authorized.
- **Exact scope:** preserve the existing 19 TASK-013 application/test files and add exactly SIM `src/main.tsx` and FE `src/features/health/components/VitalsDisplay.tsx`, for a total of 21. Already-authorized TASK-013 files may be corrected as specified in TASKS.md. No schema/migration, obstacle API, dependency, `.bat`, `_v3`, TASK-014 or TASK-016 implementation is authorized. A twenty-second application/test file requires a new CR.
- **Acceptance evidence:** real-stack Playwright must drive the prescribed workout through visible completion, assert a stopped runner/DONE/summary and exactly one outbound finish plus one persisted logical result; prove no unprescribed obstacle editor; prove EXAM has no intro, emits once and auto-populates Main Web after focus/reload; distinguish in-range vitals from injured/locked horse state. Existing security, PostgreSQL master-data, no-login and fail-closed gates remain mandatory.
- **Sequence:** approval resets execution to `IDLE`, `next_task: TASK-013`. It does not start, approve or commit TASK-013, authorize TASK-014, push or merge. AGY requires a new direct `START TASK-013`.
- **Target plan version:** v1-approved-r15.

## CR-017 — Finished workout relaunch guard, nullable exam weight contract, and medical record horse identity

- **State:** APPROVED — explicit `APPROVE CR-017` received 2026-10-27 (Asia/Bangkok)
- **Raised by:** Antigravity IDE following human QA feedback in `helpme-brother.docx` on 2026-10-27.
- **Related plan:** v1-approved-r15 / TASK-013.
- **Confirmed root causes:**
  1. *Finished workout relaunch failure (R-11):* Backend `startWorkout` blindly returned an existing `COMPLETED` session ID instead of rejecting or creating a new eligible session, causing Simulator `context` to immediately reject with 409 `SIMULATOR_SESSION_FINISHED`.
  2. *Missing master weight in EXAM (R-12):* `ExamFinishedPacketDto` strictly requires `@IsNumber() @Min(200) @Max(800) value: number`. When a horse has no master weight recorded in PostgreSQL (`weightKg: null`), Simulator sending `value: null` causes class-validator failure `INVALID_SIMULATOR_PACKET`.
  3. *Medical record horse identity (R-13):* Backend `getMedicalRecords` returns nested `horse: { id, name, microchipRfid, status }` without `horseCode` or top-level `horseName`, while `RecordListPage.tsx` renders `<td className="nowrap">{r.horseName || r.horseId}</td>`, causing raw UUID to be displayed as primary visible horse identity.
  4. *Clinical text integrity (R-14):* Verified no application defect exists. The URL text in record `BA-2610-028` was manually pasted into form fields during testing; form mapping logic only populates numeric vitals and source banner.
- **Proposed changes & minimal additional file list (5 additional files, expanding TASK-013 to 26 files):**
  1. **BE `src/simulator/dto/exam-packet.dto.ts`:** Permit `metrics.weight` / `value` to be optional or nullable (`@IsOptional()`) so that examinations for horses without recorded weight validate cleanly.
  2. **BE `src/medical/medical-records.service.ts`:** In `getMedicalRecords`, select `horseCode` and map `horseName: record.horse?.name` and `horseCode: record.horse?.horseCode`.
  3. **FE `src/features/health/api.ts`:** In `listRecords`, map `horseName` and `horseCode` from the API response.
  4. **FE `src/features/health/pages/RecordListPage.tsx`:** Display the horse name and horse code (`r.horse?.name || r.horseName || r.horseId`), never showing raw UUID as the primary visible horse label.
  5. **SIM `src/sim/packets.ts`:** In `examFinishedPacket`, preserve null/omitted weight when `h.weightKg` is unavailable.
  6. **Existing approved scope updates:**
     - BE `src/simulator/simulator.service.ts` & `simulator.service.spec.ts`: Prevent `startWorkout` from returning terminal `COMPLETED`/`ABORTED_INJURY` sessions.
     - BE `prisma/seed-manual-qa.ts`: Provision deterministic QA fixtures using the exact requested namespace.
     - FE `src/features/health/pages/RecordFormPage.tsx`, `tests/e2e/simulator-real-stack.spec.ts`, and SIM UI files.
- **Deterministic QA namespace protocol:**
  - Horse name: `QA T013 Trial Horse` / Code: `QA-T013-HORSE-001`
  - Training plan: `QA T013 Trial Plan`
  - Workout label: `QA-T013-TRIAL-001` (1800m, TURF, SCHEDULED)
  - EXAM horse: `QA T013 Exam Horse` / Code: `QA-T013-EXAM-001`
  - Medical record reason: `QA-T013-EXAM-001`
  - Test-data marker: `TASK-013-MANUAL-QA`
- **Acceptance criteria:**
  1. `startWorkout` on a finished or aborted workout session never returns a launch URL for a terminal session; rejects with 409 `SIMULATOR_SESSION_FINISHED` or initiates a clean fresh session.
  2. Horses without master weight can complete clinical examinations; available measurements are persisted/acknowledged exactly once; missing weight is preserved as explicitly unavailable/null; Main Web auto-loads available vitals on focus.
  3. Medical record list renders real horse name and horse code, never a raw UUID.
  4. Deterministic QA fixtures are created and verified idempotent using the exact requested namespace.
  5. Real-stack Playwright suite passes with no mocks.
- **Pre-approval human-gate result:** TASK-013 was marked `BLOCKED` and AGY stopped before modifying any out-of-scope file.
- **Target plan version:** v1-approved-r16.
- **Approved outcome:** incorporate corrective Slice F and the five listed additional files into TASK-013. A terminal session attached to the same workout must return a clear 409 and must never produce a broken launch URL; a fresh deterministic QA workout/session is prepared by the QA fixture/reset protocol rather than silently reopening terminal history.
- **Sequence after approval:** clear the blocker and return execution to `IDLE` with `next_task: TASK-013`. AGY still requires a new direct `START TASK-013`; this approval does not approve/commit TASK-013, authorize TASK-014, push or merge.

## CR-018 — Simulation-time chart fidelity, Trial Runs scheduling intent, and temporary TASK-013 executor reassignment

- **State:** APPROVED by exact human command `APPROVE CR-018` on 2026-10-27.
- **Raised by:** ChatGPT Planner after exact human `REJECT TASK-013` feedback on 2026-10-27.
- **Related plan:** v1-approved-r16 / TASK-013.
- **Confirmed root causes:**
  1. `TrialTab.tsx` advances the model with `dtReal × playbackSpeed`, so the modeled finish time remains correct, but chart points are appended only by the 1 Hz real-clock transport ticker. A 60× playback of a roughly 135-second modeled run therefore exposes only a few chart points and does not communicate the model variation.
  2. `TrialRunsPage.tsx` opens generic `WorkoutDialog` without a default workout type. `WorkoutDialog` initializes `type` to `CANTER`, so the “Lên lịch chạy thử” entry point can save a valid non-TRIAL workout that does not appear in the Trial Runs list.
- **Approved design:** preserve 1 Hz real-time Socket.IO telemetry and deterministic model results across 1×/10×/60×, but sample the visual chart on simulated time and label playback versus simulated elapsed time clearly. Make the Trial Runs entry point initialize the existing dialog as `TRIAL`; keep target speed, jockey, groom, medical lock, plan dates, phase dates, slot collision and daily-limit validation unchanged.
- **Exact approved scope:** add FE `src/features/training/pages/TrialRunsPage.tsx` and `src/features/training/components/WorkoutDialogs.tsx`, expanding TASK-013 from 26 to 28 application/test files. Previously authorized SIM `src/ui/TrialTab.tsx` and FE `tests/e2e/simulator-real-stack.spec.ts` may be corrected for this slice. No new dependency, Backend/schema/migration/database recreation, broad QA-data deletion, `.bat`, `_v3`, TASK-014 or later-task implementation is authorized.
- **Acceptance:** the same seed/config yields equivalent simulated finish/result at 1×, 10× and 60×; 60× only shortens wall-clock viewing; the chart retains a readable simulation-time curve rather than two or three real-clock samples; transport stays 1 Hz real time; “Lên lịch chạy thử” opens with TRIAL selected and saving a valid distinct slot creates a TRIAL row visible after reload; validation errors remain actionable; the provisionally accepted medical flow passes regression unchanged.
- **Approved executor exception:** after a separate direct `START TASK-013 CODEX`, Codex may replace AGY as executor for this TASK-013 corrective continuation only. Codex may edit the approved files, run verification and update AGY-owned execution/report fields for this slice, then must stop at `AWAITING_USER_QA`. The default AGY executor rule remains unchanged for TASK-014 and later tasks.
- **Sequence:** approval produces Plan v1-approved-r17 and resets execution to `IDLE`, `next_task: TASK-013`. Approval alone does not start implementation, approve/commit TASK-013, authorize TASK-014, push or merge.
- **Target plan version:** v1-approved-r17.

## CR-019 — Trial launch timing clarity and Simulator result draft refresh

- **State:** APPROVED by exact human command `APPROVE CR-019` on 2026-10-27.
- **Raised by:** Human Manual QA supplied in `trial_runs.docx` on 2026-10-27.
- **Related plan:** v1-approved-r17 / TASK-013.
- **Verified findings:**
  1. The reported different-horse row is scheduled for 2026-10-28 while the QA date is 2026-10-27. `TrialRunsPage.tsx` disables launch when `scheduledAt > now`, and Backend `SimulatorService.startWorkout` independently rejects the same request with `WORKOUT_NOT_STARTED`. The screenshot therefore shows an enforced timing rule, not a missing Simulator connection. The disabled styling/title does not explain that rule clearly enough.
  2. Both completed QA workouts have real `COMPLETED` `SimulatorSession` rows and result JSON in PostgreSQL. Live `GET /api/simulator/workouts/:id/latest` returns distance, duration, peak heart rate, top speed, surface and condition. Fresh Chromium navigation to each result page already populates those objective fields.
  3. Recovery heart rate is absent because Slice E ends at the prescribed distance before a recovery measurement exists. Performance score and professional comment are Head Trainer judgments and must not be fabricated. Completion can be derived only from Simulator terminal status plus completed versus prescribed distance.
  4. A result page that was already open does not refresh its draft when focus returns from Simulator, and imported versus human-entered fields are not visibly distinguished. That UX gap explains why a user can reasonably believe the transfer did not occur.
- **Proposed corrective Slice H:**
  1. Preserve the Backend scheduled-time authority. On future Trial Runs, render a visible Vietnamese/English explanation next to the disabled launch action with the exact earliest launch time. Do not silently move the schedule or permit early execution.
  2. Refactor the existing result-draft fetch in `SessionResultPage.tsx` into one idempotent loader used on initial mount, window focus and an explicit retry button while no persisted Head Trainer result exists.
  3. Show a clear “Loaded from Simulator” source/status banner and identify unavailable measurements. Populate only objective Simulator values. Derive `ACHIEVED` only for a completed run reaching the prescribed total distance and `PARTIAL` for an injury-aborted/short run; never infer performance score, professional comment, abnormal-sign judgment or unavailable recovery HR.
  4. Extend the existing real-stack browser test to prove: a future workout remains blocked with a visible reason; returning focus after a completed simulation fills exact PostgreSQL-backed values; reload preserves the same draft source; no duplicate finish packet or automatic final-result submission occurs.
- **Exact proposed scope:** update already-authorized FE `src/features/training/pages/TrialRunsPage.tsx` and `tests/e2e/simulator-real-stack.spec.ts`; add FE `src/features/training/pages/SessionResultPage.tsx` as the twenty-ninth TASK-013 application/test file. Canonical coordination/report files do not expand application scope.
- **Downstream boundary:** this pulls only draft hydration/visibility from TASK-016. Persisting the final Head Trainer-approved workout result, live-monitor completion, incident workflow and broader trial realtime flow remain TASK-016. No Backend, schema, migration, seed, dependency, Simulator source, `.bat`, `_v3`, TASK-014 or other later-task work is proposed.
- **Execution gate:** TASK-013 is `BLOCKED` pending CR-019. Approval would create Plan `v1-approved-r18`, return execution to `IDLE`, retain `next_task: TASK-013`, and require a new exact `START TASK-013 CODEX`. Approval would not approve/commit TASK-013, start TASK-014, push or merge.
- **Target plan version:** v1-approved-r18.

## CR-020 — Separate database reset from four-tab runtime launcher and force-stop lifecycle

- **State:** APPROVED by exact human command `APPROVE CR-020` on 2026-10-28.
- **Raised by:** ChatGPT review plus direct human clarification after TASK-014 returned `AWAITING_USER_QA`.
- **Related plan:** v1-approved-r18 / TASK-014; incorporated into Plan v1-approved-r19.
- **Rejected prior handoff:** the current `start.bat` opens only three tabs and reports success after a fixed delay without proving BE/FE/SIM health; `stop.bat` prints unconditional success; the separate existing `setup-db.bat` is outside the approved two-file scope and can falsely fall through to PostgreSQL-ready after timeout.
- **Approved lifecycle:** `setup-db.bat` owns intentional local reset/seed; `start.bat` owns non-destructive runtime startup; `stop.bat` owns forced local teardown. The required manual order is `stop -> setup-db -> start -> verify -> stop`.
- **Four-tab contract:** one Windows Terminal contains Backend 3000, Frontend 5173, canonical Simulator 5175, and PostgreSQL/Docker status or logs. `start.bat` must never run database reset/seed and must not report success/open browsers until bounded real health checks pass.
- **Force-stop authority:** the human explicitly authorizes `stop.bat` to force-terminate EquiFlow listeners on 3000/5173/5175 and stop `equiflow-postgres`. It must verify ports/container are stopped and fail non-zero with diagnostics if teardown is incomplete.
- **Exact scope:** expand TASK-014 from two to exactly three root files: `setup-db.bat`, `start.bat`, `stop.bat`. Canonical coordination/report files do not expand application scope. No application source, schema/migration, dependency, `_v3`, TASK-015 or later-task work is authorized.
- **Failure behavior:** Docker/Compose, PostgreSQL readiness, dependency installation, Prisma generation, database setup and service-health failures are actionable non-zero exits. No mock/fallback data.
- **Delivery limitation:** the workspace root is not a Git repository, so these scripts cannot be delivered to other members by pulling the existing BE/FE/SIM repositories. This must be reported truthfully; changing repository layout requires a separate approval.
- **Sequence:** approval supersedes the previous TASK-014 `AWAITING_USER_QA` handoff, returns execution to `IDLE`, and retains TASK-014 as next. AGY needs a new direct `START TASK-014`; approval does not modify scripts, approve/commit TASK-014, push, merge or start TASK-015.
- **Target plan version:** v1-approved-r19.

## CR-021 — Simulator Session Issuance & Main-Web Launch for Club Manager and Groom

- **State:** PROPOSED
- **Raised by:** Human Rejection of TASK-015 (`/browser-testing-with-devtools REJECT TASK-015`, R-3), 2026-10-28.
- **Related plan:** v1-approved-r19 / TASK-015.
- **Verified architectural gap:**
  1. In the Backend, simulation session issuance endpoints strictly require Head Trainer or Veterinarian:
     - `POST /api/simulator/workouts/:workoutId/start` requires `@Roles(UserRole.HEAD_TRAINER)`.
     - `POST /api/simulator/horses/:horseId/exams/start` requires `@Roles(UserRole.VETERINARIAN)`.
     - Attempting to call either endpoint as Club Manager or Groom yields HTTP 403 Forbidden.
  2. In the Frontend (Main Web), simulation launch actions only exist in:
     - `src/features/training/pages/TrialRunsPage.tsx` (for Head Trainer trial runs).
     - `src/features/health/pages/RecordFormPage.tsx` (for Veterinarian medical exams).
     - There is zero UI in Main Web for Club Manager or Groom to launch the Simulator.
  3. Consequently, testing a real "Main Web -> Simulator" browser launch flow for Club Manager or Groom is physically impossible without adding new session-issuance endpoints in Backend and launch UI in Frontend.
  4. TASK-015 is currently constrained to a 5-file scope in TASKS.md ("Change BE simulator service/spec or SIM API/mapper tests only for a proven broader cross-role gap"). Adding session issuance routes and Frontend UI buttons exceeds the approved 5-file scope.
  5. As instructed by R-3: "If CM/Groom session issuance or UI launch does not exist within the approved five-file scope, mark TASK-015 BLOCKED and propose a CR with the exact minimum files. Do not invent a query-token workaround."
- **Proposed minimum scope:**
  - Backend (3 files):
    1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.controller.ts`:
       - Allow Club Manager in `startWorkout` or provide dedicated inspection session endpoint `POST /api/simulator/horses/:horseId/inspections/start` for CM and Groom.
       - Allow Groom to issue an inspection simulation session for horses assigned to their active stall.
    2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.ts`:
       - Implement inspection session issuance logic verifying active stall assignment for Grooms and club-wide authority for Club Manager.
    3. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts`:
       - Unit tests for CM and Groom session issuance.
  - Frontend (2 files):
    4. `Racehorse_Training_Management_System_MT_FE/src/features/horses/pages/HorseDetailPage.tsx`:
       - Add Simulator launch button for Club Manager to inspect horse in simulator.
    5. `Racehorse_Training_Management_System_MT_FE/src/features/stalls/pages/StallManagementPage.tsx`:
       - Add Simulator launch button for assigned Groom to inspect assigned horse in simulator.
- **Security & Authorization invariants:**
  - Launch URL must contain `sessionId` only, never `token`.
  - Backend must resolve actor identity from `session.actorUserId` in PostgreSQL.
  - Assigned Groom session must return masked 15-character microchip (`***********XXXX`) and active stall.
  - Full microchip must be visible only to authorized roles (Club Manager, Head Trainer, Veterinarian).
  - Unassigned groom, horse owner, inactive or mismatched actors must fail closed with HTTP 403.
- **Execution impact:** TASK-015 is marked `BLOCKED`. Awaiting ChatGPT architecture review and explicit human approval (`APPROVE CR-021`).
- **Target plan version:** v1-approved-r20 (pending approval).

### Planner correction and human-approved resolution

- **State:** INCORPORATED
- **Human decision:** 2026-10-28 — exact command `APPROVE CR-021` in the current Codex conversation.
- **Clarified product intent:** the Simulator is not a second role-scoped Main Web. Its Groom, Vet, Track and other areas are simulation functions, not authenticated Main-Web personas. Direct Simulator access requires no secondary login and may browse the complete real horse/stall dataset from Backend/PostgreSQL. It must not maintain a duplicate source of truth.
- **Superseded proposal:** do **not** add Club Manager/Groom inspection-session endpoints, role-filtered Groom views, Main-Web CM/Groom launch buttons, a new `INSPECTION` enum, or a schema migration. The proposed five-file issuance/UI expansion above is rejected by this clarification and is retained only as proposal history.
- **Approved runtime boundary:**
  1. Opening canonical `Racehorse_Simulator_Web` without `sessionId` loads the complete real horse/stall catalogue from Backend/PostgreSQL without a login screen or role filtering.
  2. Direct mode may run local simulation interactions, but it may not mutate horse/stall master data or persist an official workout, exam, incident, lock, inventory transaction or other Main-Web business result without the matching Backend-issued workflow/session contract.
  3. A Main-Web-issued `sessionId` remains mandatory only for authoritative write-back. It binds measurements/results to the exact workout, exam or later approved workflow; the URL contains `sessionId` only, never an access/refresh token.
  4. TASK-015 covers real read-only horse/stall catalogue loading, UUID identity, full 15-digit microchip preservation, active-stall mapping, refresh/restart persistence and visible no-fallback failure. It does not implement CM/Groom launch UI or role-filtered Simulator catalogues.
  5. TASK-016 owns workout/trial telemetry and persisted result write-back; TASK-017 owns incident/Vet/Medical Lock synchronization; TASK-018 owns supply request/delivery synchronization. TASK-015 must not pre-implement those paths.
- **Execution gate:** approval removes the CR blocker and incorporates Plan `v1-approved-r20`, but does not resume the blocked execution automatically. State returns to `IDLE`, `next_task` remains TASK-015, and AGY requires a new exact `START TASK-015`. TASK-016 remains unauthorized.
- **Target plan version:** v1-approved-r20.

## CR-022 — TASK-016 Backend Timer, Atomic Abort Transition & Spec Coverage Expansion

- **State:** INCORPORATED
- **Raised by:** Human Rejection of TASK-016 (`REJECT TASK-016`, R-1 to R-5), 2026-10-28.
- **Related plan:** v1-approved-r20 / TASK-016; incorporated into Plan v1-approved-r21.
- **Verified architectural and test gaps:**
  1. `abortSession` in `simulator.service.ts` must perform a conditional atomic transition only from `PENDING` or `RUNNING` status within a database transaction. A delayed disconnect or timeout must never overwrite `COMPLETED` or an existing `ABORTED_INJURY` result.
  2. Concurrent duplicate abort calls, as well as races between normal session finish and delayed abort, must result in exactly one persisted terminal outcome in PostgreSQL and exactly one `sim:session_finished` wire broadcast.
  3. The 5-minute session rule is defined as an absolute running-session watchdog beginning at the first accepted telemetry tick.
  4. Timer lifecycle: normal finish, accepted abort, client reconnect within 15s, and module teardown (`onModuleDestroy`) must clean up applicable timers. Reconnecting within 15 seconds must cancel the pending abort timer and preserve the running session. Expiry of the 15-second disconnect timer must abort exactly once.
  5. The existing Backend test suite (77 tests) does not cover the new timer/concurrency logic.
- **Approved exact scope expansion (2 additional Backend spec files):**
  1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts`
  2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.spec.ts`
  - Total TASK-016 authorized scope expands from 5 to exactly 7 application/test files:
    - 4 application files:
      1. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.ts`
      2. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.ts`
      3. `Racehorse_Simulator_Web/src/ui/TrialTab.tsx`
      4. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/LiveMonitorPage.tsx`
    - 3 test files:
      5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts`
      6. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.service.spec.ts` (CR-022)
      7. `Racehorse_Training_Management_System_MT_BE/src/simulator/simulator.gateway.spec.ts` (CR-022)
- **Required fake-clock and concurrency test coverage:**
  - Reconnect before 15s cancels abort.
  - 15s expiry aborts once.
  - Normal finish cancels disconnect and 5m timers.
  - 5m watchdog aborts once.
  - Duplicate timers do not duplicate persistence or broadcast.
  - Completed session cannot be overwritten by delayed abort.
  - Module destroy clears all active timers.

### Planner and human-approved resolution

- **State:** INCORPORATED
- **Human decision:** 2026-10-28 — exact command `APPROVE CR-022` in current conversation.
- **Incorporated Plan version:** v1-approved-r21.
- **Execution gate:** Approval incorporates Plan v1-approved-r21 and removes the CR-022 blocker. Execution returns to `IDLE` with `next_task: TASK-016`. AGY requires a new direct `START TASK-016` to begin implementation. TASK-017 remains unauthorized.
- **Target plan version:** v1-approved-r21.

## CR-023 — Head Trainer Training Plans/Workouts Ownership Scoping & Trial Runs Date Visibility

- **State:** INCORPORATED
- **Raised by:** Human Rejection of TASK-016 (`REJECT TASK-016`), 2026-10-28.
- **Related plan:** v1-approved-r21 / TASK-016.
- **Verified defect and root causes:**
  1. A newly created trial workout reports success and appears in Weekly Training Calendar, but does not appear on Trial Runs.
  2. Trial Runs displays an actionable workout that fails start with: `"This workout belongs to another trainer."`
  3. Confirmed root causes:
     - `TrainingPlansService.findAllPlans` does not scope `HEAD_TRAINER` by `trainerUserId`.
     - `WorkoutsService.findAllWorkouts` and `findTrialRuns` do not scope `HEAD_TRAINER` by `trainingPlan.trainerUserId`.
     - `createWorkout` does not reject a plan owned by another Head Trainer.
     - `TrialRunsPage` renders Run simulation for every `SCHEDULED` row returned to a `HEAD_TRAINER`.
     - `TrialRunsPage` ignores the created date passed through `onSaved(date)` and reloads only the previous from/to filter.
- **Proposed exact additional files (4 files):**
  1. `Racehorse_Training_Management_System_MT_BE/src/training/training-plans.service.ts`
  2. `Racehorse_Training_Management_System_MT_BE/src/training/workouts.service.ts`
  3. `Racehorse_Training_Management_System_MT_BE/src/training/training-services.spec.ts`
  4. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/TrialRunsPage.tsx`
  - *Note:* The already-authorized test file `Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts` will be extended to cover the multi-trainer boundary.
- **Required contract for CR-023:**
  1. Head Trainer horse master-data visibility remains unchanged.
  2. Head Trainer training plans, workouts, and trial runs are strictly scoped to `trainingPlan.trainerUserId === current userId`.
  3. Club Manager and Veterinarian read visibility remains unchanged.
  4. Creating a workout or repeated workout against another trainer's plan must fail closed (403/Forbidden).
  5. Direct mutation/start requests for another trainer's workout must fail closed.
  6. Trial Runs must not render an actionable simulation row belonging to another trainer.
  7. After successful creation, the created trial must be visible immediately. If its date is outside the current filter, update/expand the filter to include that date before reload.
  8. Do not hide Backend authorization errors as a substitute for correct query scoping.
- **Required browser coverage:**
  - Using two real Head Trainer accounts and real PostgreSQL:
    - Trainer A sees and can start only Trainer A trials.
    - Trainer B trials do not appear in Trainer A Trial Runs.
    - Direct API start/create/mutation against Trainer B plan/workout is rejected.
    - Creating a new TRIAL from Trial Runs makes the exact created row visible immediately and after reload.
    - Weekly Calendar and Trial Runs show the same created TRIAL identity.
    - Preserve TASK-016 telemetry, emergency stop, reconnect, and atomic terminal tests.
- **Execution gate:**
  - Approval incorporates Plan v1-approved-r22 and removes the CR-023 blocker. Execution returns to `IDLE` with `next_task: TASK-016`. AGY requires a new direct `START TASK-016` to begin implementation of the expanded 11-file scope. TASK-017 remains unauthorized.
- **Target plan version:** v1-approved-r22.

### Planner and human-approved resolution

- **State:** INCORPORATED
- **Human decision:** 2026-10-28 — exact command `APPROVE CR-023` in current conversation.
- **Incorporated Plan version:** v1-approved-r22.
- **Execution gate:** Approval incorporates Plan v1-approved-r22 and removes the CR-023 blocker. Execution returns to `IDLE` with `next_task: TASK-016`. AGY requires a new direct `START TASK-016` to begin implementation of the expanded 11-file scope. TASK-017 remains unauthorized.
- **Target plan version:** v1-approved-r22.

## CR-024 — Unified Web-Simulator Supply Replenishment & Delivery Coordination Contract

> Planner revision dated 2026-10-29 is appended below this proposal and supersedes conflicting design and scope in sections 2–6. State remains PROPOSED; no implementation authority is granted.

- **State:** PROPOSED
- **Raised by:** Human Rejection of TASK-018 (`REJECT TASK-018`), 2026-10-29.
- **Related plan:** v1-approved-r22 / TASK-018.

### 1. Verified Defect & Root Cause Analysis

1. **Independent Disconnected Inventories:**
   - Simulator `src/sim/inventory.ts` currently maintains an independent mock catalog (`HAY`, `FEED`, `BEDDING`, `MEDS`, `SHOES`), mock capacities, and simulated local consumption. It does not read from or synchronize with the Backend/PostgreSQL system of record (`SupplyCatalog`, `StallZone`, `StockBalance`).
2. **Missing Automated Delivery Trigger upon CM Approval:**
   - On the Main Web, when Club Manager approves a restock request, the request transitions to `APPROVED`. Backend does not broadcast a delivery dispatch event to Simulator, and no delivery truck is automatically triggered.
3. **Manual Delivery Confirmation on Web Decoupled from Simulator Animation:**
   - Completion of delivery currently requires Club Manager to manually click "Confirm Receipt" in Main Web. The Simulator's truck animation does not decide or acknowledge order completion to the Backend.
4. **Test & Workflow Disconnect:**
   - The initial E2E test placed an order for oats on Web and separately ordered hay inside Simulator, failing to prove a single end-to-end unified workflow.
5. **Notification Cleanup Over-reach:**
   - Global notification cleanup could inadvertently delete restock notifications belonging to concurrent requests.

### 2. Confirmed Product Requirements & Specification

1. **Requester Workflow:** Groom submits restock proposal on Web (`POST /api/inventory/requests`). Initial state: `PENDING`.
2. **Club Manager Approval & Automatic Dispatch:**
   - Club Manager reviews and approves proposal on Web (`POST /api/inventory/requests/:id/review`).
   - Backend transitions state to `DELIVERING` (ĐANG GIAO).
   - Backend broadcasts WebSocket event `sys:supply_delivery_start` via Socket.IO containing: `requestId`, `requestNumber`, `zoneId`, `supplyId`, `supplyCode`, `supplyName`, `approvedQuantity`, `unit`, `dispatchedAt`, and `timeoutSeconds: 20`.
   - Backend starts an in-memory 20-second watchdog timer for this `requestId`.
3. **Simulator Real-Time Delivery Animation:**
   - Connected Simulator client automatically receives `sys:supply_delivery_start`.
   - Simulator spawns delivery truck animation (~8s) for that specific `requestId`, `zoneId`, `supplyId`, and `approvedQuantity` without requiring any manual "Order" click.
   - When the truck arrives at the warehouse (~8 seconds), Simulator emits ACK packet `sim:supply_delivery_ack` with `requestId` back to Backend.
4. **Backend Exactly-Once Stock Balance Increment:**
   - When Backend receives `sim:supply_delivery_ack` (or when the 20-second watchdog timer expires if Simulator is offline/disconnected):
     - Executes an atomic interactive database transaction (`prisma.$transaction`).
     - Conditional state transition: `RestockRequest.updateMany({ where: { id: requestId, status: RestockStatus.DELIVERING }, data: { status: RestockStatus.DELIVERED, deliveredAt: new Date() } })`.
     - If `count === 0` (due to duplicate ACK, late ACK after timeout, or concurrent tab), the request safely no-ops.
     - If `count === 1`, Backend cancels the active watchdog timer, increments PostgreSQL `StockBalance.quantity` by `approvedQuantity`, creates audit log, and notifies the requester Groom.
   - Main Web reflects `DELIVERED` (ĐÃ GIAO) automatically upon refresh or refetch.
5. **Offline & Fallback Handling (20s Rule):**
   - If Simulator is not connected or fails to ACK within 20s, the Backend 20s watchdog timer fires, transitions request to `DELIVERED`, and increments inventory balance.
   - If Backend restarts while a request is in `DELIVERING`:
     - On module bootstrap, Backend queries all requests in `DELIVERING`.
     - If `now - reviewedAt >= 20s`, completes delivery immediately.
     - If `now - reviewedAt < 20s`, reschedules watchdog timer for remaining duration.
6. **Unified Master Data & Reconnection:**
   - Web and Simulator share identical catalogue, units, stock balances, and capacities from PostgreSQL (`GET /api/inventory`). Local mock inventory in Simulator is eliminated.
   - When Simulator reconnects or reloads, it queries active deliveries (`GET /api/inventory/active-deliveries`) to recover ongoing deliveries if within animation window.
7. **Role Exclusivity:**
   - Approval remains exclusively Club Manager (`CLUB_MANAGER`).
   - Simulator ACK only finalizes an already-authorized `DELIVERING` request; it cannot initiate, approve, or arbitrarily alter delivery quantities.

### 3. State Machine & Event Contracts

- **RestockStatus Transitions:**
  - `PENDING` -> `DELIVERING` (via Club Manager approval)
  - `PENDING` -> `REJECTED` (via Club Manager rejection)
  - `DELIVERING` -> `DELIVERED` (via Simulator `sim:supply_delivery_ack` OR Backend 20s watchdog timer)
  - `DELIVERED` -> `[]` (Terminal)
  - `REJECTED` -> `[]` (Terminal)

- **Socket.IO Event Contracts:**
  - `sys:supply_delivery_start`:
    ```json
    {
      "requestId": "uuid",
      "requestNumber": "REQ-2610-0003",
      "zoneId": "uuid",
      "supplyId": "uuid",
      "supplyCode": "SUP_GRAIN_OATS",
      "supplyName": "Yến mạch cán vỡ",
      "approvedQuantity": 20,
      "unit": "KG",
      "dispatchedAt": "2026-10-29T06:00:00.000Z",
      "timeoutSeconds": 20
    }
    ```
  - `sim:supply_delivery_ack`:
    ```json
    {
      "requestId": "uuid",
      "completedAt": "2026-10-29T06:00:08.000Z"
    }
    ```

### 4. Schema & Migration Impact

- **Database Enum `RestockStatus`:**
  - Add value `DELIVERING` to enum `RestockStatus`.
  - Non-destructive Prisma migration: `ALTER TYPE "RestockStatus" ADD VALUE 'DELIVERING';`.

### 5. Exact File Scope Budget (12 application & test files)

- **Backend (`Racehorse_Training_Management_System_MT_BE`) — 5 files:**
  1. `prisma/schema.prisma` (Add `DELIVERING` to `RestockStatus` enum).
  2. `src/inventory/inventory.service.ts` (Implement `DELIVERING` state, watchdog timer Map, restart recovery hook, and exactly-once delivery completion).
  3. `src/simulator/simulator.gateway.ts` (Broadcast `sys:supply_delivery_start` and handle `sim:supply_delivery_ack`).
  4. `src/inventory/inventory.controller.ts` (Add endpoint for active deliveries and query scoping for Simulator).
  5. `src/inventory/inventory.service.spec.ts` (Unit tests for 20s watchdog, restart recovery, ACK vs timeout concurrency, and exactly-once stock increment).

- **Frontend (`Racehorse_Training_Management_System_MT_FE`) — 3 files:**
  6. `src/features/stable/pages/RestockRequestsPage.tsx` (Display `DELIVERING` badge; remove manual CM confirm button; auto-refresh/reflect `DELIVERED` status).
  7. `src/features/stable/types/inventory.ts` (Add `DELIVERING` to frontend type definitions).
  8. `tests/e2e/simulator-real-stack.spec.ts` (Real-stack E2E test verifying: Groom creates proposal -> CM approves -> Simulator receives socket event and animates truck 8s -> Simulator sends ACK -> Web updates to `DELIVERED` and DB stock increments exactly once; plus fallback timeout test and safe notification cleanup).

- **Canonical Simulator (`Racehorse_Simulator_Web`) — 4 files:**
  9. `src/sim/inventory.ts` (Bind inventory state to Backend API; handle inbound delivery orders from Backend socket).
  10. `src/ui/SupplyPanel.tsx` (Display real Backend catalog items, units, and PostgreSQL stock balances).
  11. `src/hub/socketTransport.ts` (Listen for `sys:supply_delivery_start`, track animation completion, and emit `sim:supply_delivery_ack`).
  12. `src/sim/inventory.test.ts` (Unit tests for socket delivery receipt, duplicate event deduplication, and ACK emission).

### 6. Execution Gate

- Approval of CR-024 incorporates the proposed architecture into the canonical plan.
- TASK-018 is currently marked `BLOCKED` with `pending_change: CR-024`.
- Implementation, schema migration, or testing requires an explicit human command `START TASK-018` after CR-024 is approved.
- TASK-019 remains unauthorized.

### 7. ChatGPT planner revision — definitive proposal awaiting Human approval (2026-10-29)

**Approval outcome — ACCEPTED on 2026-10-29 by exact human command `APPROVE CR-024`, received by ChatGPT Planner.** This section is incorporated into v1-approved-r23, superseding conflicting proposal sections above. PROPOSED/pending statements are historical. TASK-018 is TODO, execution IDLE, awaiting fresh START TASK-018. Approval does not execute migration, approve task completion or authorize commit/push.

This revision supersedes conflicting sections 2–6 above. It does not amend the approved r22 plan until `APPROVE CR-024`. Proposed next revision: `v1-approved-r23`. TASK-018 remains BLOCKED, pending CR-024; a fresh `START TASK-018` is required after approval. No application code, migration execution, commit or later-task work is authorized by drafting this section.

#### A. Product lifecycle and persisted authority

- New requests: `PENDING -> DELIVERING` only on explicit Club Manager approval; rejection remains `PENDING -> REJECTED`. Completion is `DELIVERING -> DELIVERED` through authorized animation ACK or server fallback. Terminal states stay terminal.
- Approval atomically records approved quantity, reviewing Manager, and `reviewedAt` as the dispatch timestamp. Quantity cannot be changed by Simulator. Main Web immediately shows Dang giao, with no manual confirmation required for newly dispatched requests.
- Simulator direct access remains login-free and loads a read-only supply snapshot. It automatically animates the exact approved request, zone, supply and quantity for 8 wall-clock seconds from persisted dispatch time, independent of simulation speed/pause. It never locally orders, fills or consumes official stock.
- Delivery completion transaction increments stock exactly once by approved quantity, records deliveredAt and attributes authorization to the approving Manager; audit also records completion source ACK/FALLBACK. Broadcast and requester notification occur after commit. Web refetches while deliveries are active (bounded polling <=2s is sufficient), and Simulator refetches on completion/focus/reconnect. Both display persisted stock, never an optimistic fabricated balance.
- Keep legacy APPROVED rows unchanged. The existing CM-only manual receipt endpoint/UI remains available ONLY for those legacy rows; startup must not auto-dispatch them. New approvals bypass APPROVED and use the automatic flow. This avoids a bulk data migration or accidental delivery of old orders.

#### B. Data contract and capacity

- PostgreSQL SupplyCatalog and StockBalance are authoritative. Identity is `(zoneId, supplyId)`, with supply code/name/category/unit, exact quantity and minThreshold. No fixed five-item catalogue, random stock, invented unit, local consumption or default capacity in runtime.
- Add nullable Decimal(12,2) `StockBalance.capacity`, in the same unit as the supply. Existing rows remain NULL, interpreted as UNCONFIGURED capacity rather than zero or an invented physical limit. UI shows quantity and 'capacity not configured' without a percentage meter. Positive configured capacity must be enforced; this CR does not introduce a capacity-management UI or invent fixture-independent values.
- Retain validation of finite positive quantities and valid active supply/zone. Remove the arbitrary universal 10000 ceiling from TASK-018 changes. Serialize Decimal values consistently with the existing API contract.
- Approval and any manual stock adjustment/delivery must serialize on the zone row (including first balance creation), then inspect the relevant zone/supply balance and reserved DELIVERING quantities. When capacity exists, `balance + pending delivery reservations + newly approved quantity <= capacity`. Legacy receipt and direct stock increases must honor existing reservations too. No oversell through two different requests or a concurrent stock adjustment. Consistent lock ordering prevents deadlocks.
- Additive migration file `prisma/migrations/20261029010000_supply_delivery_sync/migration.sql` adds DELIVERING and nullable capacity; no reset, truncate, seed replacement, destructive enum rewrite or automatic APPROVED conversion. Use the repository's migration workflow after the separately authorized START; migration SQL must be reviewed before applying to the named local DB. Never run migrate reset/db push as a substitute.

#### C. Dedicated supply connection and bounded ACK authority

- Add an Inventory-owned Socket.IO gateway on `/supplies`; do not change `/simulator` handshake, workout/exam guards or session types. InventoryModule registers it and it delegates business operations to InventoryService. Avoid InventoryModule/SimulatorModule circular imports.
- Supply REST snapshot is a deliberately public read-only projection for direct Simulator use, under `/api/inventory/simulator/context`; expose catalogue/zone stock and active deliveries only, without requester PII, account data or write credentials. Existing authenticated inventory endpoints retain RBAC. Supply socket is read/ACK only and cannot create/approve/change quantity/master data.
- For each DELIVERING request, the Backend issues an opaque signed capability scoped to purpose SUPPLY_DELIVERY_ACK, exact requestId and dispatch timestamp, expiring no later than dispatch+20s. Reuse existing signing infrastructure; no new dependency, schema-stored secret or access token in URL/localStorage. Capability travels only in the local supply socket dispatch/recovery payload, remains in memory, and is excluded from logs/screenshots. This is a narrow local Simulator capability, not human identity or a claim of strong access isolation for the public demo.
- `sys:supply_delivery_start`: requestId, requestNumber, zoneId, supplyId, code/name/unit, approvedQuantity, dispatchedAt, animationEndsAt, fallbackAt and ackCapability. `sim:supply_delivery_ack`: requestId and ackCapability; client completedAt is not authoritative. Validate payload shape, capability signature/purpose/binding/expiry and persisted DELIVERING status before mutation. Reject early ACK before dispatch+8s. Valid duplicate/late terminal ACK is an idempotent response without increment; unknown/invalid credentials never mutate.
- On supply socket connect/reconnect, reissue capabilities for still-active deliveries and send the active snapshot after subscription is established. Reconcile buffered events by requestId and persisted state so a snapshot/event race cannot lose a dispatch. Multiple tabs may animate but completion is unique. New deliveries arriving during a trip retain their own deadlines; do not silently merge quantities or ACK an order before its 8s deadline. Already DELIVERED requests refresh stock and do not replay as new deliveries.
- `sys:supply_delivery_completed` contains requestId, zoneId, supplyId, status and authoritative resulting balance after commit. No capability in completion messages. Backend/DB/network failure surfaces visibly without mock fallback.

#### D. Transactions, watchdog and recovery

- One shared completion method handles ACK, fallback and recovery. Lock the zone consistently, conditionally transition DELIVERING -> DELIVERED and increment the balance inside the same transaction. A zero transition count is a no-op. Neither a duplicate ACK nor two different worker processes may double credit.
- Only after successful commit clear the request timer and emit completion/notification. On rollback retain/re-arm recovery; never mark DELIVERED without the increment. Notification failure must not reverse stock credit or cause duplicate credit on retry; report failure and retain existing dedupe practices.
- Server fallback is the absolute deadline reviewedAt+20s, independent of browser animation/clock. Startup scans persisted DELIVERING rows, completes overdue rows and re-arms remaining time. Add a bounded periodic recovery sweep for failed timer completions; module shutdown clears timers. No fallback implementation solely inside browser inventory.ts.
- Backend downtime can delay delivery beyond 20s; recovery completes overdue requests when service resumes. UI must show the persisted state honestly.

#### E. Proposed exact scope — replaces the unsupported per-repository five-file interpretation

TASK-018 remains ONE task with sequential implementation slices and ONE combined Human QA gate. Proposed total: 21 application/test/migration paths across the workspace; coordination docs/report excluded. Includes every currently dirty TASK-018 application file, even those retained only to undo incidental changes. A further path requires a new scope review before editing.

Backend (8):
1. `prisma/schema.prisma`
2. `prisma/migrations/20261029010000_supply_delivery_sync/migration.sql` (new)
3. `src/inventory/inventory.service.ts`
4. `src/inventory/inventory.service.spec.ts`
5. `src/inventory/inventory.controller.ts`
6. `src/inventory/inventory.module.ts`
7. `src/inventory/supply-delivery.gateway.ts` (new)
8. `src/inventory/supply-delivery.gateway.spec.ts` (new)

Frontend (3):
9. `src/features/stable/pages/RestockRequestsPage.tsx`
10. `src/features/stable/types/inventory.ts`
11. `tests/e2e/simulator-real-stack.spec.ts`

Canonical Simulator (10):
12. `src/sim/inventory.ts`
13. `src/sim/inventory.test.ts`
14. `src/ui/SupplyPanel.tsx`
15. `src/ui/FarmHub.tsx`
16. `src/ui/App.tsx`
17. `src/main.tsx` (retain/reconcile existing TASK-018 change only)
18. `src/api/inventoryApi.ts` (new, reuse API base/error conventions)
19. `src/api/inventoryApi.test.ts` (new)
20. `src/sim/supplyTransport.ts` (new, dedicated namespace)
21. `src/sim/supplyTransport.test.ts` (new)

The existing workout/exam socketTransport and gateway are verification-only. No dependency, root launcher, reference _v3, horse/medical flow or unrelated asset work. Preserve NOW1.txt, NOW2.txt and music/; do not include them in TASK-018 delivery.

#### F. Required proof and manual handoff

- Sequential slices: A Backend schema/contracts/transaction/recovery; B Simulator real snapshot/dispatch/animation/ACK; C Web display and combined browser acceptance. No slice is independently approved or a license to start TASK-019.
- Unit/fake-clock proof: 8s early-ACK rejection, 20s offline fallback, restart before/after deadline, transaction rollback/retry, duplicate/replayed/foreign capability, ACK vs timeout race, two requests sharing a stock balance, capacity reservations, legacy APPROVED compatibility, timer teardown.
- Real-stack browser proof on both viewports: Groom creates ONE uniquely identified request; Simulator already open; CM approves; UI shows DELIVERING; matching supply/zone/quantity animates automatically; stock remains unchanged before completion; ACK completes and DB/Web/SIM agree exactly once. No separate Simulator order click, conditional skip or unrelated HAY substitute counts as acceptance.
- Also prove multi-tab/reconnect, offline fallback and Backend restart recovery, invalid/early ACK, and visible Backend-down failure. Isolated unit mocks are permitted; runtime/E2E request interception or fake data are not.
- E2E fixtures use named QA data and exact captured IDs/markers. Cleanup preserves concurrent unrelated notifications/audits, restores all affected baseline fields and asserts residue; include sentinel proof. Never delete global newly created rows by notIn baseline IDs.
- Run BE focused tests/typecheck/lint, FE typecheck/lint and real-stack browser tests, SIM tests/typecheck/build, diff hygiene and historical evidence integrity. Report each check actually run, residual risk and migration applied/not applied.
- Human handoff must identify exact QA request/zone/supply, expected quantity and starting stock, actor accounts and URLs. Human needs only reload existing pages, submit/approve, watch automatic truck, then compare persisted balances. Finish AWAITING_USER_QA and STOP.

## CR-025 — Include existing Simulator sound dependencies in TASK-018 delivery

**Approval outcome: ACCEPTED by exact human command `APPROVE CR-025` received by ChatGPT Planner on 2026-10-29. Incorporated into v1-approved-r24. Earlier PROPOSED/pending wording below is proposal history. Execution IDLE, TASK-018 TODO awaiting fresh START TASK-018; no task completion or commit authority.**

- **State:** PROPOSED by ChatGPT Planner, 2026-10-29; awaiting explicit APPROVE CR-025.
- **Human request:** "thế thì bạn điều chỉnh bổ sung đi, vì đúng là cái này nằm ngoài nhưng mà chỉ có phần sound thêm vào sim thôi mà ?"
- **Reason:** Existing user audio work is integrated into App/FarmHub and delivery interactions. Excluding the imported audio manager/control while committing those callers produces an incomplete Simulator checkout. Preserve and include the existing sound feature rather than mechanically splitting its callers.
- **Plan impact upon approval:** proposed v1-approved-r24; TASK-018 remains one task. No Backend/schema/FE change beyond existing CR-024 scope. No task approval, commit or START TASK-019 authority is implied.

### Included behavior
- Existing looping music, intro/UI/building/delivery SFX and music/SFX enable/volume controls with local preference persistence.
- Reuse current HTMLAudioElement implementation and existing assets. No dependency, new music generation, new sound feature or redesign.
- Audio must never block launch, animation, delivery ACK/fallback, stock persistence or accessibility. Missing files, autoplay rejection, unavailable storage or invalid saved settings must fail gracefully. Volume is finite and bounded 0..1.
- Start playback through a browser-permitted user interaction; no assumption that first page load can play audio. Settings remain operable by keyboard with accessible labels, Escape dismissal and visible focus.
- Sound must not duplicate on refetch/reconnect or create overlapping background loops/listeners. Verify mount/unmount cleanup and one delivery sound sequence per logical delivery.

### Exact additional scope (18 paths)
Existing CR-024 App.tsx, FarmHub.tsx and main.tsx can retain their sound integration; already included in the original 21 paths.
Additional source/test paths:
1. SIM src/audio/audioManager.ts
2. SIM src/audio/audioManager.test.ts (new focused test)
3. SIM src/ui/AudioControl.tsx
4. SIM src/ui/FarmMapCanvas.tsx
5. SIM src/ui/IntroOverlay.tsx
6. SIM src/ui/Popup.tsx

Additional runtime assets under canonical Simulator public/audio/:
7. theme-main.mp3
8. ui-click.wav
9. building-select.wav
10. building-open.wav
11. ui-close.wav
12. ui-success.wav
13. ui-error.wav
14. intro-cloud-whoosh.wav
15. intro-logo-reveal.wav
16. delivery-vehicle-arrive.wav
17. delivery-stop.wav
18. delivery-complete.wav

Combined TASK-018 scope becomes 39 application/test/migration/asset paths (21 CR-024 + 18 CR-025); coordination/report excluded. Keep the unused 34.6 MB public/audio/theme-main.wav, source music/ copies and variants, generation scripts, NOW1.txt and NOW2.txt intact locally but out of this delivery. Do not delete them. Report origin/usage permission of existing user-provided assets; do not invent provenance.

### Verification and commit boundary
- Verify every runtime audio URL exists in the staged tree and production build, with no dependency on untracked local source files.
- Run Simulator tests/typecheck/build, focused audio tests (mock browser APIs only in isolated tests), and browser smoke: fresh load/autoplay blocked, user activation, mute/unmute, volume/reload persistence, popup/intro and delivery sound without duplicate music or ACK delay.
- Re-run the existing real-stack TASK-018 supply acceptance with sound enabled and disabled. Preserve concurrent user data and existing evidence.
- Document the combined file manifest and actual results in TASK-018 report. Once Human QA approves TASK-018 and separately authorizes commit, create a self-contained Simulator commit including both supply and approved audio files; no blanket git add.
- Until APPROVE CR-025, this is a proposal only. Do not implement new audio changes, commit or discard user work. On approval reconcile the plan/task scope and require a fresh START TASK-018 for final combined verification, then AWAITING_USER_QA and STOP.
