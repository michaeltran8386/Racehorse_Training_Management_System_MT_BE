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

# 3. Trỏ DATABASE_URL và DIRECT_URL vào equiflow_seed_demo (xem mục 4)
# Sau đó đồng bộ schema và nạp 12 ngựa mẫu
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
SMTP_USER="tmec8386@gmail.com"
SMTP_PASS="dvmltzcfkshuttno"
EMAIL_FROM="EquiFlow System <tmec8386@gmail.com>"

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

Mật khẩu mặc định cho tất cả các tài khoản: **`EquiFlow@2026`**

| Vai trò (Role)     | Email                                | Họ và tên            | Trạng thái | Nghiệp vụ chính                                                         |
| :----------------- | :----------------------------------- | :------------------- | :--------- | :---------------------------------------------------------------------- |
| **Club Manager**   | `manager@gmail.com`                  | Trần Quang Minh      | `ACTIVE`   | Quản trị tài khoản, phân quyền, sơ đồ chuồng, xem audit log, lập sao kê |
| **Head Trainer 1** | `trainer@gmail.com`                  | Nguyễn Văn Tuấn      | `ACTIVE`   | Lập giáo án huấn luyện, xếp lịch bài tập, ghi nhận kết quả thi đấu      |
| **Head Trainer 2** | `trainer2@gmail.com`                 | Lê Hoàng Nam         | `ACTIVE`   | Phụ trách huấn luyện nhóm ngựa đua Barn 2 & Cự ly kinh điển             |
| **Veterinarian**   | `vet@gmail.com`                      | BS. Phạm Minh Trí    | `ACTIVE`   | Khám lâm sàng, đặt/mở Khóa Y Tế, sơ đồ chấn thương 2D                   |
| **Groom Hand 1**   | `groom@gmail.com`                    | Lê Văn Bình          | `ACTIVE`   | Chăm sóc chuồng Barn 1 (A01-A08), tiếp tế thức ăn & vật tư              |
| **Groom Hand 2**   | `groom2@gmail.com`                   | Hoàng Văn Phúc       | `ACTIVE`   | Chăm sóc chuồng Barn 2 (B01-B08) & xử lý sự cố chuồng                   |
| **Groom Hand 3**   | `groom3@gmail.com`                   | Đỗ Thị Mai           | `ACTIVE`   | Chăm sóc Khu Cách ly (C01) & Khu Lưu giữ nợ phí (Zone H)                |
| **Horse Owner 1**  | `owner@gmail.com`                    | Phạm Gia Bảo         | `ACTIVE`   | Sở hữu Bạch Long Mã, Xích Thố, Kim Long, Vân Tiêu                       |
| **Horse Owner 2**  | `owner2@gmail.com`                   | Đặng Hoàng Yến       | `ACTIVE`   | Sở hữu Thần Phong, Lão Tướng, Tuyết Ảnh, Lôi Chấn                       |
| **Horse Owner 3**  | `owner3@gmail.com`                   | Vũ Quốc Hưng         | `ACTIVE`   | Chủ ngựa VIP sở hữu Hắc Báo, Hồng Kỳ                                    |
| **Horse Owner 4**  | `owner4@gmail.com`                   | Trịnh Bích Ngọc      | `ACTIVE`   | Chủ ngựa có ngựa nợ phí: Dạ Nguyệt (Zone H), Thanh Loan                 |
| **Locked User**    | `equiflow-expired-fixture@gmail.com` | Tài khoản thử nghiệm | `LOCKED`   | Kiểm thử xử lý tài khoản bị khóa                                        |

---

## 4. Dữ liệu mẫu theo vòng đời (Lifecycle Seed 07/2026 – 12/2026)

Bộ dữ liệu mẫu phủ kín **6 tháng liên tục (07/2026 đến 12/2026)** với 12 chiến mã, 20 ô chuồng, 4 giải đấu hoàn thành và chuỗi 31 hóa đơn sao kê thực tế:

```powershell
# Chạy nạp dữ liệu mẫu
npm run db:seed
```

| Màn hình demo            | Dữ liệu để kiểm tra                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard HLV**        | Lịch tập ngày hôm nay và chuỗi lịch tập tuần; bài tập nền tảng và bứt tốc trải dài từ tháng 7 đến tháng 11; chỉ số ACWR tính toán chuẩn xác không bị đứt đoạn.                                                                                                         |
| **Phong độ & Giải đấu**  | Các giải đua hoàn tất: Giải Đua Mùa Hè Rực Lửa (T7), Cúp Quốc Gia (T8), Cúp Cự Ly Kinh Điển, Giải Vô Địch Mùa Thu (T10); Cúp Mùa Đông (T11) mở đăng ký; Cúp Tân Niên (T12) sắp diễn ra.                                                                                |
| **Hồ sơ Thú y**          | Xích Thố có bệnh án mở và Khóa y tế; các ca khám định kỳ tiêm vaccine tháng 7, nha khoa tháng 8; Tuyết Ảnh cách ly tại C01; Dạ Nguyệt hồi phục tại H01.                                                                                                                |
| **Tài chính & Sao kê**   | **31 hóa đơn** phân bổ 6 tháng (2026-07 đến 2026-12) với 4 trạng thái: 19 Đã thanh toán (`PAID`), 3 Đã gửi (`SENT`), 4 Chưa gửi (`DRAFT`), và **5 Quá hạn (`OVERDUE`)** với tổng dư nợ **49.000.000 đ** (Dạ Nguyệt nợ T8, T9, T10 ở Zone H; Xích Thố nợ y tế T9, T10). |
| **Chuồng trại & Vật tư** | Sơ đồ 4 phân khu: Barn 1 (A), Barn 2 (B), Cách ly (C), và Khu Lưu giữ nợ phí (Zone H) chứa chiến mã có công nợ quá hạn kéo dài.                                                                                                                                        |

Tài khoản demo: `manager`, `trainer`, `trainer2`, `vet`, `groom`, `groom2`, `groom3`, `owner`, `owner2` (tất cả thêm `@gmail.com`). Mật khẩu demo: `EquiFlow@2026`. Các bản ghi OTP, reset, refresh phục vụ kiểm thử đều đã hết hạn hoặc bị thu hồi.

---

## 5. Danh mục Lệnh Phát Triển & Kiểm Thử

| Lệnh                | Ý nghĩa                                                         |
| :------------------ | :-------------------------------------------------------------- |
| `npm run start:dev` | Khởi động server NestJS chế độ Hot-reload                       |
| `npm run db:up`     | Khởi chạy PostgreSQL container bằng Docker Compose              |
| `npm run db:down`   | Dừng và tắt PostgreSQL container                                |
| `npm run db:setup`  | Đẩy bảng Prisma và nạp toàn bộ 100% dữ liệu mẫu                 |
| `npm run db:seed`   | Chỉ chạy lại script nạp dữ liệu mẫu                             |
| `npm run db:studio` | Mở giao diện trực quan Prisma Studio tại port 5555              |
| `npm run typecheck` | Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (`tsc --noEmit`) |
| `npm run test:unit` | Chạy 100% Unit test suite bằng Jest (28 suites, 267 tests)      |
| `npm run build`     | Biên dịch toàn bộ dự án NestJS ra thư mục `/dist`               |
| `npm run lint`      | Chạy ESLint kiểm tra quy chuẩn mã nguồn                         |

---

## 6. Tài liệu & OpenAPI Swagger

- **Swagger UI Interactive Documentation:** `http://localhost:3000/api/docs`
- **Health Check Probe:** `GET http://localhost:3000/api/health`
