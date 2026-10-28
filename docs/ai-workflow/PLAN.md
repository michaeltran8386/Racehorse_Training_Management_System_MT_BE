# Implementation Plan — Hoàn thiện WEB, SIM và tích hợp hai chiều

**Version:** v1-approved-r22
**Status:** APPROVED — `APPROVE PLAN v1` recorded 2026-10-24  
**Owner:** ChatGPT Planner  
**Date:** 2026-10-24 (Asia/Bangkok)

Revision r6 incorporates approved CR-007: the result modal must submit results and optional locking through the single transactional `/results` request; it must not call `/lock-results` again after that request succeeds. TASK-003 has an approved six-file scope for this correction and its focused E2E coverage.

Revision r7 incorporates approved CR-008: Head Trainer retains eligibility screening, horse registration and scratch/withdrawal plus read-only access to published results. Club Manager exclusively records, edits and locks tournament results and manages the tournament lifecycle. TASK-003 has an approved seven-file scope for this authority correction.

Revision r8 incorporates approved CR-009: registration is allowed only while OPEN; scratch is allowed while OPEN or CLOSED before a terminal state; CM result draft/lock requires CLOSED and `now >= raceDate`. TASK-003 has an approved eight-file scope adding `RaceRegistrationModal.tsx` for the existing scratch API.

Revision r9 incorporates approved CR-010: runtime, manual QA, integration tests and final acceptance must use the real NestJS API and PostgreSQL data. Runtime mock/fallback paths are removed by the remaining Web/SIM tasks; mocks are permitted only inside isolated unit tests.

Revision r10 incorporates approved CR-011: TASK-007 expands to exactly seven application/test files to close the verified Horse Owner tournament race-data and foreign-owner PII leak. Authenticated tournament detail reads must pass the caller to the service; Horse Owner registrations/results are constrained by ownership in the Prisma query, while existing non-owner-role behavior remains unchanged.

Revision r11 incorporates approved CR-012: TASK-010 remains one human-gated task but is executed as two sequential M-size slices. Slice A preserves the five existing Medical Lock/runtime changes; Slice B authorizes exactly five corrective FE runtime/config/governance files to complete the Main Web real-only cutover. TASK-010 may be approved only after combined real-stack acceptance for both slices; standalone FE CI must not report mock-backed browser integration as passing.

Revision r12 incorporates approved CR-013: add TASK-020 as an additive, deterministic Web manual-QA dataset checkpoint after TASK-011 and before TASK-012. It creates only clearly identified QA fixtures in the existing local PostgreSQL database, never a second database/schema, and must not delete or overwrite non-QA records.

Revision r13 incorporates approved CR-014: the canonical Git repository `Racehorse_Simulator_Web/` remains the sole v3 product source; TASK-013 removes the secondary Simulator login and binds REST/Socket.IO runtime identity to the Main-Web-issued simulator session. It is executed as two sequential slices covering Backend session validation/transport and canonical v3 UI bootstrap. Root `.bat` launcher work remains isolated in TASK-014 and is deferred until separately started.

Revision r14 incorporates approved CR-015 after real browser QA rejected TASK-013. TASK-013 gains two corrective slices that replace hash/default horse master data with PostgreSQL session context, complete the Veterinarian EXAM result path, provide an eligible QA trial, and require Playwright/Chromium evidence against the already-running real stack. API-only verification cannot substitute for browser acceptance. TASK-015 retains the later broader cross-role horse/stall synchronization scope and must not reintroduce a Simulator-side source of truth.

Revision r15 incorporates approved CR-016 after human manual QA rejected TASK-013 again. TASK-013 gains corrective Slice E: a Main-Web-issued workout must use the prescribed configuration, stop visibly at completion and emit one finish; an EXAM skips the decorative intro, emits one completion, and lets Main Web auto-load the acknowledged result on tab focus; vital-sign badges describe numeric reference ranges rather than the horse's overall injury state. Trial-result formatting/live monitoring remains TASK-016.

Revision r16 incorporates approved CR-017 after the next Human Manual QA found a terminal workout relaunch, a missing-weight EXAM validation failure and UUID-only horse identity in the medical-record list. TASK-013 gains corrective Slice F, five exact additional files and deterministic `QA T013` fixtures so the human can test by reload and searchable names without database surgery. Reusing a terminal session for the same workout must fail clearly; no master weight may be fabricated.

Revision r17 incorporates approved CR-018 after Human Manual QA found that 60× playback produced too few chart samples to communicate simulated variation and that the Trial Runs scheduling entry point defaulted to `CANTER`. TASK-013 gains corrective Slice G: retain 1 Hz real-time Socket.IO transport while sampling the visual chart by simulated time, and preselect `TRIAL` in the existing scheduling dialog. For this continuation only, Codex may replace AGY after a separate direct `START TASK-013 CODEX`; TASK-014 and later tasks retain the default AGY executor.

Revision r18 incorporates approved CR-019 after Human Manual QA found that future scheduled trials looked unavailable without a visible reason and that an already-open result form did not refresh or identify Simulator-imported values on focus. TASK-013 gains corrective Slice H in exactly one additional FE application file plus two already-authorized files; scheduled-time authority remains server-enforced and subjective trainer fields are never fabricated.

Revision r19 incorporates approved CR-020 after launcher review rejected TASK-014. Database reset/seed is isolated in root `setup-db.bat`; runtime startup uses root `start.bat` to open one Windows Terminal with four tabs for Backend, Frontend, canonical Simulator and PostgreSQL/Docker visibility; root `stop.bat` is explicitly allowed to force-stop the EquiFlow local ports and PostgreSQL container. TASK-014 expands from two to exactly three root scripts, must verify real health before success, and requires a new direct `START TASK-014`.

Revision r20 incorporates approved CR-021 and corrects the Simulator product boundary: Simulator functional areas are not Main-Web role personas. Direct canonical Simulator access has no secondary login or role-filtered catalogue and reads the complete real horse/stall dataset from Backend/PostgreSQL. Backend-issued workflow sessions remain mandatory only for authoritative result/event write-back. TASK-015 therefore validates the real catalogue and no-fallback behavior without adding CM/Groom inspection endpoints, launch buttons, an `INSPECTION` enum or a migration; TASK-016–018 retain their respective write-back flows.

Revision r21 incorporates approved CR-022: TASK-016 expands to exactly 7 application/test files adding `simulator.service.spec.ts` and `simulator.gateway.spec.ts`. Enforces conditional atomic transitions for abort and normal finish only from PENDING/RUNNING, single persisted terminal outcome and wire broadcast, 5-minute running watchdog timer from 1st tick, 15-second disconnect grace period, timer lifecycle cleanup, and fake-clock/concurrency unit test coverage.

Revision r22 incorporates approved CR-023 after Human Manual QA found that Head Trainer training plans, workouts, and trial runs were not properly scoped by trainerUserId in Backend queries and that Trial Runs ignored the created trial date filter. TASK-016 expands by 4 additional files (BE `training-plans.service.ts`, `workouts.service.ts`, `training-services.spec.ts`, FE `TrialRunsPage.tsx`; total 11 files across workspace) to enforce strict Head Trainer data scoping, fail-closed cross-trainer mutations, actionable simulation row filtering, and immediate date filter visibility for created trials. Execution returns to IDLE awaiting explicit START TASK-016.

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
- Main Web xác thực actor và yêu cầu Backend tạo/ủy quyền session cho các thao tác ghi kết quả nghiệp vụ.
- Simulator không có màn đăng nhập. Direct mode tải catalogue horse/stall đầy đủ, chỉ đọc, từ Backend/PostgreSQL; các khu Groom/Vet/Track là khu chức năng mô phỏng, không phải Main-Web role view.
- `sessionId` là capability ngắn hạn do Backend phát hành cho authoritative write-back: context và Socket.IO phải cùng xác thực session, trạng thái và actor; không đưa access token dài hạn vào URL/localStorage và không fallback sang actor mặc định.
- Direct mode không có `sessionId` có thể chạy tương tác mô phỏng cục bộ nhưng không được sửa master data hoặc persist kết quả/workflow chính thức.
- Backend kiểm tra actor, ownership, RBAC, medical lock và trạng thái trước khi trả context; session thiếu, sai, terminal hoặc quá hạn bị từ chối.
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
- **Phase A.5 — QA DATA / TASK-020:** bổ sung dataset Web thủ công có định danh QA, idempotent và local-only sau khi TASK-011 hoàn tất; TASK-012 chờ checkpoint này.
- **Phase B — SIM / TASK-011–014:** REST/session packet contract; sau TASK-020 tiếp tục realtime engine/transport, UI session bootstrap real-only và launcher chuyển sang Git Simulator.
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
- Manual-QA seed task: chạy seed hai lần để chứng minh idempotency; so sánh non-QA snapshot trước/sau; kiểm tra count, RBAC/ownership qua NestJS API thật và persistence sau Backend restart.
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
| Seed QA làm bẩn hoặc ghi đè dữ liệu thật | Cao | script riêng, deterministic QA identity, local-only confirmation, upsert QA records, cấm delete/truncate và kiểm chứng non-QA snapshot bất biến |

## 12. Trạng thái quyết định và execution gate

- **CR-001 đã duyệt và hợp nhất:** audience theo severity; Vet acknowledgement; reminder 3 giờ có dedupe.
- **CR-002 đã giải quyết:** chỉ Club Manager quản lý Supply Catalog; Groom chỉ xem và gửi yêu cầu bổ sung.
- **CR-003 đã duyệt và hợp nhất:** `Racehorse_Training_Management_System_MT_BE/docs/ai-workflow/` là canonical tracked coordination home; root chỉ là mirror không authoritative.
- **CR-005 đã duyệt và hợp nhất:** `editHorses` là quyền role-owned của Club Manager; stored/submitted permission của non-CM phải normalize về false; TASK-002 phân biệt horse master-data mutation với operational status transition.
- **CR-010 đã duyệt và hợp nhất:** runtime/manual QA/integration/final acceptance chỉ dùng API và PostgreSQL thật; không fallback mock; mock chỉ trong unit test cô lập.
- **CR-011 đã duyệt và hợp nhất:** TASK-007 có phạm vi chính xác bảy tệp để lọc race registrations/results của Horse Owner theo ownership tại truy vấn Backend và không trả PII của chủ khác.
- **CR-012 đã duyệt và hợp nhất:** TASK-010 dùng hai slice tuần tự, tổng cộng đúng mười tệp đã liệt kê; Slice B loại các đường dẫn cấu hình/runtime mock còn lại và CI không được dùng mock để giả lập integration pass.
- **CR-013 đã duyệt và hợp nhất:** TASK-020 tạo dataset manual-QA additive trong PostgreSQL hiện có bằng hai file Backend tooling; TASK-012 phụ thuộc TASK-020 để giữ thứ tự human-gated mà không đánh lại số TASK-012–019.
- **CR-014 đã duyệt và hợp nhất:** canonical Git Simulator vẫn là sản phẩm v3 duy nhất; TASK-013 dùng hai slice tuần tự để loại secondary login, xác thực context/Socket.IO bằng session do Main Web cấp và xóa fallback actor mặc định. TASK-014 giữ riêng launcher `.bat` và chưa được thực thi.
- **CR-015 đã duyệt và hợp nhất:** TASK-013 dùng PostgreSQL master data, hoàn thiện EXAM result path, QA trial và real-browser acceptance.
- **CR-016 đã duyệt và hợp nhất:** TASK-013 hoàn tất prescribed workout, exactly-once finish, streamlined EXAM handoff và nhãn vital theo dải tham chiếu.
- **CR-017 đã duyệt và hợp nhất:** TASK-013 thêm Slice F để chặn terminal-session relaunch, giữ missing weight là unavailable, hiển thị tên/mã ngựa trong medical-record list và chuẩn hóa fixture `QA T013` idempotent.
- **CR-018 đã duyệt và hợp nhất:** TASK-013 thêm Slice G để tách biểu đồ theo thời gian mô phỏng khỏi telemetry 1 Hz thời gian thực, mặc định đúng loại `TRIAL` khi tạo lịch từ Trial Runs, và cho phép Codex thực thi riêng continuation này sau lệnh `START TASK-013 CODEX`.
- **CR-019 đã duyệt và hợp nhất:** TASK-013 thêm Slice H để hiển thị rõ thời điểm được phép chạy, refresh/import draft kết quả Simulator khi mount/focus/retry và phân biệt dữ liệu khách quan với đánh giá bắt buộc của Head Trainer.
- **CR-020 đã duyệt và hợp nhất:** TASK-014 dùng ba root script local-only cho reset/seed, khởi động real stack bằng một Windows Terminal bốn tab và force-stop có xác minh. Ba script không được Git theo dõi và được human chấp nhận là local-only.
- **CR-021 đã duyệt và hợp nhất:** direct Simulator hiển thị toàn bộ catalogue horse/stall thật mà không login hoặc role filtering; session chỉ bắt buộc cho authoritative write-back. Không thêm CM/Groom inspection endpoint/UI, enum hay migration. TASK-015 được trả về TODO và cần lệnh `START TASK-015` mới.
- **CR-022 đã duyệt và hợp nhất:** TASK-016 mở rộng phạm vi chính xác 7 tệp (thêm `simulator.service.spec.ts` và `simulator.gateway.spec.ts`), bắt buộc conditional atomic transition cho abort và normal finish chỉ từ PENDING/RUNNING, đảm bảo single persisted terminal outcome và broadcast, 5m running watchdog timer từ tick đầu tiên, 15s disconnect grace timer và fake-clock/concurrency tests.
- **CR-023 đã duyệt và hợp nhất:** TASK-016 mở rộng phạm vi thêm 4 tệp (BE `training-plans.service.ts`, `workouts.service.ts`, `training-services.spec.ts`, FE `TrialRunsPage.tsx`; tổng cộng đúng 11 tệp), giới hạn training plans, workouts và trial runs của Head Trainer theo trainerUserId hiện tại, fail-closed khi thao tác plan/workout của trainer khác, chỉ hiển thị nút chạy mô phỏng cho trainer sở hữu và cập nhật dải ngày để thấy ngay trial vừa tạo.

Plan v1 was explicitly approved on 2026-10-24 and amended through approved CR-005 through CR-023 incorporated as v1-approved-r22. TASK-001 through TASK-015 and TASK-020 are DONE and human-approved. Execution is IDLE; next_task is TASK-016 awaiting direct `START TASK-016`. TASK-017 remains unauthorized.

