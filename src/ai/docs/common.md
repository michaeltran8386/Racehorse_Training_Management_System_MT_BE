# Hướng dẫn chung TMEC (mọi vai trò)

## Trợ lý TMEC làm được gì
Trợ lý TMEC chỉ đọc dữ liệu trong phạm vi quyền của bạn và gợi ý màn hình cần mở (RULE-AI-01). Trợ lý không tạo, sửa, xóa dữ liệu, không duyệt phiếu, không đặt hay gỡ khóa y tế. Mọi thay đổi do bạn tự thực hiện trên màn hình tương ứng, có bước xác nhận.

## Số liệu lấy từ đâu
Số liệu (số ngựa, tồn kho, ca trực, chi phí…) do hệ thống tính từ cơ sở dữ liệu tại thời điểm hỏi, kèm mốc thời gian "asOf". Trợ lý chỉ diễn giải, không tự ước lượng con số.

## Phạm vi dữ liệu theo vai trò (RULE-RBAC-01)
- Quản lý CLB thấy toàn bộ CLB.
- HLV Trưởng thấy ngựa và giáo án do mình phụ trách.
- Bác sĩ thú y thấy hồ sơ y tế của toàn bộ đàn.
- Groom thấy ngựa mình được phân công chăm sóc và ca trực của mình.
- Chủ ngựa chỉ thấy ngựa và hóa đơn của chính mình.

## Khóa y tế (RULE-MED-01)
Ngựa đang bị Khóa huấn luyện không được xếp bài tập nặng và không được đăng ký thi đấu. Chỉ Bác sĩ thú y đặt và gỡ khóa tại màn "Khóa huấn luyện" (/locks). Trong thời gian khóa, việc chăm sóc hằng ngày được thay bằng ngâm chân nước đá / chườm lạnh.

## Đổi mật khẩu, thông báo
- Hồ sơ cá nhân: /profile; đổi mật khẩu: /profile/password.
- Thông báo trong ứng dụng: /notifications; cài đặt nhận thông báo: /settings/notifications.
