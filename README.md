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

## 4. Dữ liệu mẫu chuẩn theo vòng đời (Canonical Full Seed 07/2026 – 12/2026)

Một bộ seed chuẩn duy nhất tại `prisma/seed.ts` phủ kín **38/38 bảng Prisma** với **19 chiến mã** (đủ 8 giống ngựa chính + 1 giống `Morgan` ngừng kích hoạt, đủ 7 `HorseStatus`, ngựa `RETIRED` nhả ô chuồng theo `BR-STL-07`), **32 ô chuồng** (Khu A, B, C, H), **8 giải đấu**, chuỗi hóa đơn **6 tháng (2026-07 – 2026-12)** và lịch trực **10 Groom**:

```powershell
# Nạp dữ liệu chuẩn (an toàn chạy nhiều lần, giữ nguyên dữ liệu mới trên DB đã có)
npm run db:seed

# Xóa sạch dữ liệu cũ và nạp lại từ đầu (chỉ dùng cho môi trường dev/local)
npm run db:seed -- --reset
```

Khi deploy bằng Docker (`Dockerfile`), container tự động chạy `npx prisma db push --skip-generate`, kiểm tra nếu bảng `User` đang trống (`count === 0`) sẽ tự động thực thi `npm run db:seed` một lần trước khi khởi động API.

| Màn hình demo            | Dữ liệu để kiểm tra                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard HLV**        | Giáo án `DRAFT`/`ACTIVE`/`COMPLETED`/`CANCELLED`; lịch tập hôm nay và lịch sử 35+ ngày phục vụ ACWR; mô phỏng `WORKOUT`/`RACE`/`EXAM`.                                                 |
| **Phong độ & Giải đấu**  | 4 giải `COMPLETED` (T7–T10 chia thưởng 85/10/5), giải T11 `CLOSED_REGISTRATION` & `OPEN_REGISTRATION`, giải T12 `UPCOMING`, và mẫu `CANCELLED`.                                        |
| **Hồ sơ Thú y**          | Bệnh án `OPEN`/`CLOSED`/`DRAFT` (tối đa 1 `OPEN`/ngựa theo PR #153), Khóa y tế (Xích Thố, Tuyết Ảnh, Lôi Chấn), lịch phòng ngừa đủ 4 loại (gồm `FARRIER_HOOF_CARE`) & 5 loại thực đơn. |
| **Tài chính & Sao kê**   | Hóa đơn 6 tháng (2026-07 đến 2026-12) đủ 5 trạng thái (`PAID`, `SENT`, `DRAFT`, `OVERDUE`, `CANCELLED`); Dạ Nguyệt lưu giữ Khu H; Xích Thố có hóa đơn quá hạn T9–T10.                  |
| **Chuồng trại & Vật tư** | Sơ đồ 4 phân khu A (`3x4`), B (`3x4`), C (`2x2`), H (`2x2`); đủ 7 nhóm vật tư, cảnh báo tồn kho, phiếu nhập đủ 5 trạng thái và sự cố đủ 4 trạng thái.                                  |

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
