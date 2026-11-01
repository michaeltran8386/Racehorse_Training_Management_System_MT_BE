# Hướng dẫn Quản lý CLB (CLUB_MANAGER)

## Tài khoản và phân quyền
- Duyệt đăng ký mới, khóa/mở tài khoản tại "Tài khoản" (/accounts). Ma trận quyền từng người: /accounts/:id/permissions.
- Danh bạ nhân sự: /staff. Nhật ký hệ thống: /audit.

## Danh mục và chuồng trại
- Hồ sơ ngựa: /horses (thêm mới /horses/new, ngựa đã xóa /horses/deleted).
- Sơ đồ chuồng: /stalls; danh mục ô chuồng /catalogs/stalls; giống & màu lông /catalogs/breeds.
- Danh mục ca trực: /catalogs/shifts (Ca Sáng 05:00–13:00, Ca Chiều 13:00–21:00, Ca Đêm 21:00–05:00).

## Phân ca Groom
Mở "Phân ca" (/stable/shifts). Mỗi ô là Ngày × Ca × Khu. Một Groom chỉ nên nhận một ca mỗi ngày để không trùng giờ; nút "Sao chép tuần" chép lịch tuần trước sang tuần sau. Công việc chăm sóc hằng ngày được giao tự động cho Groom trực ca chứa giờ của công việc.

## Vật tư: nhập bổ sung kho trực tiếp
- Quản lý CLB không gửi đề xuất cho chính mình. Tại "Đề xuất vật tư" (/supplies/requests) hoặc "Tồn kho theo khu" (/supplies/inventory), dùng nút "Nhập bổ sung kho trực tiếp".
- Phiếu do Quản lý CLB tạo tự động ở trạng thái Đã duyệt; lịch sử ghi "Tạo bởi Quản lý CLB [Tên], tự động áp dụng trạng thái Đã duyệt".
- Khi hàng về, bấm "Xác nhận nhận hàng" để cộng tồn kho (thực hiện trong một giao dịch, RULE-CONC-01).

## Duyệt đề xuất của Groom/Bác sĩ
Đề xuất của Groom hoặc Bác sĩ thú y ở trạng thái Chờ duyệt. Quản lý CLB bấm "Xem xét đề xuất": Duyệt (xe giao hàng bắt đầu chạy trong mô hình mô phỏng, trạng thái Đang giao) hoặc Từ chối kèm lý do.

## Tồn kho dưới ngưỡng
Màn /supplies/inventory đánh dấu mặt hàng "Sắp hết" khi số lượng ≤ ngưỡng tối thiểu và "Hết hàng" khi bằng 0. Nút "Kiểm kê" để điều chỉnh số lượng thực tế.

## Tài chính
- Báo cáo tài chính: /financial-reports. Chi phí vận hành: /costs.
- Hóa đơn có 5 trạng thái: Nháp, Đã gửi, Đã thanh toán, Quá hạn, Đã hủy. Có thể tạo bảng kê nháp hàng tháng cho mọi ngựa có chủ.

## Giải đua
Đăng ký giải tại /races. Ngựa đang khóa y tế bị chặn đăng ký (RULE-MED-01); đăng ký dùng giao dịch để không vượt số suất (RULE-CONC-01).
