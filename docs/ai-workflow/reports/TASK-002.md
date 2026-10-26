# TASK-002 — Execution Report

- **Plan version:** v1-approved-r4
- **Status:** DONE
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / `86d9bf0` (local changes unstaged)
  - Frontend: `main` / `4a73709` (local changes unstaged)
- **Pre-existing dirty working tree changes:**
  - Backend: Clean baseline at `86d9bf0`
  - Frontend: Clean baseline at `4a73709`
- **Files changed and why:**
  1. `Racehorse_Training_Management_System_MT_BE/src/users/permissions.ts`: Khai báo `ownerRoles: [Role.CLUB_MANAGER]` cho quyền `editHorses`. Đảm bảo hàm `normalizePermissions` luôn ép `editHorses: false` cho bất kỳ vai trò nào không phải Club Manager.
  2. `Racehorse_Training_Management_System_MT_BE/src/users/permissions.spec.ts`: Bổ sung kiểm thử unit xác minh:
     - `defaultPermissions` chỉ cấp `editHorses: true` cho `CLUB_MANAGER`, các vai trò còn lại nhận `false`.
     - `normalizePermissions` ép `editHorses: false` đối với `HEAD_TRAINER`, `VETERINARIAN`, `GROOM`, `HORSE_OWNER` ngay cả khi payload client hoặc dữ liệu lưu trữ truyền vào `editHorses: true`.
     - `normalizePermissions` cho phép `CLUB_MANAGER` giữ quyền `editHorses: true`.
  3. `Racehorse_Training_Management_System_MT_FE/src/shared/lib/permissions.ts`:
     - Khai báo `ownerRoles: ["CLUB_MANAGER"]` và `ownerReason` cho `editHorses` trong danh mục `PERMISSIONS`.
     - Bổ sung quy tắc trong hàm `screenAccess` chặn truy cập trực tiếp các route tạo/sửa hồ sơ ngựa (`/horses/new` và `/horses/:id/edit`), trả về 403 Forbidden đối với bất kỳ vai trò non-CM nào.
  4. `Racehorse_Training_Management_System_MT_FE/tests/e2e/rbac-matrix.spec.ts`:
     - Bổ sung test E2E kiểm chứng Head Trainer bị chặn 403 khi truy cập trực tiếp `/horses/new`, và không thấy tùy chọn "Chỉnh sửa hồ sơ" (`Edit profile`) trong menu hành động của từng con ngựa trên `/horses`.
     - Bổ sung test E2E kiểm chứng Club Manager truy cập đầy đủ biểu mẫu tạo mới `/horses/new` và thấy tùy chọn "Chỉnh sửa hồ sơ" trên danh sách ngựa.
- **Verification of existing code without source modifications:**
  - Backend `src/horses/horses.controller.ts`: Các mutation endpoint `create`, `update`, `transferOwner` đã được bảo vệ chặt chẽ bởi `@RequirePermission('editHorses')` và `@Roles(UserRole.CLUB_MANAGER)`. Các endpoint xóa mềm và phục hồi (`findDeleted`, `remove`, `restore`) được bảo vệ bởi `@RequirePermission('deleteHorses')` và `@Roles(UserRole.CLUB_MANAGER)`.
  - Backend `src/horses/horse-rules.ts`: Hàm `assertStatusTransition` phân định chính xác ranh giới chuyển trạng thái: HT chỉ chuyển đổi trong nhóm Vận hành (`RESTING`, `IN_TRAINING`, `ACTIVE`); VET quản lý nhóm Y tế (`UNDER_OBSERVATION`, `INJURED`, `ISOLATED`); CM phụ trách Ngừng quản lý (`RETIRED`) và Kích hoạt lại.
  - Frontend `src/features/horses/pages/HorseDetailPage.tsx`: Các hành động "Chuyển quyền sở hữu" (`Transfer owner`), "Chỉnh sửa hồ sơ" (`Edit profile`), "Xóa hồ sơ" (`Delete profile`), "Ngừng quản lý" (`Stop managing…`), và "Kích hoạt lại" (`Reactivate`) đã được khóa chặt bởi điều kiện `isManager` (`currentUser.role === "CLUB_MANAGER"`).
- **Acceptance criteria:**
  - [x] non-CM cannot retain or receive editHorses; CM may retain it.
  - [x] HT master mutations return 403 and corresponding controls stay hidden.
  - [x] CM mutations remain audited and authorized.
  - [x] Permitted HT operational status transitions and Vet medical transitions are not regressed.
  - [x] Delete and restore history remains intact.
- **Tests actually run:**
  1. Backend `npm run typecheck` — Exit code: `0` (TypeScript check passed).
  2. Backend `npm run lint` — Exit code: `0` (ESLint passed, 0 error, 0 warning).
  3. Backend `npx jest src/users/permissions.spec.ts src/horses/horse-rules.spec.ts src/horses/horses.service.spec.ts --runInBand` — Exit code: `0` (61 tests passed).
  4. Frontend `npm run typecheck` — Exit code: `0` (TypeScript check passed).
  5. Frontend `npm run lint` — Exit code: `0` (Oxlint passed, 0 error).
  6. Frontend `npm run build` with mock — Exit code: `0` (Vite build passed).
  7. Frontend `npx playwright test tests/e2e/rbac-matrix.spec.ts tests/e2e/horses.spec.ts` — Exit code: `0` (28 tests passed across viewports 1280 & 1440).
- **Regression concerns:**
  - Không có. Toàn bộ 28 kịch bản E2E kiểm tra 5 vai trò và vòng đời xóa/hoàn tác/phục hồi hồ sơ ngựa đều đạt 100%.
- **Manual QA Guide for User:**
  1. **Kiểm tra trực tiếp Backend HTTP API với tài khoản Head Trainer:**
     - Xác thực tài khoản: `POST /api/auth/login` với `{"email":"trainer@gmail.com","password":"EquiFlow@2026"}`.
     - Token nhận được xác nhận quyền: `role: "HEAD_TRAINER"`, `editHorses: false`, `deleteHorses: false`.
     - Cả 5 request đột biến danh mục ngựa đều bị Backend chặn với `HTTP 403`, code `FORBIDDEN`, và không làm thay đổi bất kỳ bản ghi nào trong cơ sở dữ liệu.
     - **Bằng chứng thực thi HTTP thực tế (Live Execution Evidence):**
       - **Trước khi gọi API:** Tổng số ngựa = `9`. Bản ghi ngựa mục tiêu `0d0f6812-2b22-44ec-bd81-fc0eb7082396` (`Red Velvet`, `HR-000008`): `status: RESTING`, `deletedAt: null`, `updatedAt: 2026-10-23T13:57:51.890Z`.
       - **Endpoint 1: POST /api/horses (Tạo mới hồ sơ ngựa)**
         - Command: `Invoke-RestMethod -Uri "http://localhost:3000/api/horses" -Method Post -Headers $headers -Body '{"name":"Malicious Horse Creation","breed":"Thoroughbred","gender":"COLT","dob":"2022-01-01T00:00:00.000Z","color":"Bay","ownerId":"24ea7a85-e0af-4d3d-8c37-6e817ba09c9c"}'`
         - HTTP Status: `403`
         - Response Code: `FORBIDDEN`
         - Response Message: `"Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]"`
       - **Endpoint 2: PUT /api/horses/:id (Cập nhật thông tin định danh ngựa)**
         - Command: `Invoke-RestMethod -Uri "http://localhost:3000/api/horses/0d0f6812-2b22-44ec-bd81-fc0eb7082396" -Method Put -Headers $headers -Body '{"name":"Malicious Horse Rename"}'`
         - HTTP Status: `403`
         - Response Code: `FORBIDDEN`
         - Response Message: `"Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]"`
       - **Endpoint 3: PATCH /api/horses/:id/transfer-owner (Chuyển quyền sở hữu ngựa)**
         - Command: `Invoke-RestMethod -Uri "http://localhost:3000/api/horses/0d0f6812-2b22-44ec-bd81-fc0eb7082396/transfer-owner" -Method Patch -Headers $headers -Body '{"newOwnerId":"24ea7a85-e0af-4d3d-8c37-6e817ba09c9c","reason":"Malicious transfer attempt"}'`
         - HTTP Status: `403`
         - Response Code: `FORBIDDEN`
         - Response Message: `"Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]"`
       - **Endpoint 4: DELETE /api/horses/:id (Xóa mềm hồ sơ ngựa)**
         - Command: `Invoke-RestMethod -Uri "http://localhost:3000/api/horses/0d0f6812-2b22-44ec-bd81-fc0eb7082396" -Method Delete -Headers $headers -Body '{"reason":"Malicious deletion attempt"}'`
         - HTTP Status: `403`
         - Response Code: `FORBIDDEN`
         - Response Message: `"Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]"`
       - **Endpoint 5: POST /api/horses/:id/restore (Khôi phục hồ sơ ngựa đã xóa)**
         - Command: `Invoke-RestMethod -Uri "http://localhost:3000/api/horses/0d0f6812-2b22-44ec-bd81-fc0eb7082396/restore" -Method Post -Headers $headers -Body '{"reason":"Malicious restore attempt"}'`
         - HTTP Status: `403`
         - Response Code: `FORBIDDEN`
         - Response Message: `"Access denied: Required role [CLUB_MANAGER], current role is [HEAD_TRAINER]"`
       - **Bằng chứng dữ liệu cơ sở dữ liệu KHÔNG ĐỔI (Database Invariants Verified):**
         - Query sau khi gọi cả 5 endpoint: Tổng số ngựa trong DB = `9` (giữ nguyên 100%, không phát sinh ngựa mới).
         - Bản ghi ngựa mục tiêu `0d0f6812-2b22-44ec-bd81-fc0eb7082396` (`Red Velvet`): `name` vẫn là `Red Velvet` (không bị đổi thành `Malicious Horse Rename`), `deletedAt` vẫn là `null` (không bị xóa), `updatedAt` vẫn là `2026-10-23T13:57:51.890Z` (không có mutation nào ghi nhận xuống DB).
  2. **Kiểm tra giao diện Frontend với Head Trainer (HLV trưởng):**
     - Đăng nhập: `trainer@gmail.com` / `EquiFlow@2026`.
     - Thử truy cập trực tiếp URL: `http://localhost:5173/horses/new` -> **Xác nhận:** Bị chặn với màn hình `403 · ACCESS DENIED` ("This screen is not part of your permissions").
     - Vào menu `Hồ sơ ngựa` (`/horses`):
       - Không thấy nút `+ Đăng ký ngựa` và `Hồ sơ đã xóa`.
       - Nhấn vào menu `...` của bất kỳ con ngựa nào -> **Xác nhận:** Không có dòng "Chỉnh sửa hồ sơ" (`Edit profile`).
     - Vào chi tiết một con ngựa (ví dụ `http://localhost:5173/horses/horse-1`):
       - Không thấy nút `Edit profile`.
       - Nhấn menu `More` -> Không thấy các hành động: `Transfer owner`, `Stop managing…`, `Delete profile`.
       - Nút `Đổi trạng thái` (`Change status`): HLV trưởng chỉ được phép chọn các trạng thái vận hành (`RESTING`, `IN_TRAINING`, `ACTIVE`), không thể chọn các trạng thái y tế hoặc ngừng quản lý.
  3. **Kiểm tra giao diện Frontend với Club Manager (Quản lý câu lạc bộ):**
     - Đăng nhập: `manager@gmail.com` / `EquiFlow@2026`.
     - Vào `/horses`:
       - Thấy đầy đủ nút `+ Đăng ký ngựa` và `Hồ sơ đã xóa`.
       - Menu `...` từng con ngựa có tùy chọn `Edit profile`.
     - Nhấn `+ Đăng ký ngựa` (hoặc vào `/horses/new`): Biểu mẫu đăng ký ngựa hiển thị đầy đủ và cho phép nhập thông tin.
     - Vào chi tiết một con ngựa: Thấy nút `Edit profile` và trong menu `More` có đầy đủ các quyền: `Transfer owner`, `Stop managing…`, `Delete profile`.
- **Known issues / CR:** Không có.
- **STOP marker:** Approved by human on 2026-10-24. Ready for baseline commit if authorized, or await explicit START TASK-003.
