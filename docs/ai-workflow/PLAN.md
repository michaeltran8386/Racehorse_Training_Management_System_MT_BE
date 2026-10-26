# Implementation Plan — Hoàn thiện WEB, SIM và tích hợp hai chiều

**Version:** v1-approved-r11
**Status:** APPROVED — `APPROVE PLAN v1` recorded 2026-10-24  
**Owner:** ChatGPT Planner  
**Date:** 2026-10-24 (Asia/Bangkok)

Revision r6 incorporates approved CR-007: the result modal must submit results and optional locking through the single transactional `/results` request; it must not call `/lock-results` again after that request succeeds. TASK-003 has an approved six-file scope for this correction and its focused E2E coverage.

Revision r7 incorporates approved CR-008: Head Trainer retains eligibility screening, horse registration and scratch/withdrawal plus read-only access to published results. Club Manager exclusively records, edits and locks tournament results and manages the tournament lifecycle. TASK-003 has an approved seven-file scope for this authority correction.

Revision r8 incorporates approved CR-009: registration is allowed only while OPEN; scratch is allowed while OPEN or CLOSED before a terminal state; CM result draft/lock requires CLOSED and `now >= raceDate`. TASK-003 has an approved eight-file scope adding `RaceRegistrationModal.tsx` for the existing scratch API.

Revision r9 incorporates approved CR-010: runtime, manual QA, integration tests and final acceptance must use the real NestJS API and PostgreSQL data. Runtime mock/fallback paths are removed by the remaining Web/SIM tasks; mocks are permitted only inside isolated unit tests.

Revision r10 incorporates approved CR-011: TASK-007 expands to exactly seven application/test files to close the verified Horse Owner tournament race-data and foreign-owner PII leak. Authenticated tournament detail reads must pass the caller to the service; Horse Owner registrations/results are constrained by ownership in the Prisma query, while existing non-owner-role behavior remains unchanged.

Revision r11 incorporates approved CR-012: TASK-010 remains one human-gated task but is executed as two sequential M-size slices. Slice A preserves the five existing Medical Lock/runtime changes; Slice B authorizes exactly five corrective FE runtime/config/governance files to complete the Main Web real-only cutover. TASK-010 may be approved only after combined real-stack acceptance for both slices; standalone FE CI must not report mock-backed browser integration as passing.

> Không task nào được triển khai trước `APPROVE PLAN v1` và một lệnh `START TASK-XXX` riêng trong phiên AGY.

## 1. Mục tiêu

Hoàn thiện EquiFlow theo ba workstream có chung hợp đồng nghiệp vụ:

1. Hoàn thiện Main Web (Backend + Frontend) theo đúng chức năng và phạm vi dữ liệu của năm actor.
2. Hoàn thiện Simulator trong repository Git chính thức.
3. Kết nối Web–Simulator: Backend là nguồn dữ liệu chuẩn; Simulator phát dữ liệu mô phỏng, sự cố và kết quả về Web theo thời gian thực.

Thành công cuối cùng: actor đăng nhập Main Web, thực hiện đúng quyền, mở phiên mô phỏng không cần đăng nhập lần hai, thấy dữ liệu thật từ PostgreSQL, và kết quả/sự cố/khóa y tế đồng bộ hai chiều có lưu vết. Runtime không dùng hoặc fallback sang dữ liệu mock.

## 2. Ngoài phạm vi

- Không viết lại UI, engine, RBAC hoặc module đã có nếu chỉ cần sửa chênh lệch.
- Không thêm dependency, framework hoặc UI kit mới khi repository đã có giải pháp.
- Không tự động tạo bệnh án hoặc Medical Lock từ AI/Simulator.
- Không triển khai 3D; Simulator hiện là Canvas 2D.
- Không deploy, push, merge, xóa `_v3`, chạy migration phá hủy dữ liệu hoặc đổi hard invariant nếu chưa có phê duyệt riêng.
- Không làm nhiều task AGY trong một lượt; mỗi task dừng ở `AWAITING_USER_QA`.
- Không dùng mock trong runtime, manual QA, integration/E2E hoặc final acceptance. Mock/fake chỉ được phép trong unit test cô lập và không được import/reachable từ application runtime.

## 3. Baseline đã kiểm tra

### 3.1 Git và workflow

| Thành phần | Branch / revision ngày 2026-10-23 | Trạng thái |
| --- | --- | --- |
| Backend | `main` / `6832811` | sạch, tracking `origin/main` |
| Frontend | `main` / `ec73b53` | sạch, tracking `origin/main` |
| Simulator Git | `refactor/remove-rfid-standardize-microchip` / `2dbf2c0` | sạch, tracking remote cùng tên |
| Simulator `_v3` | không có `.git` | nguồn tham chiếu chức năng, không được là runtime chuẩn lâu dài |
| Workflow và root scripts | thư mục gốc không có `.git` | CR-003 chọn Backend repo làm canonical; commit/push vẫn cần quyền riêng trước khi đồng bộ clone AGY |

`STATE.md` ban đầu là `v0-draft`, không có active task và `APPROVALS.md` chưa ghi approval.

### 3.2 Kiến trúc hiện hữu

- Backend NestJS/Prisma/PostgreSQL đã có các module nghiệp vụ chính và module `simulator`.
- Backend đã có REST Simulator, Socket.IO namespace `/simulator`, persistence `SimulatorSession`/`IncidentReport`, ACK và `sys:medical_lock_sync`.
- Frontend React đã có router/page cho các miền horse, training, medical, stable care, racing, `/training/monitor`, `/incidents`, notification UI và role-matrix E2E.
- Simulator Git có API client cơ bản và Socket transport. `_v3` có 15 file `src` khác/thiếu, gồm `simulatorApi`, packet contract, engine/transport/bus và UI wiring.
- `start.bat` đang trỏ `SIM_DIR` vào `Racehorse_Simulator_Web_v3`, trái với canonical Git target.

Số liệu test trong `_v3/HANDOVER.md` là claim cũ, không phải bằng chứng cho revision hiện tại; AGY phải chạy lại.

## 4. Nguồn chuẩn và thứ tự ưu tiên

1. Hard invariant trong `AGENTS.md` và `CONSTRAINTS.md`.
2. Phần 1, 2, 4, 5, 6 và 7 của `srsv4.txt`; **loại hoàn toàn phần 3 “CÁC LUỒNG NGHIỆP VỤ CỦA HỆ THỐNG” khỏi nguồn yêu cầu của Plan này**.
3. Các đặc tả chức năng đã được người dùng chọn dùng riêng, gồm `SIM_WEB_FUNC.md` và tài liệu actor; không suy diễn yêu cầu từ phần workflow đã loại của `srsv4.txt`.
4. Quyết định đã ghi và được human approve trong ADR/CR/approval ledger.
5. Code hiện tại.

Conflict với hard invariant phải có CR và phê duyệt; không tự chọn bằng code.

## 5. Quyền actor mục tiêu

| Actor | Quyền mục tiêu | Không được làm |
| --- | --- | --- |
| Club Manager | account/permission; tạo/sửa/xóa mềm hồ sơ ngựa; quản lý giải; độc quyền create/update/toggle Supply Catalog; điều chỉnh tồn; duyệt/từ chối/xác nhận restock | đặt/gỡ Medical Lock thay Vet |
| Head Trainer | xem ngựa; kế hoạch/lịch; trial; xét điều kiện, đăng ký/rút ngựa; xem kết quả giải đã công bố | tạo/sửa/xóa hồ sơ ngựa; tạo/sửa/xóa/hủy/chuyển trạng thái giải; ghi/sửa/khóa kết quả; chỉnh permission cá nhân |
| Veterinarian | thấy toàn bộ Medical; bệnh án/injury/preventive; đặt/gỡ/gia hạn lock; chỉ đổi trạng thái y tế hợp lệ | đổi tùy ý toàn bộ vòng đời ngựa; quản lý permission |
| Groom | ngựa/chuồng/ca/task được giao; chăm sóc/sự cố; chỉ xem Supply Catalog/tồn kho và tạo restock request khi thiếu | create/update/toggle Supply Catalog; review/deliver request; sửa tồn kho |
| Horse Owner | chỉ ngựa sở hữu; xem training/race/financial; sửa profile/notification; gửi yêu cầu quyền | chỉnh permission; xem dữ liệu chủ khác |

## 6. Kiến trúc đích

### 6.1 Canonical source

- `Racehorse_Simulator_Web/` là source duy nhất được build/chạy/test.
- `_v3` chỉ là nguồn đối chiếu read-only trong giai đoạn transplant.
- Từng nhóm thay đổi phải reconcile với revision Git mới nhất và có focused test; không copy nguyên thư mục.
- Chỉ đề xuất archive `_v3` sau nghiệm thu; xóa cần lệnh riêng.

### 6.2 Ownership dữ liệu và xác thực

- PostgreSQL/Backend là system of record cho horse, stall, workout/trial, incident, lock, supply request và inventory.
- Main Web xác thực actor và yêu cầu Backend tạo/ủy quyền session.
- Simulator không có màn đăng nhập. Nó bootstrap bằng session ngắn hạn do Main Web mở; không đưa access token dài hạn vào URL/localStorage.
- Backend kiểm tra actor, ownership, RBAC, medical lock và trạng thái trước khi trả context.
- Main Web và Simulator chỉ có real runtime mode. Backend/PostgreSQL không sẵn sàng phải tạo lỗi kết nối rõ ràng; không được chuyển sang dữ liệu mẫu hoặc giả lập thành công.

### 6.3 Data flow

```text
Main Web --REST command--> Backend/Prisma --session context--> Simulator
Main Web <--REST snapshot-- Backend
Simulator --Socket.IO 1 Hz + ACK--> Backend --persist/broadcast--> Main Web
Vet Web --Medical Lock REST--> Backend --sys:medical_lock_sync--> Simulator
```

- REST cho command/bootstrap/snapshot; Socket.IO cho telemetry/progress/event.
- `event_id`/session identity và unique constraints đảm bảo idempotency.
- Tick chuẩn `1.0 Hz ±5%`.

### 6.4 Tournament lifecycle

Không thêm `MAINTENANCE`. Dùng enum hiện có:

- `UPCOMING`: đã tạo, chưa mở đăng ký.
- `OPEN_REGISTRATION`: đang nhận đăng ký.
- `CLOSED_REGISTRATION`: đóng đăng ký, giữ dữ liệu; không được mở lại. Sau đó chỉ có thể hủy hoặc hoàn tất qua quy trình ghi/khóa kết quả.
- `CANCELLED`: hủy nhưng giữ lịch sử/audit; trạng thái cuối cùng, không mở lại.
- `COMPLETED`: có kết quả và bất biến.

Hard delete chỉ cho giải chưa có registration/result và chưa completed. Giải đã có lịch sử dùng Cancel/Close; UI bỏ nghĩa “xóa vĩnh viễn mọi giải”. Không expose test-only mock hooks trong application runtime.

Action matrix: `UPCOMING` chưa nhận đăng ký; `OPEN_REGISTRATION` cho HT/CM đăng ký và scratch; `CLOSED_REGISTRATION` không nhận đăng ký mới nhưng cho HT/CM scratch có lý do trước khi khóa. Chỉ CM được ghi draft hoặc khóa kết quả khi giải đang `CLOSED_REGISTRATION` và thời điểm hiện tại đã đạt `raceDate`. `CANCELLED`/`COMPLETED` chỉ đọc và audit.

### 6.5 Incident notification và acknowledgement

- `CRITICAL`/catastrophic thông báo ngay Veterinarian, Head Trainer, assigned Groom, Horse Owner và Club Manager.
- `MILD`/`MODERATE` thông báo Veterinarian, assigned Groom và Horse Owner.
- Clinical acknowledgement chỉ xảy ra khi Vet chuyển incident từ `REPORTED` sang `UNDER_REVIEW`; `Notification.readAt` không thay thế acknowledgement.
- Nhắc lại mỗi 3 giờ khi incident vẫn `REPORTED` và `reviewedAt` còn null; dừng sau acknowledgement hoặc khi incident kết thúc.
- Dedupe theo `INCIDENT_REMINDER:{incidentId}:{threeHourRound}:{recipientId}` bằng `Notification.dedupeKey` hiện có.
- Club Manager chỉ xem/audit; incident không tự tạo MedicalRecord hoặc MedicalLock.

## 7. Phases — thứ tự bắt buộc WEB → SIM → ĐỒNG BỘ

- **Phase A — WEB / TASK-001–010:** permission contract; Club Manager; tournament; Head Trainer; Vet; Groom; Horse Owner; notification; incident reminder; Medical Lock notification; đóng Web runtime mock tại checkpoint.
- **Phase B — SIM / TASK-011–014:** REST/session packet contract; realtime engine/transport; UI session bootstrap real-only; launcher chuyển sang Git Simulator và khởi động real stack.
- **Phase C — ĐỒNG BỘ / TASK-015–018:** horse/stall data flow; trial realtime; incident→Vet→lock; supplies delivery.
- **Phase D — ACCEPTANCE / TASK-019:** full system acceptance, không mở rộng scope.

Chi tiết và checkpoint nằm trong `TASKS.md`.

## 8. Dependencies

- PostgreSQL/Docker và Prisma migrations hiện có.
- Node theo `package.json`; Simulator test TypeScript trực tiếp cần runtime tương thích.
- Không thêm dependency; dùng Socket.IO hiện có.
- API contract trước UI wiring; RBAC trước actor E2E; incident persistence trước reminder scheduler.

## 9. Testing strategy

- Backend per task: focused Jest, `npm run typecheck`, `npm run lint`; migration thêm Prisma validation và rollback rehearsal trên DB test.
- Frontend per task: `npm run typecheck`, `npm run lint`; UI integration/E2E chạy với Backend và PostgreSQL thật. Mock/fake chỉ dùng trong unit test cô lập và không được tính là integration evidence.
- Simulator per task: `npm run typecheck`, `npm test`, `npm run build`; `verify:map` chỉ khi sửa map/assets.
- Mỗi task ghi revision, command, exit code, acceptance evidence và manual QA vào `reports/TASK-XXX.md`.
- Live evidence phải chỉ ra request Web/SIM tới Backend, bản ghi PostgreSQL trước/sau và persistence sau restart; Backend/DB unavailable phải fail visibly, không fallback mock.
- Final gate: full BE unit/e2e; full FE Playwright real-stack; full SIM test/build + live integration; benchmark 1 Hz; regression Medical Lock, withdrawal, RBAC scope, inventory/tournament transactions, duplicate events, disconnect 15s và timeout 5 phút.

## 10. Rollback

- Mỗi task là commit riêng trong đúng repo; không giả định ba repo dùng chung commit.
- Schema/API theo additive migration → consumer switch → cleanup ở task/CR sau.
- Có thể rollback FE/SIM consumer trước; Backend giữ field/table additive tránh mất dữ liệu.
- Không dùng `git reset --hard`, xóa migration đã chạy hoặc xóa `_v3`; dùng reviewed revert và backup DB.
- Khi realtime lỗi, Web vẫn dùng REST snapshot; không bỏ persistence hoặc giả lập thành công.
- Khi Backend/PostgreSQL lỗi, Web/SIM hiển thị lỗi và giữ dữ liệu chưa xác nhận ở trạng thái không thành công; tuyệt đối không fallback sang mock.

## 11. Risks

| Risk | Mức | Mitigation |
| --- | --- | --- |
| TASK-003 và workflow revision hiện chưa có Git baseline sạch | Cao | giữ nguyên thay đổi đang QA; chỉ commit/push sau phê duyệt và ủy quyền riêng, không trộn task kế tiếp |
| `_v3` mới hơn nhưng không có history | Cao | transplant theo nhóm file + tests |
| Login trực tiếp cũ trong `_v3` | Cao | thay bằng session bootstrap từ Main Web |
| FE/BE permission drift | Cao | role-owned permission metadata, normalization tests và actor tasks riêng theo CR-005 |
| Notification audience/reminder sai hard invariant | Cao | thực hiện đúng contract CR-001 đã duyệt và fake-clock/dedupe tests |
| Reminder 3 giờ spam/trùng | Trung bình | business ACK, dedupe, fake-clock tests |
| Tournament hard delete mất audit | Cao | CANCELLED/CLOSED; delete chỉ unused record |
| Stale test claims | Trung bình | rerun và ghi revision/exit code |
| Mock runtime che giấu lỗi API/DB | Cao | loại runtime mock switch/import; real-stack QA/E2E và persistence-after-restart evidence |

## 12. Trạng thái quyết định và execution gate

- **CR-001 đã duyệt và hợp nhất:** audience theo severity; Vet acknowledgement; reminder 3 giờ có dedupe.
- **CR-002 đã giải quyết:** chỉ Club Manager quản lý Supply Catalog; Groom chỉ xem và gửi yêu cầu bổ sung.
- **CR-003 đã duyệt và hợp nhất:** `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/` là canonical tracked coordination home; root chỉ là mirror không authoritative.
- **CR-005 đã duyệt và hợp nhất:** `editHorses` là quyền role-owned của Club Manager; stored/submitted permission của non-CM phải normalize về false; TASK-002 phân biệt horse master-data mutation với operational status transition.
- **CR-010 đã duyệt và hợp nhất:** runtime/manual QA/integration/final acceptance chỉ dùng API và PostgreSQL thật; không fallback mock; mock chỉ trong unit test cô lập.
- **CR-011 đã duyệt và hợp nhất:** TASK-007 có phạm vi chính xác bảy tệp để lọc race registrations/results của Horse Owner theo ownership tại truy vấn Backend và không trả PII của chủ khác.
- **CR-012 đã duyệt và hợp nhất:** TASK-010 dùng hai slice tuần tự, tổng cộng đúng mười tệp đã liệt kê; Slice B loại các đường dẫn cấu hình/runtime mock còn lại và CI không được dùng mock để giả lập integration pass.

Plan v1 was explicitly approved on 2026-10-24 and amended through approved CR-012. Approval of a Plan/CR never starts or approves a task. TASK-001 through TASK-010 are DONE and human-approved; execution is IDLE; TASK-011 is next eligible but remains unauthorized and requires a separate direct `START TASK-011`.

