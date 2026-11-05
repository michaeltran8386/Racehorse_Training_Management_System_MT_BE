# Bản Đặc Tả Ý Định: Tài Chính Định Kỳ & Dashboard HLV Tinh Gọn
**EquiFlow — SWP391 (Đồ án Quản lý Huấn luyện Ngựa đua)**  
*Ngày xác nhận: 05/11/2026*

---

## 1. Tuyên bố ý định cốt lõi (Core Statement of Intent)

* **Mục tiêu (Outcome):** Chuẩn hóa nghiệp vụ tài chính và nâng cao trải nghiệm người dùng (UX) trên Dashboard Huấn luyện viên trưởng (Head Trainer) theo đúng phạm vi thực tế của đồ án môn học SWP391:
  1. **Nghiệp vụ chi phí lưu chuồng & công nợ:** Xử lý triệt để câu hỏi phản biện của giảng viên *"Chủ ngựa đóng tiền 6.000.000đ rồi để ngựa trong đó luôn thì sao?"*. Khi ngựa lưu trú liên tục qua nhiều tháng, hệ thống tự động phát sinh hóa đơn tiền chuồng 6.000.000đ cho mỗi chu kỳ tháng mới. Hóa đơn có hạn trả 7 ngày sau khi Quản lý CLB phát hành; nếu quá hạn mà chưa trả thì chuyển sang trạng thái *Quá hạn (Overdue)* và được cộng dồn vào *Tổng nợ tồn đọng (Outstanding Balance)* của chủ ngựa trong các báo cáo tài chính. Đổi nhãn hiển thị trạng thái `DRAFT` thành *Chưa phát hành / Not issued* trên giao diện.
  2. **Dashboard HLV thực chiến:** Cắt bỏ các bảng số liệu ma trận tuần sau phức tạp (over-engineering), thay bằng 2 khối thông tin hành động trực tiếp ngay màn hình chính:
     - **Buổi tập kế tiếp (Next Workout):** Hiển thị buổi tập gần nhất sắp diễn ra (hôm nay hoặc ngày kế tiếp) gồm giờ tập, tên ngựa, loại bài tập, mặt sân; kèm nút bấm điều hướng nhanh sang tab *Lịch tuần* (`/training/calendar`) hoặc màn hình ghi kết quả.
     - **Giáo án gần nhất (Latest Active Plan):** Hiển thị giáo án đang áp dụng gần nhất gồm tên giáo án, ngựa phụ trách, giai đoạn hiện tại; kèm nút bấm xem chi tiết bên tab *Kế hoạch huấn luyện* (`/training/plans/:id`).
* **Người dùng thụ hưởng (User):**
  - **Giảng viên phản biện / Hội đồng chấm SWP391:** Nhìn thấy luồng tài chính khép kín, minh bạch, có phát sinh chi phí định kỳ và kiểm soát công nợ rõ ràng khi ngựa lưu trú lâu dài.
  - **Quản lý câu lạc bộ (Club Manager):** Kiểm soát hóa đơn hàng tháng, phát hành và theo dõi các khoản nợ quá hạn của từng chủ ngựa.
  - **Huấn luyện viên trưởng (Head Trainer):** Vừa mở Dashboard là nắm bắt ngay lịch trình cần làm tiếp theo mà không phải đào sâu vào các bảng biểu phụ.
* **Lý do & Bối cảnh (Why now):** Bản kế hoạch cũ ngày 05/11 trong `docs/superpowers/plans/` bị sa đà vào các cơ chế chạy ngầm phức tạp (polling 30s ngầm, advisory lock, ma trận tuần 7 ngày) nhưng lại chưa trả lời được bài toán thực tế giảng viên đặt ra về việc ngựa ở lì qua nhiều tháng. Cần tinh chỉnh kế hoạch để sẵn sàng giao cho AI/Codex code chuẩn xác.
* **Tiêu chí thành công (Success Criteria):**
  1. Mỗi chu kỳ tháng mới, ngựa có lưu trú (StallAllocation) đều được tạo hóa đơn độc lập cho tháng đó; hóa đơn tháng trước đã thanh toán (`PAID`) không làm mất đi hóa đơn tháng sau.
  2. Báo cáo tài chính của Chủ ngựa và Quản lý thể hiện rõ ràng các hóa đơn theo tháng, trạng thái *Chưa phát hành* (thay vì Nháp), *Quá hạn* (khi quá 7 ngày kể từ khi phát hành) và hiển thị tổng nợ tồn đọng.
  3. Dashboard HLV có 2 card nổi bật "Buổi tập kế tiếp" và "Giáo án gần nhất", tải nhanh cùng dữ liệu overview ban đầu, click vào mở đúng màn hình chi tiết.
* **Ràng buộc (Constraints):**
  - Triển khai trên nhánh mới dựa trên nhánh `dev` sạch.
  - Giữ nguyên cấu trúc Prisma schema hiện có (không sửa tên cột cũ, không thêm bảng không cần thiết).
  - Giữ nguyên mã lưu trữ `DRAFT` ở database và API; chỉ thay đổi nhãn hiển thị đa ngữ (Việt - Anh) trên giao diện.
  - Đảm bảo 100% test suites (BE Jest & FE typecheck/build) vượt qua trước khi tạo PR.
* **Ngoài phạm vi (Out of Scope):**
  - Cắt bỏ hoàn toàn bảng ma trận dự kiến 7 ngày tuần sau trên Dashboard.
  - Cắt bỏ cơ chế polling ngầm 30 giây và lắng nghe `visibilitychange` trên Dashboard.
  - Không xây dựng cổng thanh toán online (VNPAY/Momo), ví tiền điện tử, hoặc hệ thống tính lãi phạt chậm trả.

---

## 2. Ánh xạ Màn hình & Điều hướng (Screen & Navigation Mapping)

| Khối trên Dashboard | Tab tính năng chính trên Sidebar | Đường dẫn URL | Hành động của HLV |
|---|---|---|---|
| **Widget: Buổi tập kế tiếp** | Nhóm *Huấn luyện* › **Lịch tuần** | `/training/calendar` | Xem lịch chi tiết theo ngày, hoặc bấm vào nút chuyển sang ghi kết quả `/training/sessions/:id/result` |
| **Widget: Giáo án gần nhất** | Nhóm *Huấn luyện* › **Kế hoạch huấn luyện** | `/training/plans` | Xem danh sách giáo án, mở chi tiết `/training/plans/:id` để xem các giai đoạn |
| **Báo cáo tài chính chủ ngựa** | Nhóm *Báo cáo* › **Báo cáo tài chính** | `/owner/financial-reports` | Xem hóa đơn theo tháng, tải sao kê, thanh toán chuyển khoản |

---

## 3. Lộ trình bàn giao (Handoff)

Tài liệu này là căn cứ tối cao (Ground Truth) để cập nhật lại 3 tài liệu kế hoạch trong:
- `Racehorse_Training_Management_System_MT_BE/docs/superpowers/plans/2026-11-05-equiflow-scope.md`
- `Racehorse_Training_Management_System_MT_BE/docs/superpowers/plans/2026-11-05-financial-billing.md`
- `Racehorse_Training_Management_System_MT_BE/docs/superpowers/plans/2026-11-05-trainer-dashboard.md`

