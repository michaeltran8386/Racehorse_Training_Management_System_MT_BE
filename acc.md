# Danh sách Tài khoản & Dữ liệu Mẫu Chuẩn (`prisma/seed.ts`)

Mật khẩu chung cho toàn bộ tài khoản kiểm thử: **`EquiFlow@2026`**

> Lệnh nạp dữ liệu chuẩn duy nhất:
>
> - `npm run db:seed` (idempotent, an toàn chạy lại nhiều lần, giữ nguyên dữ liệu đã có)
> - `npm run db:seed -- --reset` (xóa sạch dữ liệu cũ và nạp lại từ đầu)

---

## 1. Tài khoản Quản lý & Huấn luyện viên (`ACTIVE`)

| Vai trò        | Email                | Họ và tên       | SĐT          | Ghi chú nghiệp vụ                                          |
| :------------- | :------------------- | :-------------- | :----------- | :--------------------------------------------------------- |
| `CLUB_MANAGER` | `manager@gmail.com`  | Trần Quang Minh | `0901000001` | Quản trị toàn hệ thống, phân quyền, tài chính, chuồng trại |
| `CLUB_MANAGER` | `manager2@gmail.com` | Nguyễn Hải Đăng | `0901000002` | Quản lý vận hành & phê duyệt phiếu nhập kho                |
| `HEAD_TRAINER` | `trainer@gmail.com`  | Nguyễn Văn Tuấn | `0902000001` | Phụ trách chiến mã chủ lực Khu A & Cúp Quốc Gia            |
| `HEAD_TRAINER` | `trainer2@gmail.com` | Lê Hoàng Nam    | `0902000002` | Phụ trách cự ly trung bình & đường trường                  |
| `HEAD_TRAINER` | `trainer3@gmail.com` | Phạm Quốc Trung | `0902000003` | Phụ trách ngựa trẻ & chạy thử tốc độ                       |
| `HEAD_TRAINER` | `trainer4@gmail.com` | Vũ Thành Long   | `0902000004` | Phụ trách thể lực phục hồi & hậu cần tập luyện             |

---

## 2. Đội ngũ Bác sĩ Thú y (`VETERINARIAN` — 4 `ACTIVE`)

| Email            | Họ và tên          | SĐT          | Chuyên trách                                            |
| :--------------- | :----------------- | :----------- | :------------------------------------------------------ |
| `vet@gmail.com`  | BS. Phạm Minh Trí  | `0903000001` | Thú y trưởng, Khóa Y Tế, khám lâm sàng Khu A            |
| `vet2@gmail.com` | BS. Nguyễn Thảo Vy | `0903000002` | Y học thể thao, chấn thương khớp & dây chằng            |
| `vet3@gmail.com` | BS. Trần Đình Khôi | `0903000003` | Lịch phòng ngừa (vaccine, tẩy giun, gọt móng, nha khoa) |
| `vet4@gmail.com` | BS. Lê Phương Anh  | `0903000004` | Dinh dưỡng & Khu Cách ly Y Tế (Khu C)                   |

---

## 3. Đội ngũ Nhân viên Chuồng trại (`GROOM` — 10 `ACTIVE`)

| STT | Email               | Họ và tên       | SĐT          | Khu vực / Ca phân công           |
| :-- | :------------------ | :-------------- | :----------- | :------------------------------- |
| 1   | `groom@gmail.com`   | Lê Văn Bình     | `0904000001` | Khu A (`MORNING`)                |
| 2   | `groom2@gmail.com`  | Hoàng Văn Phúc  | `0904000002` | Khu B (`MORNING`)                |
| 3   | `groom3@gmail.com`  | Đỗ Thị Mai      | `0904000003` | Khu C Cách ly (`MORNING`)        |
| 4   | `groom4@gmail.com`  | Nguyễn Hữu Tài  | `0904000004` | Khu A (`MORNING`)                |
| 5   | `groom5@gmail.com`  | Trần Minh Khoa  | `0904000005` | Khu A (`NIGHT`)                  |
| 6   | `groom6@gmail.com`  | Võ Ngọc Hân     | `0904000006` | Khu B (`AFTERNOON`)              |
| 7   | `groom7@gmail.com`  | Bùi Quang Huy   | `0904000007` | Khu B (`NIGHT`)                  |
| 8   | `groom8@gmail.com`  | Lý Thanh Tâm    | `0904000008` | Khu C (`AFTERNOON`)              |
| 9   | `groom9@gmail.com`  | Đinh Công Thành | `0904000009` | Khu H Lưu giữ nợ phí (`MORNING`) |
| 10  | `groom10@gmail.com` | Phan Thị Thu Hà | `0904000010` | Khu A (`AFTERNOON`)              |

---

## 4. Chủ sở hữu ngựa (`HORSE_OWNER` — 6 `ACTIVE`)

| Email              | Họ và tên       | SĐT          | Danh sách ngựa sở hữu                                             |
| :----------------- | :-------------- | :----------- | :---------------------------------------------------------------- |
| `owner@gmail.com`  | Phạm Gia Bảo    | `0905000001` | Bạch Long Mã, Xích Thố, Kim Long, Vân Tiêu                        |
| `owner2@gmail.com` | Đặng Hoàng Yến  | `0905000002` | Thần Phong, Phi Vũ, Tuyết Ảnh, Lôi Chấn, Lão Tướng (`RETIRED`)    |
| `owner3@gmail.com` | Vũ Quốc Hưng    | `0905000003` | Hắc Báo, Hồng Kỳ, Huyền Vũ (`RETIRED`)                            |
| `owner4@gmail.com` | Trịnh Bích Ngọc | `0905000004` | Thanh Loan, Ngàn Hoa, Dạ Nguyệt (Khu H, `isBadDebtFlagged: true`) |
| `owner5@gmail.com` | Lương Minh Đức  | `0905000005` | Tử Điện, Thiên Mã                                                 |
| `owner6@gmail.com` | Tống Khánh Linh | `0905000006` | Hỏa Phụng, Phong Lôi                                              |

---

## 5. Tài khoản Kiểm thử Vòng đời Trạng thái (`UserStatus` 7/7)

| Email                                | Role           | Trạng thái         | Mục đích kiểm thử                                     |
| :----------------------------------- | :------------- | :----------------- | :---------------------------------------------------- |
| `applicant.email@gmail.com`          | `HORSE_OWNER`  | `PENDING_EMAIL`    | Chờ xác thực OTP đăng ký                              |
| `applicant.approval@gmail.com`       | `GROOM`        | `PENDING_APPROVAL` | Chờ Manager duyệt tài khoản                           |
| `invited.vet@gmail.com`              | `VETERINARIAN` | `INVITED`          | Tài khoản được mời qua email, chưa kích hoạt mật khẩu |
| `inactive.groom@gmail.com`           | `GROOM`        | `INACTIVE`         | Nhân sự tạm ngưng hoạt động                           |
| `rejected.trainer@gmail.com`         | `HEAD_TRAINER` | `REJECTED`         | Hồ sơ bị từ chối kèm lý do                            |
| `equiflow-expired-fixture@gmail.com` | `HORSE_OWNER`  | `LOCKED`           | Tài khoản bị khóa do đăng nhập sai quá số lần         |

---

## 6. Tổng quan Danh mục Giống Ngựa & Sơ đồ Chuồng

- **Giống ngựa (`BREED` — 8 `isActive: true` + 1 `isActive: false`):** `Thoroughbred`, `Arabian`, `Arabian Cross`, `Quarter Horse`, `Warmblood`, `Standardbred`, `Appaloosa`, `Paint`, và `Morgan` (`isActive: false`).
- **Màu lông (`COLOR` — 8 `isActive: true`):** `Bay`, `Bay Dark`, `Chestnut`, `Black`, `Grey`, `Gray Roaming`, `Roan`, `Palomino`.
- **4 Phân khu chuồng (32 ô chuồng):**
  - Khu A (`3x4`, `STALL-A01..A12`): `A01..A07` `OCCUPIED`, `A08..A10` `AVAILABLE`, `A11` `MAINTENANCE`, `A12` `INACTIVE`.
  - Khu B (`3x4`, `STALL-B01..B12`): `B01..B07` `OCCUPIED`, `B08..B10, B12` `AVAILABLE`, `B11` `MAINTENANCE`.
  - Khu C (`2x2`, `STALL-C01..C04`): `C01` (Tuyết Ảnh - `ISOLATED`), `C02` (Lôi Chấn - `INJURED`), `C03..C04` `AVAILABLE`.
  - Khu H (`2x2`, `STALL-H01..H04`): `H01` (Dạ Nguyệt - lưu giữ nợ phí), `H02..H04` `AVAILABLE`.
- **Chiến mã nghỉ hưu (`BR-STL-07`):** `Lão Tướng` (`RETIRED`) và `Huyền Vũ` (`RETIRED` / `TRANSFERRED`) đã trả chuồng (`endDate` được ghi nhận, `isActive: false`) và không sinh nhiệm vụ chăm sóc hàng ngày.
