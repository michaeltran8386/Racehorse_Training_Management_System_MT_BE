# Đăng nhập bằng Google

1. Tạo Google OAuth Web Client ID và khai báo chính xác origin của frontend trong Google Cloud. Đặt cùng Client ID vào `GOOGLE_CLIENT_ID` của backend và `VITE_GOOGLE_CLIENT_ID` của frontend; khởi động lại cả hai ứng dụng.
2. Đặt `FRONTEND_URL` thành origin chính xác của frontend. Trong production, frontend và backend cần HTTPS; nếu hai ứng dụng khác site, trình duyệt phải cho phép cookie bên thứ ba.
3. Schema Prisma có thêm bảng `GoogleIdentity`. Theo quy trình của dự án, sau khi kiểm tra thay đổi schema và cơ sở dữ liệu đích, chạy `npx prisma generate` và `npx prisma db push`. Việc áp dụng schema chưa được thực hiện tự động.
4. Đăng nhập chỉ dành cho tài khoản Gmail đã tồn tại và đang hoạt động. Lần đầu đăng nhập liên kết tài khoản với Google subject; không tự tạo tài khoản hoặc cấp quyền mới.

Không ghi Client ID thật vào các tệp mẫu và không đưa Google client secret vào frontend.
