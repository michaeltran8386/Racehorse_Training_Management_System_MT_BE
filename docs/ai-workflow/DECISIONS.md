# Architecture Decision Log

> Plan revision hiện hành là v1-approved-r11, approved by `APPROVE PLAN v1` and amended through approved CR-012 on 2026-10-25. Quyết định mới hoặc thay đổi scope vẫn phải mở CR.

## ADR-001 — Backend là system of record
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Evidence:** Prisma đang quản lý horse, sessions, incidents, locks và inventory; Simulator có local mock/engine.
- **Decision:** Backend/PostgreSQL giữ dữ liệu bền vững; Simulator không tạo nguồn dữ liệu cạnh tranh.
- **Trade-off:** real mode phụ thuộc Backend; mock mode vẫn giữ cho test/demo cô lập.
- **Impacted tasks:** TASK-011–019.

## ADR-002 — Canonical Simulator là Git repo không hậu tố
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Alternatives:** chạy `_v3`; thay nguyên repo; transplant kiểm soát.
- **Decision:** `Racehorse_Simulator_Web/` là source duy nhất; transplant theo lát cắt từ `_v3`.
- **Reasoning:** giữ lịch sử Git và thay đổi microchip mới hơn trong canonical repo.
- **Trade-off:** cần nhiều task reconcile thay vì copy lớn.
- **Impacted tasks:** TASK-011–014.

## ADR-003 — Simulator không có secondary login
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Evidence:** quyết định trong `CLAUDE.md` ngày 23/10/2026; `_v3` còn luồng login trực tiếp cũ.
- **Decision:** Main Web tạo/nhận session rồi mở Simulator; Simulator bootstrap bằng session ngắn hạn, không có form login hoặc access token dài hạn trong URL/localStorage.
- **Trade-off:** phải xử lý expired/forbidden session rõ ràng.
- **Impacted tasks:** TASK-013, TASK-015–018.

## ADR-004 — Quyền actor dựa trên ownership và role guard
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24; refined by CR-005
- **Decision:** Club Manager sở hữu horse master data/tournament/account; Head Trainer sở hữu training và race entries/results; Vet sở hữu medical/lock; Groom và Owner bị scope theo assignment/ownership. Self-profile không sửa permission.
- **Supply decision:** chỉ Club Manager create/update/toggle Supply Catalog; Groom chỉ view và tạo restock request khi thiếu.
- **Impacted tasks:** TASK-001–007.

## ADR-005 — Không thêm trạng thái “bảo trì” cho tournament
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Decision:** dùng `CLOSED_REGISTRATION` để đóng đăng ký, `CANCELLED` để hủy, `COMPLETED` để giữ lịch sử; hard delete chỉ với giải chưa có registration/result.
- **Reasoning:** enum/service hiện có đủ biểu diễn vòng đời; `MAINTENANCE` không có nghĩa nghiệp vụ rõ.
- **Impacted tasks:** TASK-003.

## ADR-006 — REST command + Socket.IO realtime
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Decision:** REST cho bootstrap/command/snapshot; `/simulator` Socket.IO cho telemetry/event/lock sync; packet idempotent và có ACK.
- **Impacted tasks:** TASK-011–018.

## ADR-007 — Chấn thương không tự tạo hồ sơ hoặc lock
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE CR-001` on 2026-10-23
- **Decision:** catastrophic incident dừng session; Vet xác nhận rồi mới tạo medical record/lock bằng thao tác người dùng.
- **Impacted tasks:** TASK-009, TASK-017.

## ADR-008 — Human-gated, one-task delivery
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Decision:** plan approval không khởi chạy AGY; mỗi `START TASK-XXX` chỉ cho đúng một task; kết thúc tại `AWAITING_USER_QA`.
- **Impacted tasks:** tất cả.

## ADR-009 — Phạm vi sử dụng `srsv4.txt`
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Decision:** dùng phần 1, 2, 4, 5, 6 và 7 làm đặc tả; không dùng phần 3 “CÁC LUỒNG NGHIỆP VỤ CỦA HỆ THỐNG” để sinh requirement/task.
- **Reasoning:** chỉ thị trực tiếp của người dùng; tránh trộn phần workflow bị loại vào Plan sửa đổi.
- **Impacted tasks:** tất cả.

## ADR-010 — Thứ tự delivery WEB → SIM → ĐỒNG BỘ
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE PLAN v1` on 2026-10-24
- **Decision:** hoàn tất các task Web trước, sau đó canonicalize Simulator, cuối cùng mới thực hiện các lát cắt đồng bộ hai chiều.
- **Trade-off:** integration được kiểm chứng muộn hơn nhưng authority/RBAC và hai đầu hệ thống ổn định trước khi nối.
- **Impacted tasks:** tất cả.

## ADR-011 — Workflow canonical nằm trong Backend repository
- **Date:** 2026-10-23
- **Status:** ACCEPTED by `APPROVE CR-003` on 2026-10-23
- **Decision:** `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/` là nguồn coordination authoritative được Git theo dõi; root `docs/ai-workflow/` chỉ là local mirror `NON-CANONICAL`.
- **Alternatives rejected:** nested Git repo ở root, submodule và remote orchestration mới.
- **Trade-off:** workflow gắn với lịch sử Backend; clone khác chỉ nhận được sau commit/push được cho phép riêng.
- **Operational note:** worktree có thể cô lập checkout nhưng không thay thế canonical repository hoặc Git synchronization.
- **Impacted tasks:** governance cho tất cả task; không đổi application runtime.

## ADR-012 — `editHorses` là quyền role-owned của Club Manager
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-005` on 2026-10-24
- **Decision:** FE và BE khai báo `editHorses` với `ownerRoles: [CLUB_MANAGER]`. Permission lưu cũ hoặc gửi mới của non-CM phải normalize về `false`; Backend role guard vẫn là authority cuối cùng.
- **Boundary:** horse master create/edit/transfer/delete/restore chỉ thuộc Club Manager. Operational status transitions được `horse-rules.ts` cho phép cho Head Trainer và medical transitions của Vet không bị thu hồi bởi quyết định này.
- **Data consequence:** không cần migration phá hủy; raw JSON cũ có thể tồn tại nhưng không được expose thành effective authority.
- **Impacted tasks:** TASK-002; regression coverage của TASK-001.

## ADR-013 — Tournament Close/Cancel không được mở lại
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-006` on 2026-10-24
- **Decision:** `CLOSED_REGISTRATION` không chuyển lại `OPEN_REGISTRATION`; nó chỉ có thể chuyển sang `CANCELLED` hoặc đạt `COMPLETED` qua quy trình ghi đủ và khóa kết quả. `CANCELLED` và `COMPLETED` là terminal. Muốn tổ chức lại giải đã hủy phải tạo giải mới.
- **Safety boundary:** không expose `handleMock` hoặc test-only entry point qua `window` trong application runtime; bằng chứng gọi mock handler phải được mô tả đúng là mock evidence, không phải HTTP evidence.
- **Impacted task:** TASK-003.

## ADR-014 — Result modal dùng một transactional request để lưu và khóa
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-007` on 2026-10-24
- **Decision:** `RecordResultsModal` gọi `recordRaceResults(tournament.id, resultsPayload, lock)` đúng một lần. Khi `lock` là true, `/results` chịu trách nhiệm lưu toàn bộ kết quả và chuyển giải sang `COMPLETED` trong transaction hiện có; client không gọi tiếp `/lock-results`.
- **Reasoning:** lời gọi thứ hai chỉ cố khóa lại một giải đã completed, tạo lỗi UI giả sau khi server đã commit thành công. Giữ một request tránh partial client flow mà không đổi API hoặc Backend.
- **Impacted task:** TASK-003.

## ADR-015 — Kết quả giải đua thuộc độc quyền Club Manager
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-008` on 2026-10-24
- **Decision:** Head Trainer được xem eligibility, đăng ký và rút/scratch ngựa, đồng thời xem kết quả đã công bố. Chỉ Club Manager được ghi, sửa và khóa kết quả cũng như quản lý vòng đời giải.
- **Enforcement:** controller, service và mock đều từ chối HT trên `/tournaments/:id/results`; service guard phải chạy trước mọi result write, audit, status change hoặc prize allocation. UI không hiển thị result-entry action cho HT.
- **Data consequence:** giữ nguyên draft result đã tồn tại; chỉ Club Manager tiếp tục xử lý chúng. Không có migration hoặc direct DB cleanup.
- **Impacted tasks:** TASK-003, TASK-004.

## ADR-016 — Ma trận thời điểm đăng ký, scratch và kết quả
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-009` on 2026-10-24
- **Decision:** đăng ký chỉ ở OPEN; scratch có lý do ở OPEN hoặc CLOSED trước terminal state; không ghi/khóa kết quả trước CLOSED hoặc trước `raceDate`; chỉ result locking của CM chuyển CLOSED thành COMPLETED.
- **UI/Test consequence:** dùng `RaceRegistrationModal` để thực hiện registration và scratch thật; Save Draft phải giữ CLOSED; regression lock phải chứng minh không gọi `/lock-results` lần hai mà không expose runtime test hook.
- **Data consequence:** không tự xóa hay sửa test residue từ revision cũ; mọi cleanup cần đi qua application policy hoặc một quyết định riêng.
- **Impacted task:** TASK-003.

## ADR-017 — Runtime và integration chỉ dùng API/PostgreSQL thật
- **Date:** 2026-10-24
- **Status:** ACCEPTED by `APPROVE CR-010` on 2026-10-24
- **Decision:** Main Web và Simulator không có runtime mock mode hoặc fallback. Manual QA, browser/API integration và final acceptance phải chạy qua NestJS API với dữ liệu PostgreSQL thật. Mock/fake chỉ được phép trong unit test cô lập và không được import/reachable từ application runtime.
- **Failure behavior:** khi Backend/PostgreSQL không sẵn sàng, client hiển thị lỗi rõ ràng và không tạo dữ liệu mẫu hoặc giả lập thành công.
- **Evidence:** Network request tới Backend, DB before/after, persistence sau restart và negative failure check; mock-backed Playwright không phải integration evidence.
- **Impacted tasks:** TASK-003 QA, TASK-010, TASK-013–019.

## ADR-018 — Horse Owner tournament detail được lọc theo ownership tại Backend
- **Date:** 2026-10-25
- **Status:** ACCEPTED by `APPROVE CR-011` on 2026-10-25
- **Context:** real-stack review chứng minh `GET /api/tournaments/:id` trả foreign registrations/results và owner PII cho Horse Owner vì controller không truyền caller và service trả toàn bộ registrations.
- **Decision:** controller truyền authenticated `CurrentUserPayload`; khi caller là `HORSE_OWNER`, service ràng buộc Prisma query theo `horse.ownerId = user.userId`. Tournament metadata vẫn được trả, nhưng response không chứa foreign registration, result hoặc owner PII. Hành vi hiện tại của các role không phải Horse Owner không đổi trong CR này.
- **Trade-off:** TASK-007 tăng từ giới hạn 5 lên đúng 7 application/test files để chứa controller, service và regression spec; file thứ tám cần CR mới.
- **Impacted task:** TASK-007.

## ADR-019 — TASK-010 hoàn tất real-only cutover bằng hai slice tuần tự
- **Date:** 2026-10-25
- **Status:** ACCEPTED by `APPROVE CR-012` on 2026-10-25
- **Decision:** TASK-010 vẫn là một task human-gated, được thực hiện bằng hai slice tuần tự, mỗi slice đúng 5 tệp. Slice A giữ các thay đổi Medical Lock/runtime hiện có; Slice B loại nhánh/cấu hình/hướng dẫn mock runtime còn lại trong năm tệp FE đã liệt kê. Chỉ nghiệm thu và phê duyệt TASK-010 sau khi cả hai slice cùng vượt qua acceptance real-stack.
- **CI boundary:** build artifact phải real-only và không có `VITE_USE_MOCK`. Standalone FE CI không có Backend/PostgreSQL phải công khai defer integration Playwright; không được bật mock để tạo kết quả pass giả. Local real-stack Playwright và manual QA vẫn bắt buộc.
- **Data safety:** cleanup QA chỉ dùng các ID đã capture, thực hiện atomically, khôi phục trạng thái ngựa ban đầu và xác nhận không còn target residue.
- **Impacted task:** TASK-010.

Do not silently amend accepted decisions; create an ADR and/or CR entry and request approval where scope changes.

