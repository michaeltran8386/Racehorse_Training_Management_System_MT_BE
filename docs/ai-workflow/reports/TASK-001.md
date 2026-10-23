# TASK-001 — Execution Report

- **Plan version:** v1-draft-r3
- **Status:** DONE
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / `6832811751bd1737b3358a024c60d931af04d164` (local changes unstaged)
  - Frontend: `main` / `0c9e3b0e816212479e6b93956ddb1d8739c5db62` (local changes unstaged)
- **Pre-existing dirty working tree changes:**
  - Backend: `AGENTS.md` (Human-gated execution section added), `docs/ai-workflow/` (canonical coordination documents)
  - Frontend: Clean before task start
- **Feedback received on previous QA iteration:**
  - `REJECT TASK-001: vẫn còn các nút trên, hiện tôi đang dùng mock đấy vẫn có`
  - Feedback note: Tài khoản `acc.md` đăng nhập vào database không đúng do database PostgreSQL local (`localhost:5432`) chưa chạy, người dùng chuyển sang chế độ Mock (`VITE_USE_MOCK=true`). Ở chế độ Mock, phát hiện:
    1. Trình duyệt lưu cache `localStorage` của mock DB cũ ở `SEED_VERSION = 8` khiến Head Trainer vẫn còn giữ quyền `editHorses: true`, làm nút `+ Đăng ký ngựa` vẫn xuất hiện cho HLV trưởng.
    2. Trên trang `/alerts` ("Cảnh báo dấu hiệu bất thường"), nút header `← Lịch tập` (`/training/calendar`) hiển thị cho cả Bác sĩ thú y mặc dù Bác sĩ thú y không phụ trách lịch tập.
- **Files changed and why:**
  1. `Racehorse_Training_Management_System_MT_BE/src/users/permissions.ts`: Loại bỏ `'editHorses'` khỏi `DEFAULT_ON[Role.HEAD_TRAINER]`, định dạng mảng inline theo prettier.
  2. `Racehorse_Training_Management_System_MT_BE/src/users/permissions.spec.ts`: Bổ sung kiểm chứng Head Trainer không có quyền sửa/xóa hồ sơ ngựa, Club Manager không có `ackAlerts` và giữ độc quyền `manageAccounts`.
  3. `Racehorse_Training_Management_System_MT_FE/src/shared/lib/permissions.ts`: Loại bỏ `"editHorses"` khỏi `DEFAULT_ON.HEAD_TRAINER` và `"ackAlerts"` khỏi `DEFAULT_ON.CLUB_MANAGER`.
  4. `Racehorse_Training_Management_System_MT_FE/src/shared/mock/accounts.ts`: Nâng `SEED_VERSION` từ `8` lên `9` để buộc trình duyệt tự động xóa bỏ `localStorage` cũ và gieo lại dữ liệu mock với quyền chuẩn mới.
  5. `Racehorse_Training_Management_System_MT_FE/src/features/training/pages/AlertListPage.tsx`: Giới hạn nút `← Lịch tập` (`/training/calendar`) chỉ hiển thị cho `HEAD_TRAINER` và `CLUB_MANAGER`, ẩn hoàn toàn đối với `VETERINARIAN`.
  6. `Racehorse_Training_Management_System_MT_FE/tests/e2e/rbac-matrix.spec.ts`: Bổ sung kiểm chứng E2E cho Head Trainer không thấy nút tạo/xóa ngựa trên `/horses`, Club Manager có đủ quyền master data, Self-profile không có công tắc sửa quyền, và trang `/alerts` chỉ hiển thị "Xem & phản hồi" cho Vet, ẩn "← Lịch tập" với Vet.
- **Implementation summary:**
  - Đồng bộ 100% hợp đồng phân quyền giữa FE và BE cho cả 5 vai trò.
  - Tự động reset mock `localStorage` qua `SEED_VERSION = 9` (người dùng chỉ cần tải lại trang web).
  - Phân định rõ quyền truy cập giao diện trên `/horses` và `/alerts`.
- **Acceptance criteria:**
  - [x] Head Trainer default permission has no horse edit/delete authority.
  - [x] ackAlerts ownership/default matches the Vet-only rule on FE and BE.
  - [x] manageAccounts remains Club-Manager-only and always on for Club Manager.
  - [x] Self-profile supports profile, password and notification settings/request flow but never direct permission editing.
  - [x] FE navigation/action controls and Backend authorization contract agree for all five roles.
  - [x] Header navigation `← Lịch tập` trên `/alerts` được ẩn đối với Bác sĩ thú y.
- **Tests actually run:**
  1. Backend `npm run typecheck` — Exit code: `0` (TypeScript check passed).
  2. Backend `npm run lint` — Exit code: `0` (ESLint passed, 0 error, 0 warning).
  3. Backend `npx jest src/users/permissions.spec.ts --runInBand` — Exit code: `0` (9 tests passed).
  4. Frontend `npm run typecheck` — Exit code: `0` (TypeScript check passed).
  5. Frontend `npm run lint` — Exit code: `0` (Oxlint passed, 0 error).
  6. Frontend `$env:VITE_USE_MOCK="true"; npm run build` — Exit code: `0` (Build passed).
  7. Frontend `npx playwright test tests/e2e/rbac-matrix.spec.ts` — Exit code: `0` (20 passed across desktop-1280 and desktop-1440 viewports).
- **Tests NOT run:**
  - Full suite backend integration E2E (`npm run test:e2e`): Không chạy do database server PostgreSQL local hiện không hoạt động (`P1001: Can't reach database server at localhost:5432`).
- **Regression concerns:**
  - Không có.
- **Manual QA Guide for User:**
  1. **Tải lại trình duyệt (F5):** `SEED_VERSION = 9` sẽ tự động xóa bộ nhớ đệm `localStorage` cũ của mock mode và khởi tạo lại dữ liệu tài khoản chuẩn.
  2. **Kiểm tra vai trò Head Trainer (HLV trưởng):**
     - Đăng nhập: `trainer@gmail.com` / `EquiFlow@2026` (hoặc `nam.tran@gmail.com` / `equiflow123`).
     - Vào menu `Hồ sơ ngựa` (`/horses`): Xác nhận **KHÔNG THẤY** nút `+ Đăng ký ngựa` và **KHÔNG THẤY** `Hồ sơ đã xóa`. Trong menu `...` từng con ngựa không có nút sửa thông tin (`Edit profile`).
     - Vào menu `Cảnh báo bất thường` (`/alerts`): Xác nhận có nút `← Lịch tập`, nhưng **KHÔNG THẤY** nút `Xem & phản hồi` (nút này chỉ dành cho Bác sĩ thú y).
  3. **Kiểm tra vai trò Veterinarian (Bác sĩ thú y):**
     - Đăng nhập: `vet@gmail.com` / `EquiFlow@2026` (hoặc `chau.le@gmail.com` / `equiflow123`).
     - Vào menu `Cảnh báo cơ sinh ...` (`/alerts`): Xác nhận **KHÔNG CÒN** nút `← Lịch tập`. Nút `Xem & phản hồi` trên thẻ cảnh báo vẫn hiển thị vì đây là quyền xác nhận bất thường lâm sàng độc quyền của Bác sĩ thú y (`ackAlerts`).
  4. **Kiểm tra vai trò Club Manager (Quản lý câu lạc bộ):**
     - Đăng nhập: `manager@gmail.com` / `EquiFlow@2026` (Hoàng Văn Sơn).
     - Vào menu `Hồ sơ ngựa` (`/horses`): Nút `+ Đăng ký ngựa` và `Hồ sơ đã xóa` **HIỂN THỊ ĐẦY ĐỦ** (Quản lý là vai trò duy nhất quản trị hồ sơ gốc ngựa).
- **Known issues / CR:** Không có.
- **User QA Resolution:** Approved by human on 2026-10-24 via explicit command `APPROVE TASK-001`.
- **STOP marker:** TASK-001 is DONE. Awaiting human command `START TASK-002`.
