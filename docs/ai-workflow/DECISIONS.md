# Architecture Decision Log

> Plan revision hiện hành là v1-approved-r4, approved by `APPROVE PLAN v1` on 2026-10-24. Quyết định mới hoặc thay đổi scope vẫn phải mở CR.

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

Do not silently amend accepted decisions; create an ADR and/or CR entry and request approval where scope changes.

