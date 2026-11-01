# Hướng dẫn deploy TMEC miễn phí: Vercel + Render + Supabase

Làm lần lượt từ Bước 0 đến Bước 9. Mỗi bước có mục **Kiểm tra** ở cuối: chỉ sang bước sau khi kiểm tra đạt.

- **Giai đoạn 1 (Bước 0–3):** đưa landing, `/privacy`, `/terms` lên `https://tmec.site`. Chưa cần backend.
- **Giai đoạn 2 (Bước 4–8):** database Supabase, backend Render, nạp dữ liệu, giữ backend luôn thức.
- **Bước 9–11:** Simulator, cập nhật phiên bản, đăng nhập Google (để sau).

Nếu sau này muốn tự quản một server luôn bật, xem phương án VPS: [HUONG_DAN_DEPLOY.md](HUONG_DAN_DEPLOY.md).

> Hạn mức gói miễn phí của từng dịch vụ có thể thay đổi. Hãy xem lại trang giá của Vercel, Render, Supabase và Resend trước khi bắt đầu.

---

## Bước 0. Kiến trúc sẽ dựng

| Địa chỉ | Chạy ở đâu | Nội dung |
|---|---|---|
| `https://tmec.site` | **Vercel** (repo FE) | Landing, `/privacy`, `/terms`, web quản lý (`/login`, …) |
| `https://api.tmec.site` | **Render** (repo BE, dùng `Dockerfile`) | NestJS API + Socket.IO, Swagger tại `/api/docs` |
| Database | **Supabase** | PostgreSQL |
| `https://sim.tmec.site` | **Vercel** (thư mục Simulator) | Simulator |
| Email OTP | **Resend** | Gửi mail qua HTTP API |

Chọn cùng khu vực **Singapore** cho Supabase và Render để backend gọi database nhanh.

Chuẩn bị:

- Code FE và BE đã commit và push lên GitHub, nhánh `main`. Commit cả các file mới: `vercel.json` và `public/privacy.html`, `terms.html`, `legal.css` (FE), `Dockerfile` và `.dockerignore` (BE).
- Tạo tài khoản bằng GitHub ở: https://vercel.com, https://render.com, https://supabase.com, https://resend.com.

---

## Bước 1. Đưa FE + landing lên Vercel

1. Vercel → **Add New… → Project** → **Import** repo `Racehorse_Training_Management_System_MT_FE`.
2. Vercel tự nhận **Framework Preset: Vite**, Build Command `npm run build`, Output Directory `dist`. Giữ nguyên.
3. Mở **Environment Variables** và thêm:
   - `VITE_API_URL` = `https://api.tmec.site/api`

   Backend chưa có cũng không sao: landing vẫn chạy, chỉ phần đăng nhập chưa dùng được.
4. Bấm **Deploy**.

File `vercel.json` trong repo FE đã cấu hình sẵn:

- `/privacy` và `/terms` mở được không cần đuôi `.html`.
- Mọi đường dẫn của web React (ví dụ `/login`, `/dashboard`) trả về đúng trang khi tải lại.
- Vào `/` sẽ tự chuyển sang landing.

**Kiểm tra:** địa chỉ tạm `https://<tên-project>.vercel.app` hiện landing TMEC; `/privacy` và `/terms` mở được.

---

## Bước 2. Gắn tên miền tmec.site cho Vercel

1. Vào Vercel → project FE → **Settings → Domains**. Thêm `tmec.site`, rồi thêm `www.tmec.site` và chọn chuyển hướng về `tmec.site`.
2. Vercel sẽ hiện các bản ghi DNS cần tạo. Vào trang quản lý DNS ở nơi bạn mua tên miền và tạo **đúng giá trị Vercel hiển thị**. Thường là:

| Loại | Tên (Host) | Giá trị |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

3. Xóa các bản ghi A hoặc CNAME cũ trùng tên, ví dụ trang "parking" mặc định của nhà đăng ký.

**Kiểm tra** (có thể mất 5–30 phút): `https://tmec.site` hiện landing với ổ khóa HTTPS; `https://www.tmec.site` tự chuyển về `https://tmec.site`.

---

## Bước 3. Giai đoạn 1 hoàn tất

Ba đường dẫn cho đăng nhập Google sau này đã sẵn sàng:

- `https://tmec.site`
- `https://tmec.site/privacy`
- `https://tmec.site/terms`

Có thể dừng ở đây và làm Giai đoạn 2 sau.

---

## Bước 4. Tạo database trên Supabase

1. Supabase → **New project**.
   - Đặt tên `tmec`.
   - **Database Password:** bấm *Generate* để tạo, rồi **lưu lại**. Mật khẩu này chỉ gồm chữ và số, nên ghép vào chuỗi kết nối không bị lỗi.
   - **Region:** Southeast Asia (Singapore).
2. Khi project tạo xong, bấm **Connect** ở trên cùng. Chép 2 chuỗi kết nối:

| Biến | Lấy ở đâu | Dạng |
|---|---|---|
| `DATABASE_URL` | **Transaction pooler** (cổng **6543**), thêm đuôi `?pgbouncer=true&connection_limit=1` | `postgresql://postgres.<ref>:<MẬT_KHẨU>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | **Session pooler** (cổng **5432**) | `postgresql://postgres.<ref>:<MẬT_KHẨU>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` |

Thay `<MẬT_KHẨU>` bằng mật khẩu ở bước 1.

Dùng **Session pooler** cho `DIRECT_URL`, không dùng "Direct connection" (`db.<ref>.supabase.co`). Kết nối trực tiếp của gói miễn phí chỉ chạy qua IPv6, mà Render không gọi ra ngoài bằng IPv6 được.

**Kiểm tra:** bạn có đủ 2 chuỗi kết nối, mỗi chuỗi đều đã điền mật khẩu.

---

## Bước 5. Cấu hình gửi email OTP bằng Resend

Render gói miễn phí có thể chặn cổng SMTP (Gmail), nên dùng Resend: nó gửi mail qua HTTPS và backend đã hỗ trợ sẵn (`EMAIL_PROVIDER=resend`).

1. Resend → **Domains → Add Domain** → nhập `tmec.site`.
2. Resend hiện vài bản ghi DNS, gồm một **TXT** và một **MX** cho tên dạng `send`, và một **TXT** cho DKIM. Thêm đúng các bản ghi đó vào DNS của tên miền, rồi bấm **Verify**.
3. **API Keys → Create API Key** → quyền *Sending access* → chép key. Key bắt đầu bằng `re_`.

Chưa xác minh tên miền thì Resend chỉ gửi được tới chính email đăng ký Resend.

**Kiểm tra:** tên miền `tmec.site` trong Resend hiện trạng thái **Verified**.

---

## Bước 6. Đưa backend lên Render

1. Render → **New → Web Service** → chọn repo `Racehorse_Training_Management_System_MT_BE`.
2. Cấu hình service:
   - **Language/Runtime:** Docker. Render tự đọc `Dockerfile`.
   - **Region:** Singapore.
   - **Instance Type:** Free.
   - **Health Check Path:** `/api/health`.
3. Sinh 2 khóa JWT. Mở PowerShell trên máy và chạy lệnh dưới đây **2 lần** để lấy 2 chuỗi khác nhau:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Mở **Environment Variables** và thêm từng biến:

| Biến | Giá trị |
|---|---|
| `NODE_ENV` | `production` |
| `API_PREFIX` | `/api` |
| `FRONTEND_URL` | `https://tmec.site` |
| `SIMULATOR_URL` | `https://sim.tmec.site` |
| `DATABASE_URL` | chuỗi Transaction pooler ở Bước 4 |
| `DIRECT_URL` | chuỗi Session pooler ở Bước 4 |
| `JWT_SECRET` | chuỗi thứ nhất vừa sinh |
| `JWT_REFRESH_SECRET` | chuỗi thứ hai vừa sinh |
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | key `re_…` ở Bước 5 |
| `EMAIL_FROM` | `TMEC System <noreply@tmec.site>` |
| `DEV_FIXED_OTP` | `false` (bắt buộc; `true` thì mã OTP luôn là 123456) |
| `GEMINI_API_KEY` | key Gemini **mới** (có thể để trống: trợ lý chỉ trích đoạn tài liệu) |
| `GEMINI_MODEL` | `gemini-2.0-flash` |
| `AI_DAILY_LIMIT` | `50` |
| `GITHUB_PROJECT_DRY_RUN` | `true` |

Không đặt biến `PORT`, vì Render tự cấp và backend tự đọc.

5. Bấm **Deploy Web Service**. Lần đầu mất khoảng 5–10 phút. Khi khởi động, backend tự chạy `prisma db push` để tạo bảng trong Supabase.

**Kiểm tra:**

- Tab **Logs** có dòng báo backend đang chạy, và không có lỗi Prisma.
- `https://<tên-service>.onrender.com/api/health` trả về JSON có `"success": true`.

### 6.1 Gắn tên miền api.tmec.site

1. Render → service → **Settings → Custom Domains** → thêm `api.tmec.site`.
2. Tạo bản ghi DNS mà Render hiển thị. Thường là:

| Loại | Tên (Host) | Giá trị |
|---|---|---|
| CNAME | `api` | `<tên-service>.onrender.com` |

**Kiểm tra:** `https://api.tmec.site/api/health` trả về `"success": true`.

---

## Bước 7. Nạp dữ liệu ban đầu (chạy một lần, từ máy bạn)

Mở PowerShell trong thư mục `Racehorse_Training_Management_System_MT_BE`. Đặt chuỗi kết nối Supabase cho phiên terminal này; dùng chuỗi **Session pooler** (cổng 5432) cho cả hai biến:

```bash
$env:DATABASE_URL="<chuỗi Session pooler>"; $env:DIRECT_URL="<chuỗi Session pooler>"
```

Nạp dữ liệu mẫu:

```bash
npm run db:seed
```

Đóng cửa sổ terminal ngay sau đó. Nếu để mở, các lệnh `npm` tiếp theo trong cửa sổ này sẽ ghi vào database thật thay vì Docker local.

Lưu ý bảo mật:

- Tài khoản demo dùng **mật khẩu mặc định nằm công khai trong mã nguồn**.
- Ngay sau khi seed, đăng nhập từng tài khoản demo và đổi mật khẩu.

**Kiểm tra:** vào `https://tmec.site`, bấm **Đăng nhập**, đăng nhập bằng tài khoản Club Manager, và thấy dashboard có dữ liệu.

---

## Bước 8. Giữ backend không ngủ (UptimeRobot)

Render gói miễn phí cho server ngủ sau khoảng 15 phút không có ai truy cập. Khi ngủ, người vào đầu tiên phải chờ khoảng 1 phút, và các tác vụ chạy theo lịch (nhắc tiêm phòng, quét sự cố) không chạy.

1. Đăng ký https://uptimerobot.com (miễn phí).
2. **New Monitor** → loại **HTTP(s)**.
   - URL: `https://api.tmec.site/api/health`
   - Interval: **5 minutes**.

Monitor này cũng giữ Supabase hoạt động: project Supabase miễn phí sẽ tạm dừng nếu 1 tuần không có truy cập, mà `/api/health` thì có truy cập database.

**Kiểm tra:** monitor hiện **Up**. Sau 30 phút không ai dùng web, mở `https://tmec.site/login` và đăng nhập, trang phải phản hồi ngay chứ không chờ cả phút.

---

## Bước 9. Đưa Simulator lên sim.tmec.site

Simulator chưa có repo Git, nên deploy bằng Vercel CLI từ máy bạn.

Mở PowerShell trong thư mục `Racehorse_Simulator_Web`. Lần đầu chạy lệnh dưới đây và trả lời các câu hỏi: đăng nhập, tạo project mới tên `tmec-sim`, giữ các thiết lập Vite mặc định.

```bash
npx vercel
```

Thêm biến môi trường (mỗi lệnh sẽ hỏi giá trị, dán vào rồi chọn môi trường **Production**):

```bash
npx vercel env add VITE_API_URL
```

Giá trị: `https://api.tmec.site/api`

```bash
npx vercel env add VITE_SOCKET_URL
```

Giá trị: `https://api.tmec.site/simulator`

```bash
npx vercel env add VITE_WS_URL
```

Giá trị: `https://api.tmec.site`

Deploy bản chính thức:

```bash
npx vercel --prod
```

Cuối cùng vào Vercel → project `tmec-sim` → **Settings → Domains** → thêm `sim.tmec.site`, rồi tạo bản ghi DNS:

| Loại | Tên (Host) | Giá trị |
|---|---|---|
| CNAME | `sim` | `cname.vercel-dns.com` |

**Kiểm tra:** `https://sim.tmec.site` mở được bản đồ trang trại, và DevTools (F12) → Console không có lỗi CORS.

---

## Bước 10. Cập nhật phiên bản mới

| Phần | Cách cập nhật |
|---|---|
| FE + landing | Push lên `main`, Vercel tự build và deploy |
| Backend | Push lên `main`, Render tự build và deploy, tự chạy `prisma db push` |
| Simulator | Chạy lại `npx vercel --prod` trong thư mục Simulator |

Nếu thay đổi có đổi `schema.prisma` theo kiểu làm mất dữ liệu (xóa cột, đổi tên), `db push` sẽ dừng và Render báo deploy lỗi, chứ không tự xóa dữ liệu. Gặp trường hợp này thì hỏi Lead trước khi xử lý.

Sao lưu database: Supabase → **Database → Backups**. Gói miễn phí không có bản sao lưu tải về được, nên thỉnh thoảng hãy tự xuất dữ liệu bằng `pg_dump` với chuỗi Session pooler.

---

## Bước 11. (Để sau) Bật đăng nhập bằng Google

Khai báo với Google:

- **Application home page:** `https://tmec.site`
- **Application privacy policy link:** `https://tmec.site/privacy`
- **Application terms of service link:** `https://tmec.site/terms`
- **Authorized domains:** `tmec.site`
- **Authorized JavaScript origins:** `https://tmec.site`

Các bước:

1. Xác minh tên miền trong Google Search Console bằng bản ghi TXT.
2. Vào Google Cloud Console → **OAuth consent screen**, điền các đường dẫn ở trên. Scopes chỉ cần `email`, `profile`, `openid`.
3. **Credentials → Create OAuth client ID → Web application**, đặt Authorized JavaScript origins là `https://tmec.site`.
4. Thêm biến `GOOGLE_CLIENT_ID` vào **Render** (backend), và `VITE_GOOGLE_CLIENT_ID` vào **Vercel** (FE).
5. **Redeploy** cả hai: FE phải build lại vì Client ID được gắn vào lúc build.

Backend (`api.tmec.site`) và web (`tmec.site`) cùng tên miền gốc, nên cookie phiên Google gửi được giữa hai bên.

**Kiểm tra:** trang `/login` hiện nút **Đăng nhập bằng Google** và đăng nhập được.

---

## Xử lý sự cố nhanh

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Đăng nhập báo lỗi mạng hoặc CORS | `VITE_API_URL` trên Vercel sai, hoặc `FRONTEND_URL` trên Render sai | Sửa biến rồi **Redeploy**. FE phải build lại mới nhận biến mới |
| Render log `P1001 Can't reach database` | `DIRECT_URL` đang dùng Direct connection (IPv6), hoặc sai mật khẩu | Dùng chuỗi **Session pooler** như Bước 4 |
| Lỗi `prepared statement "s0" already exists` | `DATABASE_URL` thiếu `?pgbouncer=true` | Thêm đuôi như Bước 4 |
| Không nhận được email OTP | Tên miền chưa Verified trên Resend, hoặc `EMAIL_FROM` không thuộc `tmec.site` | Làm lại Bước 5; giữ `EMAIL_FROM` ở dạng `…@tmec.site` |
| Lần đầu vào web chờ rất lâu | Backend đang ngủ | Kiểm tra UptimeRobot ở Bước 8 |
| Tải lại trang `/dashboard` bị 404 | Thiếu `vercel.json` trong repo FE | Commit `vercel.json` rồi push |
