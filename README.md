# EquiFlow - Racehorse Training & Stable Management System (Backend)

[![Backend CI / CD Pipeline](https://github.com/MichaelTran1226/Racehorse_Training_Management_System_MT_BE/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelTran1226/Racehorse_Training_Management_System_MT_BE/actions)
[![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8%2B-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Docker%2016-336791?logo=postgresql)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?logo=docker)](https://www.docker.com/)

Hệ thống quản lý chuồng trại, chăm sóc y tế chuyên sâu, lập giáo án huấn luyện đỉnh cao và quản trị tài chính minh bạch cho các câu lạc bộ ngựa đua chuyên nghiệp (Đồ án SWP391).

---

## 1. Khởi động Nhanh với Docker (Quick Start - Recommended ⭐)

Nếu máy tính của bạn đã cài đặt **Docker Desktop**, bạn có thể khởi chạy toàn bộ Cơ sở dữ liệu và Backend chỉ với **3 bước đơn giản**:

```bash
# 1. Cài đặt các thư viện
npm install

# 2. Khởi động PostgreSQL 16 bằng Docker
docker compose up -d

# 3. Đồng bộ schema và nạp toàn bộ dữ liệu mẫu (38 bảng, 19 chiến mã, 10 groom, 4 bác sĩ thú y)
npm run db:setup

# 4. Khởi động Backend Server
npm run start:dev
```

Server Backend sẽ lắng nghe tại: **`http://localhost:3000`** (API prefix: `/api`).  
Kiểm tra sức khỏe hệ thống: `GET http://localhost:3000/api/health` -> `{"status":"ok","database":{"connected":true}}`.

---

## 2. Hướng dẫn Thiết lập Chi tiết

### 2.1. Cấu hình biến môi trường (`.env`)

Sao chép file `.env.example` thành `.env`:

```powershell
# Windows PowerShell
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Nội dung chuẩn của `.env` khi chạy với Docker cục bộ và gửi OTP qua Gmail:

```env
# 1. Cấu hình Server
PORT=3000
NODE_ENV=development
API_PREFIX=/api
CORS_ORIGIN=http://localhost:5173
APP_URL=http://localhost:5173

# 2. Cấu hình Database PostgreSQL Docker Local
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/equiflow?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/equiflow?schema=public"

# 3. Cấu hình Authentication & JWT Token
JWT_SECRET="equiflow-secure-jwt-secret-replace-in-production-2026"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="equiflow-secure-refresh-jwt-secret-2026"
JWT_REFRESH_EXPIRES_IN="7d"

# 4. Cấu hình Gửi Email OTP thật qua Google SMTP
EMAIL_PROVIDER="smtp"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-gmail-app-password"
EMAIL_FROM="EquiFlow System <noreply@equiflow.site>"

# 5. Cờ kiểm thử OTP
# false = Gửi mã OTP ngẫu nhiên thật về hòm thư Gmail
# true  = Mọi mã OTP luôn là 123456 (tiện test nhanh không cần mở email)
DEV_FIXED_OTP=false
```

---

### 2.2. Hai cách quản lý Database PostgreSQL bằng Docker

#### Cách 1: Dùng Docker Compose (Tiện lợi nhất)

Trong thư mục `Racehorse_Training_Management_System_MT_BE`:

```bash
# Bật database chạy nền
docker compose up -d

# Tắt database khi không sử dụng
docker compose down
```

#### Cách 2: Dùng lệnh `docker run` trực tiếp

Nếu không muốn dùng compose, bạn có thể chạy 1 dòng lệnh:

```powershell
docker run -d --name equiflow-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=equiflow -p 5432:5432 -v equiflow_pg_data:/var/lib/postgresql/data postgres:16-alpine
```

---

### 2.3. Xem và quản lý dữ liệu bằng Prisma Studio (GUI)

Để xem toàn bộ bảng biểu trực quan trên trình duyệt (thay thế cho pgAdmin hoặc DBeaver):

```bash
npm run db:studio
# hoặc: npx prisma studio
```

Trình duyệt sẽ tự động mở tại **`http://localhost:5555`**.

---

## 3. Danh sách Tài khoản Kiểm thử (Demo Accounts)

Mật khẩu mặc định cho tất cả các tài khoản: **`EquiFlow@2026`** (chi tiết đầy đủ tất cả 32 tài khoản xem tại [acc.md](./acc.md))

| Vai trò (Role)         | Email (`@gmail.com`)                                                                                                     | Số lượng | Ghi chú                                                                                                        |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------- |
| **Club Manager**       | `manager`, `manager2`                                                                                                    | **2**    | Quản trị tài khoản, phân quyền, sơ đồ chuồng, hóa đơn & audit log                                              |
| **Head Trainer**       | `trainer`, `trainer2`, `trainer3`, `trainer4`                                                                            | **4**    | Lập giáo án, lịch tập, mô phỏng đua và đăng ký giải đấu                                                        |
| **Veterinarian**       | `vet`, `vet2`, `vet3`, `vet4`                                                                                            | **4**    | Khám lâm sàng, Khóa y tế, bản đồ chấn thương 2D, tiêm phòng & dinh dưỡng                                       |
| **Groom**              | `groom`, `groom2` … `groom10`                                                                                            | **10**   | Ca trực 7 ngày phủ toàn bộ Khu A, B, C, H, checklist chăm sóc & kho                                            |
| **Horse Owner**        | `owner`, `owner2` … `owner6`                                                                                             | **6**    | Chủ sở hữu 19 chiến mã (`owner4` có hóa đơn quá hạn & ngựa khu H)                                              |
| **Lifecycle Accounts** | `applicant.email`, `applicant.approval`, `invited.vet`, `inactive.groom`, `rejected.trainer`, `equiflow-expired-fixture` | **6**    | Phủ đủ 6 trạng thái còn lại (`PENDING_EMAIL`, `PENDING_APPROVAL`, `INVITED`, `INACTIVE`, `REJECTED`, `LOCKED`) |

---

## 4. Bộ dữ liệu doanh nghiệp nhỏ — một seed duy nhất

`prisma/seed.ts` là bộ dữ liệu duy nhất. Các seed demo, master, manual-QA và trainer riêng đã được hợp nhất rồi bỏ. Không đổi schema.

- Lịch sử từ **01/12/2025**, công việc gần ngày chạy chi tiết hơn và lịch dự kiến đến **21 ngày tới**, dùng múi giờ Việt Nam.
- **24 ngựa**: 19 hồ sơ cư trú/lịch sử và 5 hồ sơ tiếp nhận; **48 ô chuồng**, 4 sân tập, 7 nhóm vật tư.
- **32 tài khoản**: 2 quản lý, 4 HLV, 4 bác sĩ, 10 Groom, 6 chủ ngựa và 6 tài khoản ở các trạng thái vòng đời khác. Tài khoản đăng nhập giữ mật khẩu demo `EquiFlow@2026`; tài khoản mời chưa đặt mật khẩu.
- Huấn luyện có chu kỳ đã hoàn thành, nháp, đang chạy, hủy; có kết quả, bỏ lỡ, khóa y tế và buổi tập tương lai. Nhân viên được phân khu và lịch làm việc.
- Chăm sóc có lịch sử hằng ngày, nhật ký, thực đơn, khám định kỳ, phòng bệnh, sự cố, nhập kho và cảnh báo tồn thấp.
- Tiếp nhận đủ 6 trạng thái, có đối chiếu chip, kết quả khám và lịch sử quyết định. Bàn giao có SLA thường/khẩn và các trạng thái đã xử lý; có chuyển nhượng, phản ánh, đánh giá HLV và thông báo.
- **Hóa đơn chỉ từ 12/2025 đến hết 10/2026**. Trước 09/2026 dùng gói cũ; từ 09/2026 dùng sổ chi phí thực tế, dòng hóa đơn, khoản hoàn tác và quyền ghi nhận chi phí. Tháng 11 trở đi có hoạt động và chi phí chưa lập hóa đơn.
- Có hóa đơn đã thanh toán, chờ đối soát, quá hạn, nháp và hủy; có chủ nợ xấu và ngựa lưu giữ nợ. Tiền thưởng giải đối soát theo hàm chia thưởng của hệ thống.

```powershell
# Nạp bộ dữ liệu chính; chạy lại không nhân đôi ID mẫu và không sửa hóa đơn đã có
npm run db:seed

# Xóa toàn bộ dữ liệu rồi dựng lại bộ mẫu — chỉ chạy trên database demo có thể bỏ
npm run db:seed -- --reset

# Kiểm tra sinh dữ liệu, quan hệ, số tiền, mốc thời gian và chạy lặp; không kết nối database
npm run test:seed

# Kiểm tra database đã được nạp seed (chỉ đọc)
npm run db:verify
```

`--reset` chạy trong transaction và bị chặn khi `NODE_ENV=production`. Không cần reset để kiểm tra mã. Seed không gửi email và các token/OTP mẫu đều hết hạn hoặc bị thu hồi.

Nếu database đang chứa dữ liệu từ bộ seed khác, chạy thường sẽ **không xóa** các dữ liệu đó, kể cả hóa đơn cũ ngoài mốc tháng 10. Muốn một bộ demo sạch, dùng database demo trống hoặc chủ động chọn `--reset` sau khi sao lưu dữ liệu cần giữ.

Số lượng kiểm tra ngoại tuyến tại **28/11/2026**: hơn 33.000 nhiệm vụ chăm sóc, 2.170 buổi tập, 233 bệnh án, 209 hóa đơn, có dữ liệu ở đủ 50 model. Số bản ghi theo ngày sẽ thay đổi khi chạy vào ngày khác.

---

## 5. Danh mục Lệnh Phát Triển & Kiểm Thử

| Lệnh                         | Ý nghĩa                                                         |
| :--------------------------- | :-------------------------------------------------------------- |
| `npm run start:dev`          | Khởi động server NestJS chế độ Hot-reload                       |
| `npm run db:up`              | Khởi chạy PostgreSQL container bằng Docker Compose              |
| `npm run db:down`            | Dừng và tắt PostgreSQL container                                |
| `npm run db:setup`           | Đẩy bảng Prisma và nạp dữ liệu chuẩn (`db:seed`)                |
| `npm run db:seed`            | Nạp dữ liệu chuẩn idempotent (an toàn chạy lại nhiều lần)       |
| `npm run db:seed -- --reset` | Reset sạch DB dev/local và nạp lại toàn bộ dữ liệu mẫu          |
| `npm run db:studio`          | Mở giao diện trực quan Prisma Studio tại port 5555              |
| `npm run typecheck`          | Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (`tsc --noEmit`) |
| `npm run test:unit`          | Chạy toàn bộ Unit test suite bằng Jest                          |
| `npm run build`              | Biên dịch toàn bộ dự án NestJS ra thư mục `/dist`               |
| `npm run lint`               | Chạy ESLint kiểm tra quy chuẩn mã nguồn                         |

---

## 6. Tài liệu & OpenAPI Swagger

- **Swagger UI Interactive Documentation:** `http://localhost:3000/api/docs`
- **Health Check Probe:** `GET http://localhost:3000/api/health`


### Demo TimeControl (development only)

ToolDemoKit lets an authenticated demo user choose a date and time in UTC+7. The shared backend business clock then advances at normal speed; reloading or switching accounts keeps the same running clock. Other open tabs synchronize within 10 seconds. Choose **Hôm nay (Thực tế)** to return to the server clock. Restart both the backend and frontend after updating this implementation; no Prisma migration is required.

Authenticated endpoints: `GET /api/demo-clock` returns `{ serverNow, realNow, simulated, revision }`; `POST /api/demo-clock` accepts `{ "at": "2026-11-29T15:30:00+07:00" }` or `{ "at": null }`. Development/test only; production returns `403 DEMO_DISABLED`. Invalid timestamps return `400`; an ongoing clock transition returns `409 CLOCK_BUSY`. Legacy `X-Demo-Date` request headers no longer control business time.

Business checks, implicit Prisma timestamps and scheduled jobs use this clock. Care generation runs from 00:05, monthly invoices from 00:10 on the first day, medical reminders from 06:00 and business reminders from 07:00 (UTC+7). Moving forward evaluates the selected day and previous billing month; it does not replay every skipped day/month. Authentication, OTPs, payment identifiers and simulator connection lifetimes retain real time.

Clock state is held in one backend process and resets to real time on restart. Use one replica for this demo mode. Moving the clock back does **not** undo data changes, invoice generation or notifications already produced by business jobs. The seed's invoice cutoff remains October 2026; later invoices may be generated by normal runtime jobs after advancing the clock.
