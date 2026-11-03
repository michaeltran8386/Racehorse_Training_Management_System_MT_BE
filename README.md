# 🐎 EquiFlow — Racehorse Training & Stable Management System (Backend API)

[![Backend CI / CD Pipeline](https://github.com/MichaelTran1226/Racehorse_Training_Management_System_MT_BE/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelTran1226/Racehorse_Training_Management_System_MT_BE/actions)
[![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8%2B-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Jest Tests](https://img.shields.io/badge/Tests-769%20Pass%20(57%20Suites)-brightgreen.svg)](https://github.com/MichaelTran1226/Racehorse_Training_Management_System_MT_BE)
[![Port](https://img.shields.io/badge/Port-3000-purple.svg)](http://localhost:3000)

Phân hệ máy chủ Backend RESTful API và Realtime WebSocket Gateway phục vụ toàn diện hệ thống quản lý câu lạc bộ huấn luyện ngựa đua **EquiFlow (Thien Ma Equestrian Club - TMEC)** thuộc Đồ án SWP391 — Đại học FPT.

---

## 🚀 1. Khởi Động Nhanh (Quick Start)

### Yêu cầu tiên quyết:
- **Node.js**: Phiên bản 22.x hoặc 24.x LTS (`node -v`)
- **Docker Desktop** (khuyến nghị cho database PostgreSQL 16) hoặc PostgreSQL 16 cài trực tiếp trên máy.

### Các bước cài đặt:

```bash
# 1. Cài đặt các thư viện phụ thuộc
npm install

# 2. Cấu hình biến môi trường
# Trên Windows PowerShell:
Copy-Item .env.example .env
# Trên Linux / macOS:
cp .env.example .env

# 3. Khởi chạy cơ sở dữ liệu PostgreSQL bằng Docker
docker compose up -d

# 4. Đồng bộ Schema Prisma và nạp dữ liệu mẫu hoàn chỉnh (Seed Data)
npm run db:setup

# 5. Khởi động Backend ở chế độ phát triển
npm run start:dev
```

Server sẽ sẵn sàng phục vụ tại: **`http://localhost:3000`**  
- **API Prefix:** `/api`
- **Kiểm tra trạng thái:** `GET http://localhost:3000/api/health` trả về `{"status":"ok","database":{"connected":true}}`

---

## 🔑 2. Tài Khoản Dùng Thử (Demo Seed Accounts)

Mật khẩu mặc định cho toàn bộ tài khoản mẫu: **`EquiFlow@2026`**  
Mã OTP xác thực mặc định (khi bật `DEV_FIXED_OTP=true`): **`123456`**

| Vai Trò (Role) | Email Đăng Nhập | Mật Khẩu | Quyền Hạn Chính |
| :--- | :--- | :---: | :--- |
| **Club Manager** | `manager@gmail.com` | `EquiFlow@2026` | Quản trị tài khoản, duyệt thành viên, cấu hình chuồng trại, xem nhật ký kiểm toán (Audit Log) |
| **Head Trainer** | `trainer@gmail.com` | `EquiFlow@2026` | Lập giáo án huấn luyện thông minh, theo dõi bài tập, giám sát thể lực ngựa, đăng ký giải đấu |
| **Veterinarian** | `vet@gmail.com` | `EquiFlow@2026` | Hồ sơ bệnh án điện tử, khám lâm sàng, cấp khóa y tế (Medical Lock), lịch chăm sóc định kỳ |
| **Groom** | `groom@gmail.com` | `EquiFlow@2026` | Danh sách công việc ca trực (Daily Checklist), cho ăn, dọn chuồng, theo dõi tồn kho vật tư |
| **Horse Owner** | `owner@gmail.com` | `EquiFlow@2026` | Xem hồ sơ và sức khỏe ngựa của riêng mình, theo dõi hóa đơn và báo cáo tài chính |

---

## 🛠️ 3. Cấu Hình Biến Môi Trường (`.env`)

Tệp `.env.example` đã chuẩn bị sẵn các giá trị mặc định cho môi trường phát triển cục bộ:

```env
# Server
PORT=3000
NODE_ENV=development
API_PREFIX=/api
FRONTEND_URL=http://localhost:5173
SIMULATOR_URL=http://localhost:5175

# Database (PostgreSQL Docker cục bộ)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/equiflow?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/equiflow?schema=public"

# Bảo mật JWT
JWT_SECRET="equiflow-secure-jwt-secret-replace-in-production-2026"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="equiflow-secure-refresh-jwt-secret-replace-in-production-2026"
JWT_REFRESH_EXPIRES_IN="7d"

# Đăng nhập Google (Tùy chọn)
GOOGLE_CLIENT_ID=""

# Dịch vụ gửi Email (resend / smtp / mock)
# Ở môi trường dev, bật DEV_FIXED_OTP=true thì mã OTP luôn là 123456
EMAIL_PROVIDER="mock"
DEV_FIXED_OTP=true
```

---

## 🧪 4. Kiểm Thử & Đảm Bảo Chất Lượng (Quality Gates)

Backend tuân thủ nghiêm ngặt các tiêu chuẩn kiểm thử tự động trên CI/CD Pipeline:

```bash
# Kiểm tra TypeScript typecheck (0 lỗi)
npm run typecheck

# Kiểm tra định dạng code Prettier & ESLint
npm run lint

# Tự động sửa lỗi định dạng
npm run format

# Chạy toàn bộ 57 test suites (769 tests)
npm test

# Chạy unit tests riêng biệt
npm run test:unit

# Chạy black-box API tests
npm run test:e2e
```

---

## 🏛️ 5. Kiến Trúc & Cấu Trúc Thư Mục

```
src/
├── accounts/          # Quản lý tài khoản, thông tin cá nhân, cập nhật SĐT/họ tên
├── ai/                # Trợ lý AI Assistant (Google Gemini RAG)
├── audit/             # Ghi nhận và xuất nhật ký kiểm toán (Audit Trail)
├── auth/              # Xác thực JWT, Refresh Token, OTP Email, Google Sign-in
├── common/            # Decorators, Guards (RBAC, Permissions, Throttler), Filters
├── daily-tasks/       # Bảng phân việc hàng ngày và tự động sinh lịch trực
├── financial/         # Hóa đơn, chi phí chuồng trại, báo cáo tài chính chủ ngựa
├── health/            # Health check endpoint hệ thống (/api/health)
├── horse-catalogs/    # Danh mục giống ngựa, màu lông, nguồn gốc
├── horses/            # Hồ sơ chiến mã, lịch sử trạng thái, chỉ số cân nặng/chiều cao
├── incidents/         # Ghi nhận sự cố bất thường và cảnh báo khẩn cấp
├── inventory/         # Quản lý tồn kho vật tư, tiếp tế chuồng trại
├── mail/              # Module gửi email thông báo và mã OTP
├── medical/           # Bệnh án điện tử, bản đồ chấn thương, Khóa y tế (Medical Lock)
├── notifications/     # Hệ thống thông báo đa kênh trong ứng dụng
├── nutrition/         # Khẩu phần dinh dưỡng và kế hoạch bữa ăn
├── prisma/            # Prisma Service kết nối cơ sở dữ liệu
├── shift-rosters/     # Phân công ca trực cho nhân viên chuồng trại (Groom)
├── shifts/            # Danh mục định nghĩa ca làm việc
├── simulator/         # Socket.IO Gateway & REST API cầu nối Simulator Web
├── stalls/            # Sơ đồ và phân bổ ô chuồng trại 2D
├── supplies/          # Danh mục vật tư tiêu hao (cỏ, yến mạch, rơm, thuốc thú y)
├── tournaments/       # Giải thi đấu, phân làn đường đua và ghi nhận kết quả
├── training/          # Giáo án huấn luyện, bài tập, đo lường nhịp tim & thể lực
└── users/             # Quản lý ma trận phân quyền người dùng
```

---

## 👥 Đóng Góp & Quy Trình Git
1. Luôn tạo nhánh từ `dev` theo tiền tố: `feat/...` hoặc `fix/...`.
2. Chạy `npm run lint` và `npm run typecheck` trước khi push code.
3. Tạo Pull Request vào nhánh `dev` để kích hoạt GitHub Actions CI/CD Pipeline tự động.
