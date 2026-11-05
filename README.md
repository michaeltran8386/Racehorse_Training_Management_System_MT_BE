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

| Vai trò (Role) | Email | Họ và tên | Trạng thái | Nghiệp vụ chính |
| :--- | :--- | :--- | :--- | :--- |
| **Club Manager** | `manager@gmail.com` | Michael Tran | `ACTIVE` | Quản trị tài khoản, phân quyền, sơ đồ chuồng, xem audit log |
| **Head Trainer** | `trainer@gmail.com` | David Nguyen | `ACTIVE` | Lập giáo án huấn luyện, xếp lịch bài tập, ghi nhận kết quả |
| **Veterinarian** | `vet@gmail.com` | Dr. Sarah Connor | `ACTIVE` | Khám lâm sàng, đặt/mở Khóa Y Tế, chấm chấn thương 2D |
| **Groom Hand 1** | `groom@gmail.com` | John Smith | `ACTIVE` | Chăm sóc chuồng Barn 1 (A01-A03), thực hiện bài tập nhẹ |
| **Groom Hand 2** | `groom2@gmail.com` | Lê Văn Phúc | `ACTIVE` | Chăm sóc chuồng Barn 2 & Khu cách ly |
| **Horse Owner 1** | `owner@gmail.com` | Robert Sterling | `ACTIVE` | Chủ sở hữu Thunderbolt Swift, Pegasus Dream, Midnight Mirage |
| **Horse Owner 2** | `owner2@gmail.com` | Phan Đức Long | `ACTIVE` | Chủ sở hữu Northern Dancer Legacy, Shadowfax Wonder |
| **Pending User** | `pending.groom@gmail.com`| Trần Văn Nam | `PENDING_APPROVAL`| Tài khoản chờ duyệt để test chức năng Approve / Reject của Manager |
| **Invited User** | `invited.vet@gmail.com` | Dr. Alexander Bell | `INVITED` | Bác sĩ được mời qua email, test tính năng Resend / Cancel Invite |
| **Locked User** | `locked.user@gmail.com` | Đặng Tuấn Kiệt | `LOCKED` | Tài khoản bị khóa, test tính năng Mở khóa (Unlock) |

---

## 4. Dữ liệu mẫu theo vòng đời

Seed tạo 12 ngựa, 20 ô chuồng và dữ liệu cho cả 37 model. Ngày tập, ngày đua, hạn trả và lịch chăm sóc được neo theo ngày chạy seed tại CLB (UTC+7).

Dùng **một CSDL PostgreSQL cục bộ riêng** tên `equiflow_seed_demo` (CI dùng `racehorse_ci`). Tạo CSDL mới một lần trong PostgreSQL Docker đang chạy:

```powershell
docker compose exec postgres createdb -U postgres equiflow_seed_demo
```

Trong cửa sổ PowerShell dùng để seed và chạy BE, đặt hai URL theo cấu hình Docker local:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/equiflow_seed_demo?schema=public'
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma generate
npx prisma db push --skip-generate
npx prisma db seed
npx ts-node test/seed-lifecycle.check.ts
npm run start:dev
```

`npm run db:seed` chạy cùng script. Có thể chạy lại để đưa lịch về ngày hiện tại; script xây lại các giao dịch mẫu trong một transaction, giữ tài khoản mẫu theo ID ổn định và dừng nếu khóa trùng dữ liệu khác. Không trỏ seed vào CSDL đang sử dụng hoặc Supabase. Nếu đang có bộ seed cũ, dùng CSDL demo mới để tránh trùng mã ngựa/chuồng; không cần xóa CSDL cũ.

| Màn hình demo | Dữ liệu để kiểm tra |
| --- | --- |
| Dashboard HLV | Bạch Long Mã (08:00, cỏ) và Thần Phong (08:15, cỏ); Hắc Báo (09:30, cát), Dạ Nguyệt (14:00, bơi) và lịch 14 ngày tiếp theo. Sau giờ tập hôm nay, card lấy buổi còn lại hoặc buổi ngày mai. |
| Phong độ và giải đấu | Hơn 35 buổi có kết quả cho từng ngựa Bạch Long Mã, Lão Tướng và Lôi Chấn; Lão Tướng đã giải nghệ với 3 lần nhất, 2 lần nhì. Cúp Mùa Đông diễn ra sau 20 ngày và đang mở đăng ký. |
| Thú y | Xích Thố có bệnh án mở, khóa tập nặng và lịch tái khám sau 7 ngày. Tuyết Ảnh cách ly tại C01; Dạ Nguyệt đang phục hồi. |
| Tài chính | 4 hóa đơn cho các tháng đã kết thúc: đã trả 14.500.000đ, quá hạn 6.000.000đ, đã phát hành 8.200.000đ và chưa phát hành. |
| Groom và kho | Phân ca 7 ngày, việc cho ăn/vệ sinh hôm nay, 2 mặt hàng dưới ngưỡng tồn, phiếu chờ duyệt/đã duyệt/đã giao và sự cố B04. |

Tài khoản demo: `manager`, `trainer`, `trainer2`, `vet`, `groom`, `groom2`, `groom3`, `owner`, `owner2` (tất cả thêm `@gmail.com`). Mật khẩu demo: `EquiFlow@2026`. Các bản ghi OTP, reset, refresh phục vụ kiểm thử đều đã hết hạn hoặc bị thu hồi.

---

## 5. Danh mục Lệnh Phát Triển & Kiểm Thử

| Lệnh | Ý nghĩa |
| :--- | :--- |
| `npm run start:dev` | Khởi động server NestJS chế độ Hot-reload |
| `npm run db:up` | Khởi chạy PostgreSQL container bằng Docker Compose |
| `npm run db:down` | Dừng và tắt PostgreSQL container |
| `npm run db:setup` | Đẩy bảng Prisma và nạp toàn bộ 100% dữ liệu mẫu |
| `npm run db:seed` | Chỉ chạy lại script nạp dữ liệu mẫu |
| `npm run db:studio` | Mở giao diện trực quan Prisma Studio tại port 5555 |
| `npm run typecheck` | Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (`tsc --noEmit`) |
| `npm run test:unit` | Chạy 100% Unit test suite bằng Jest (28 suites, 267 tests) |
| `npm run build` | Biên dịch toàn bộ dự án NestJS ra thư mục `/dist` |
| `npm run lint` | Chạy ESLint kiểm tra quy chuẩn mã nguồn |

---

## 6. Tài liệu & OpenAPI Swagger

* **Swagger UI Interactive Documentation:** `http://localhost:3000/api/docs`
* **Health Check Probe:** `GET http://localhost:3000/api/health`
