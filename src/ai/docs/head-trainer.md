# Hướng dẫn HLV Trưởng (HEAD_TRAINER)

## Giáo án
- Tổng quan huấn luyện: /training. Danh sách giáo án: /plans; tạo giáo án mới: /plans/new.
- Giáo án có trạng thái Nháp, Đang chạy, Hoàn thành, Đã hủy. Chỉ thấy giáo án do mình phụ trách.

## Lịch tập và buổi tập
- Lịch tuần: /calendar. Chạy thử: /trials. Chỉ số buổi tập: /metrics.
- Buổi tập có trạng thái Đã lên lịch, Hoàn thành, Bị chặn, Bỏ lỡ, Đã hủy. Buổi tập của ngựa đang khóa y tế tự chuyển sang Bị chặn.
- Ghi kết quả buổi tập tại /training/sessions/:id/result.

## Giám sát
- Telemetry buổi tập: /monitor. Cảnh báo vượt ngưỡng: /alerts.
- Tiến độ huấn luyện từng ngựa: /progress; biểu đồ thể lực: /horses/:id/fitness.

## Khi ngựa bị khóa y tế
Không xếp bài nặng, không đăng ký giải. Xem lý do và ngày tái khám tại /locks. Chỉ Bác sĩ thú y gỡ khóa.

## Khẩu phần và vật tư
- Khẩu phần ăn: /rations (HLV lập, Bác sĩ thú y duyệt).
- Xem tồn kho theo khu: /supplies/inventory.
