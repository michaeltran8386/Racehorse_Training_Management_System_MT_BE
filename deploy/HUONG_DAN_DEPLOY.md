# Hướng dẫn deploy TMEC lên tmec.site (phương án VPS)

> Phương án đang khuyên dùng là bản miễn phí, không cần quản trị server: [HUONG_DAN_DEPLOY_MIEN_PHI.md](HUONG_DAN_DEPLOY_MIEN_PHI.md) (Vercel + Render + Supabase). File này dành cho khi bạn muốn tự quản một VPS luôn bật, ví dụ Oracle Cloud Always Free.

Làm lần lượt từ Bước 0 đến Bước 9. Mỗi bước có mục **Kiểm tra** ở cuối: chỉ sang bước sau khi kiểm tra đạt.

- **Giai đoạn 1 (Bước 0–6):** đưa landing page, trang Điều khoản và trang Quyền riêng tư lên `https://tmec.site`. Hai trang này cần có trước khi đăng ký đăng nhập Google.
- **Giai đoạn 2 (Bước 7–9):** bật backend và database, để đăng nhập và các chức năng hoạt động.
- **Bước 10–13:** Simulator, cập nhật phiên bản, sao lưu, đăng nhập Google (để sau).

---

## Bước 0. Kiến trúc sẽ dựng

Toàn bộ hệ thống chạy trên **một VPS** bằng Docker Compose (file `deploy/docker-compose.prod.yml`):

| Container | Vai trò | Ra Internet? |
|---|---|---|
| `caddy` | Cổng vào duy nhất. Tự xin chứng chỉ HTTPS. Chia đường dẫn: `/api/*` và `/socket.io/*` tới backend, phần còn lại tới frontend | Có (cổng 80, 443) |
| `frontend` | Nginx phục vụ web React. `https://tmec.site/` mở thẳng landing | Không (qua Caddy) |
| `backend` | NestJS API, cổng 3000 | Không (qua Caddy) |
| `postgres` | PostgreSQL 16, dữ liệu nằm trong volume `pgdata` | **Không** |

| Địa chỉ | Nội dung |
|---|---|
| `https://tmec.site` | Landing page |
| `https://tmec.site/login` | Web quản lý |
| `https://tmec.site/privacy`, `https://tmec.site/terms` | Quyền riêng tư, Điều khoản |
| `https://tmec.site/api/docs` | Swagger API |
| `https://sim.tmec.site` | Simulator |

Thư mục trên VPS:

```
/opt/tmec/
├── be/        ← repo Backend (chứa thư mục deploy/)
├── fe/        ← repo Frontend
└── sim-dist/  ← bản build Simulator (tải lên ở Bước 10)
```

---

## Bước 1. Đưa code mới nhất lên GitHub

VPS lấy code bằng `git clone`, nên mọi thay đổi phải có trên GitHub trước.

1. Commit các thay đổi ở repo BE và FE. Nhớ commit cả các file mới: `Dockerfile`, `.dockerignore`, thư mục `deploy/` (BE) và `public/privacy.html`, `public/terms.html`, `public/legal.css`, `nginx.conf` (FE).
2. Push rồi merge vào nhánh sẽ deploy (khuyên dùng `main`).

**Không commit** file `.env` hay `deploy/backend.env`. `.gitignore` đã chặn sẵn hai file này.

**Kiểm tra:** trên GitHub, nhánh `main` của BE có thư mục `deploy/`, và nhánh `main` của FE có file `public/privacy.html`.

---

## Bước 2. Thuê VPS

Cấu hình tối thiểu:

- Hệ điều hành **Ubuntu 24.04 LTS**.
- **2 vCPU, 4 GB RAM, 40 GB SSD**. Build web cần nhiều RAM; với máy 2 GB, bắt buộc làm phần swap ở Bước 4.
- Có **IPv4 tĩnh**.
- Nên chọn khu vực **Singapore hoặc Việt Nam** cho nhanh.

Nhà cung cấp nào cũng được, ví dụ DigitalOcean, Vultr, Linode, hoặc các nhà cung cấp trong nước. Khi tạo máy, chọn đăng nhập bằng **SSH key**.

Tạo SSH key trên Windows (PowerShell), nếu chưa có:

```bash
ssh-keygen -t ed25519 -C "tmec-vps"
```

Dán nội dung file `C:\Users\<tên bạn>\.ssh\id_ed25519.pub` vào ô SSH key của nhà cung cấp.

**Kiểm tra:** bạn có địa chỉ IP của VPS, gọi là `<IP_VPS>`, và đăng nhập được:

```bash
ssh root@<IP_VPS>
```

---

## Bước 3. Trỏ tên miền tmec.site về VPS

Vào trang quản lý DNS ở nơi bạn mua tên miền, rồi tạo 3 bản ghi:

| Loại | Tên (Host) | Giá trị | TTL |
|---|---|---|---|
| A | `@` | `<IP_VPS>` | 300 |
| A | `www` | `<IP_VPS>` | 300 |
| A | `sim` | `<IP_VPS>` | 300 |

Xóa các bản ghi A hoặc CNAME cũ trùng tên, ví dụ trang "parking" mặc định của nhà đăng ký.

**Kiểm tra** (có thể mất 5–30 phút để có hiệu lực): cả ba lệnh dưới đây đều phải trả về `<IP_VPS>`.

```bash
nslookup tmec.site
```

```bash
nslookup www.tmec.site
```

```bash
nslookup sim.tmec.site
```

---

## Bước 4. Cài đặt VPS

Chạy các lệnh dưới đây trong phiên `ssh root@<IP_VPS>`.

### 4.1 Cập nhật hệ thống và bật tường lửa

```bash
apt update && apt upgrade -y
```

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Cổng 5432 (PostgreSQL) **không** được mở. Database chỉ nói chuyện với backend trong mạng nội bộ của Docker.

### 4.2 Tạo swap 4 GB (bắt buộc nếu RAM ≤ 4 GB)

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 4.3 Cài Docker

```bash
curl -fsSL https://get.docker.com | sh
```

**Kiểm tra:** cả hai lệnh dưới đây đều in ra số phiên bản.

```bash
docker --version
```

```bash
docker compose version
```

---

## Bước 5. Đưa code lên VPS

Nếu hai repo đang để **Private**, GitHub sẽ hỏi đăng nhập khi clone:

- Username: tên GitHub của bạn.
- Password: một **Personal Access Token**, không phải mật khẩu GitHub.

Tạo token tại GitHub → Settings → Developer settings → Fine-grained tokens. Chỉ cấp quyền **Contents: Read-only** cho 2 repo này.

```bash
mkdir -p /opt/tmec/sim-dist && cd /opt/tmec
```

```bash
git clone https://github.com/michaeltran8386/Racehorse_Training_Management_System_MT_BE.git be
```

```bash
git clone https://github.com/michaeltran8386/Racehorse_Training_Management_System_MT_FE.git fe
```

Nếu nhánh deploy không phải `main`, thêm `-b <tên-nhánh>` vào lệnh clone.

**Kiểm tra:** lệnh dưới đây liệt kê `docker-compose.prod.yml`, `Caddyfile`, `.env.example`, `backend.env.example`.

```bash
ls /opt/tmec/be/deploy
```

---

## Bước 6. Giai đoạn 1: đưa landing page lên trước

Ở giai đoạn này chỉ chạy `frontend` và `caddy`. Trang landing, `/privacy` và `/terms` hoạt động. Nút Đăng nhập mở được form, nhưng chưa đăng nhập được vì chưa có backend.

### 6.1 Tạo file cấu hình

```bash
cd /opt/tmec/be/deploy && cp .env.example .env
```

Sinh sẵn mật khẩu database (dùng ở Bước 7):

```bash
openssl rand -hex 24
```

Mở file để điền:

```bash
nano .env
```

Điền vào file:

- `POSTGRES_PASSWORD`: chuỗi vừa sinh.
- `ACME_EMAIL`: email của bạn, để Let's Encrypt báo khi chứng chỉ sắp hết hạn.
- `GOOGLE_CLIENT_ID`: để trống.

Lưu bằng `Ctrl+O`, `Enter`, rồi thoát bằng `Ctrl+X`.

### 6.2 Chạy frontend và Caddy

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend caddy
```

Lần đầu mất khoảng 3–8 phút vì phải build web.

**Kiểm tra:**

- `https://tmec.site` hiện landing TMEC với ổ khóa HTTPS trên thanh địa chỉ.
- `https://www.tmec.site` tự chuyển về `https://tmec.site`.
- `https://tmec.site/privacy` và `https://tmec.site/terms` mở được.
- Nếu lỗi, xem log bằng lệnh dưới đây. Thường do DNS ở Bước 3 chưa có hiệu lực, nên Caddy chưa xin được chứng chỉ.

```bash
docker compose -f docker-compose.prod.yml logs caddy --tail=50
```

Đến đây landing đã chạy công khai. Bạn có thể dừng ở đây và làm tiếp Giai đoạn 2 sau.

---

## Bước 7. Giai đoạn 2: cấu hình backend

### 7.1 Tạo file bí mật của backend

```bash
cd /opt/tmec/be/deploy && cp backend.env.example backend.env
```

Sinh 2 khóa JWT. Chạy lệnh dưới đây **2 lần** để lấy 2 chuỗi khác nhau:

```bash
openssl rand -hex 32
```

Mở file để điền:

```bash
nano backend.env
```

| Biến | Điền gì |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Hai chuỗi vừa sinh, mỗi biến một chuỗi khác nhau |
| `SMTP_USER` | Địa chỉ Gmail dùng để gửi OTP |
| `SMTP_PASS` | **App Password** 16 ký tự của Gmail đó, tạo tại https://myaccount.google.com/apppasswords (cần bật xác minh 2 bước trước), không phải mật khẩu Gmail |
| `EMAIL_FROM` | `"TMEC System <gmail-ở-trên@gmail.com>"` |
| `DEV_FIXED_OTP` | Giữ `false`. Đặt `true` thì mã OTP luôn là `123456`, ai cũng đăng ký được |
| `GEMINI_API_KEY` | Key mới của bạn. Key cũ đã lộ nên phải tạo key mới. Có thể để trống |

Bảo vệ file khỏi user khác trên máy:

```bash
chmod 600 backend.env .env
```

---

## Bước 8. Chạy toàn bộ hệ thống

```bash
cd /opt/tmec/be/deploy && docker compose -f docker-compose.prod.yml up -d --build
```

Khi khởi động, backend tự chạy `prisma db push` để tạo bảng trong database trống, rồi mới chạy API.

**Kiểm tra:**

- Xem trạng thái các container bằng lệnh dưới đây. Cả 4 container phải ở trạng thái `running`, riêng `postgres` là `healthy`.

```bash
docker compose -f docker-compose.prod.yml ps
```

- Xem log backend bằng lệnh dưới đây. Log phải có dòng báo backend đang chạy và không có lỗi Prisma.

```bash
docker compose -f docker-compose.prod.yml logs backend --tail=80
```

- `https://tmec.site/api/health` trả về JSON có `"success": true`.

---

## Bước 9. Tạo dữ liệu ban đầu (chạy một lần)

Database đang trống. Nạp dữ liệu mẫu (ngựa, chuồng, tài khoản demo cho 5 vai trò):

```bash
docker compose -f docker-compose.prod.yml exec backend npm run db:seed
```

Lưu ý bảo mật:

- Tài khoản demo dùng **mật khẩu mặc định nằm công khai trong mã nguồn**.
- Ngay sau khi seed, đăng nhập từng tài khoản demo và đổi mật khẩu.
- Nếu không cần dữ liệu demo, đừng chạy lệnh này. Khi đó bạn phải tự tạo tài khoản Quản lý đầu tiên trong database.

**Kiểm tra:** vào `https://tmec.site`, bấm **Đăng nhập**, đăng nhập bằng tài khoản Club Manager, và thấy dashboard có dữ liệu.

---

## Bước 10. Đưa Simulator lên sim.tmec.site

Simulator chưa có repo Git, nên build trên máy bạn rồi tải bản build lên VPS.

Trên máy Windows (PowerShell), trong thư mục `Racehorse_Simulator_Web`:

```bash
$env:VITE_API_URL="https://tmec.site/api"; $env:VITE_SOCKET_URL="https://tmec.site/simulator"; $env:VITE_WS_URL="https://tmec.site"; npm run build
```

```bash
scp -r dist/* root@<IP_VPS>:/opt/tmec/sim-dist/
```

Caddy đọc thẳng thư mục này, nên không cần khởi động lại.

**Kiểm tra:** `https://sim.tmec.site` mở được bản đồ trang trại, và trong DevTools (F12) → Console không có lỗi CORS.

---

## Bước 11. Cập nhật phiên bản mới

Sau khi merge code mới lên GitHub, chạy trên VPS:

```bash
cd /opt/tmec/be && git pull && cd ../fe && git pull
```

```bash
cd /opt/tmec/be/deploy && docker compose -f docker-compose.prod.yml up -d --build
```

Nếu thay đổi có đổi `schema.prisma`, backend tự `db push` khi khởi động. Khi thay đổi làm mất dữ liệu, ví dụ xóa cột hay đổi tên, `db push` sẽ dừng và báo lỗi trong log, chứ không tự xóa dữ liệu. Gặp trường hợp này thì hỏi Lead trước khi xử lý.

Simulator: build và `scp` lại như Bước 10.

---

## Bước 12. Sao lưu database

### 12.1 Sao lưu thủ công

```bash
mkdir -p /opt/tmec/backups && cd /opt/tmec/be/deploy && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U tmec tmec | gzip > /opt/tmec/backups/tmec-$(date +%F).sql.gz
```

### 12.2 Tự động mỗi ngày lúc 3 giờ sáng, giữ 14 bản gần nhất

Mở bảng lịch tự động:

```bash
crontab -e
```

Thêm dòng sau vào cuối:

```
0 3 * * * cd /opt/tmec/be/deploy && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U tmec tmec | gzip > /opt/tmec/backups/tmec-$(date +\%F).sql.gz && ls -t /opt/tmec/backups/*.sql.gz | tail -n +15 | xargs -r rm
```

Thỉnh thoảng nên tải bản sao lưu về máy bạn, vì nếu VPS hỏng thì bản sao lưu nằm trên VPS cũng mất theo:

```bash
scp root@<IP_VPS>:/opt/tmec/backups/tmec-YYYY-MM-DD.sql.gz .
```

### 12.3 Khôi phục từ bản sao lưu

Lệnh này **ghi đè** dữ liệu hiện tại.

```bash
gunzip -c /opt/tmec/backups/tmec-YYYY-MM-DD.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U tmec tmec
```

---

## Bước 13. (Để sau) Bật đăng nhập bằng Google

Hai đường dẫn Google yêu cầu đã có sẵn từ Giai đoạn 1:

- **Application home page:** `https://tmec.site`
- **Application privacy policy link:** `https://tmec.site/privacy`
- **Application terms of service link:** `https://tmec.site/terms`

Landing page đã có link tới hai trang này ở chân trang. Google kiểm tra điều này khi duyệt.

Khi sẵn sàng:

1. **Xác minh tên miền:** vào Google Search Console, thêm `tmec.site` theo kiểu **Domain**, rồi tạo bản ghi **TXT** trong DNS theo hướng dẫn của Google.
2. **Màn hình đồng ý OAuth:** vào Google Cloud Console → APIs & Services → OAuth consent screen.
   - Điền 3 đường dẫn ở trên.
   - Authorized domains: `tmec.site`.
   - Scopes: chỉ cần `email`, `profile`, `openid`.
3. **Tạo Client ID:** vào Credentials → Create OAuth client ID → Web application.
   - Authorized JavaScript origins: `https://tmec.site`.
4. **Điền Client ID vào cấu hình:** chép Client ID vào `GOOGLE_CLIENT_ID` ở **cả hai** file `deploy/.env` và `deploy/backend.env`.
5. **Build lại:** chạy lệnh dưới đây. Frontend phải build lại vì Client ID được gắn vào lúc build.

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend backend
```

**Kiểm tra:** trang `/login` hiện nút **Đăng nhập bằng Google** và đăng nhập được.

---

## Xử lý sự cố nhanh

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Trình duyệt báo không an toàn hoặc lỗi chứng chỉ | DNS chưa trỏ đúng, hoặc cổng 80/443 bị chặn | Làm lại kiểm tra Bước 3 và `ufw status`, xem `logs caddy` |
| Trang đăng nhập báo lỗi mạng | Backend chưa chạy hoặc đang lỗi | `logs backend`, kiểm tra `backend.env` |
| Backend log `P1001 Can't reach database` | Postgres chưa sẵn sàng, hoặc mật khẩu trong `.env` đổi sau lần chạy đầu | Mật khẩu chỉ có tác dụng ở lần tạo volume đầu tiên. Đổi mật khẩu sau đó phải đổi cả trong Postgres |
| Không nhận được email OTP | Sai App Password, hoặc chưa bật xác minh 2 bước | Sửa `SMTP_*` rồi `up -d backend` |
| Build bị dừng giữa chừng (`Killed`) | Hết RAM | Làm Bước 4.2 (swap) |
| Simulator báo lỗi CORS | `SIMULATOR_URL` sai, hoặc build Simulator thiếu biến môi trường | Kiểm tra `backend.env` và lệnh build ở Bước 10 |

Một số lệnh hay dùng, chạy trong `/opt/tmec/be/deploy`:

- Dừng toàn bộ hệ thống (dữ liệu vẫn còn trong volume):

```bash
docker compose -f docker-compose.prod.yml down
```

- Khởi động lại riêng backend:

```bash
docker compose -f docker-compose.prod.yml restart backend
```

- Xem log liên tục:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=100
```

**Không chạy** `docker compose down -v`: lệnh này xóa luôn volume database.
