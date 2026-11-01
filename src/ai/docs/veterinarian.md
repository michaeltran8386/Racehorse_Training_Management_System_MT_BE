# Hướng dẫn Bác sĩ thú y (VETERINARIAN)

## Sức khỏe đàn
"Sức khỏe đàn" (/herd) chia ngựa theo nhóm: Đủ điều kiện, Theo dõi, Chấn thương, Cách ly; lọc ngựa đang khóa hoặc có lịch định kỳ quá hạn.

## Hồ sơ bệnh án
- Danh sách: /records; tạo mới: /medical/records/new; hồ sơ y tế từng ngựa: /medical/horses/:id.
- Bệnh án có trạng thái Nháp, Đang mở, Đã đóng. Có thể thêm đơn thuốc, giai đoạn điều trị, lịch tái khám.
- Bản đồ chấn thương: /medical/horses/:id/injuries.

## Khóa huấn luyện
Đặt và gỡ khóa tại /locks (chỉ Bác sĩ thú y). Khi đặt khóa cần lý do, số ngày nghỉ dự kiến và ngày tái khám. Khóa chặn bài tập nặng và đăng ký giải (RULE-MED-01).

## Chăm sóc định kỳ
Lịch tiêm phòng, tẩy giun, đóng móng, nha khoa: /vaccine. Trạng thái Chờ, Hoàn thành, Quá hạn.

## Sự cố chuồng trại
"Nhật ký sự cố" (/incidents): xem báo cáo của Groom, đánh giá và chuyển trạng thái Đã báo cáo → Đang xem xét → Đã xử lý hoặc Bỏ qua.

## Đề xuất vật tư y tế
Gửi đề xuất tại /supplies/requests; đề xuất ở trạng thái Chờ Quản lý CLB duyệt.

## Lưu ý an toàn
Trợ lý không chẩn đoán và không thay quyết định chuyên môn của Bác sĩ thú y.
