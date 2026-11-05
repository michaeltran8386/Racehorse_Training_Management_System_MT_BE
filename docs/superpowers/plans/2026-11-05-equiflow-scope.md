# EquiFlow — Phạm vi và Quyết định Thiết kế (Cập nhật 05/11/2026)

## 1. Yêu cầu và Quyết định Nghiệp vụ Đã Xác Nhận

- **Tuân thủ nhánh & Giới hạn:** Chỉ thay đổi module Tài chính và Dashboard Huấn luyện viên trưởng (Head Trainer); thực hiện trên nhánh mới tách từ `dev`.
- **Trạng thái tài chính trên UI:** Đổi nhãn hiển thị `DRAFT` từ *"Nháp / Draft"* thành *"Chưa phát hành / Not issued"*. Giữ nguyên mã lưu trữ ở CSDL và API là `DRAFT`.
- **Phí lưu chuồng & Xử lý ngựa ở liên tục nhiều tháng:**
  - Định mức chuẩn: **6.000.000đ/tháng dương lịch**.
  - Nếu lưu trú một phần tháng: `6.000.000 / số ngày của tháng × số ngày lưu trú thực tế`.
  - **Quy tắc ngựa ở dài hạn (Giải quyết câu hỏi phản biện):** Ngựa vẫn đang được phân bổ chuồng (StallAllocation đang hiệu lực) thì mỗi chu kỳ tháng mới, hệ thống tự động phát sinh một hóa đơn tiền chuồng mới cho tháng đó. Hóa đơn tháng trước đã thanh toán (`PAID`) hoàn toàn độc lập với tháng sau, không làm mất đi hóa đơn tháng sau.
  - **Hạn thanh toán:** **7 ngày sau khi Quản lý CLB bấm phát hành (`SENT`)**. Sau 7 ngày mà chưa thanh toán, hóa đơn chuyển sang trạng thái **Quá hạn (`OVERDUE`)**, vẫn cho phép chủ ngựa bấm thanh toán chuyển khoản, không tự ý cộng tiền phạt.
  - **Tổng nợ tồn đọng (Outstanding Balance):** Báo cáo tài chính hiển thị danh sách các tháng nợ và tổng số tiền nợ tích lũy của chủ ngựa, đảm bảo không bị thất thoát tiền chuồng.
- **Dashboard Huấn luyện viên trưởng (UX thực chiến):**
  - Cắt bỏ bảng ma trận tuần sau phức tạp (over-engineering) và cơ chế polling ngầm 30 giây.
  - Hiển thị 2 widget hành động nhanh:
    1. **Buổi tập kế tiếp (Next Workout):** Hiển thị buổi tập gần nhất sắp diễn ra (hôm nay hoặc ngày kế tiếp) gồm giờ bắt đầu, tên ngựa, loại bài tập, mặt sân tập; kèm nút bấm điều hướng nhanh sang tab *Lịch tuần* (`/training/calendar`) hoặc màn hình ghi kết quả.
    2. **Giáo án gần nhất (Latest Active Plan):** Hiển thị giáo án đang áp dụng gần nhất gồm tên giáo án, ngựa phụ trách, giai đoạn hiện tại; kèm nút bấm mở trang chi tiết bên tab *Kế hoạch huấn luyện* (`/training/plans/:id`).
  - Giữ lại các thẻ thống kê tổng quan (managed horses, active plans, alert items).

---

## 2. Chi tiết Thiết kế Kỹ thuật

- **Múi giờ:** UTC+7 (Asia/Ho_Chi_Minh). Tuần tính từ Thứ Hai đến Chủ Nhật.
- **Tính ngày lưu trú chuồng:** Tính ngày vào, không tính ngày ra; vào và ra cùng ngày tính 1 ngày. Hợp nhất các khoảng lưu trú liên tiếp trước khi đếm để chuyển chuồng không bị tính trùng lặp. Cắt khoảng lưu trú theo ranh giới tháng.
- **Tạo hóa đơn định kỳ & Tạo thủ công:**
  - Tự động tạo hóa đơn vào ngày đầu tháng cho tháng vừa kết thúc (trạng thái `DRAFT` - *Chưa phát hành*).
  - Nút bấm tạo thủ công trên giao diện cho phép Quản lý CLB chủ động tạo bù cho các tháng trước nếu cần.
  - Hóa đơn lưu snapshot: `boardingDays` (số ngày lưu trú trong tháng) và `boardingMonthlyRate` (6.000.000).
- **Hạn thanh toán (`dueAt`):**
  - Gán `dueAt = now + 7 ngày` khi hóa đơn chuyển từ `DRAFT` sang `SENT`.
  - Nếu đã phát hành lại thì không gia hạn thêm thời gian.
  - Tự động chuyển `SENT` sang `OVERDUE` khi `dueAt < now` và hóa đơn chưa thanh toán (`netAmount > 0`).
- **Dashboard HLV (BE & FE):**
  - Endpoint `GET /training/overview` bổ sung trường:
    - `nextWorkout`: Buổi tập có trạng thái `SCHEDULED` gần nhất trong tương lai.
    - `latestPlan`: Giáo án có trạng thái `ACTIVE` gần nhất.
  - FE render 2 card tinh tế, ăn khớp với hệ thống EquiFlow Design Tokens, hỗ trợ đầy đủ song ngữ Anh - Việt.

---

## 3. Ranh giới & Rủi ro (Boundaries & Constraints)

- **Không sửa module ngoài phạm vi:** Không sửa Simulator (Web Simulator), không sửa phân quyền y tế, không cài đặt thêm thư viện ngoài (dependencies).
- **An toàn CSDL:** Chỉ thêm trường tùy chọn (`boardingDays Int?`, `boardingMonthlyRate Decimal?`, `dueAt DateTime?` vào `FinancialInvoice`), không xóa cột cũ, không sửa enum DB.
- **Không làm over-engineering:** Không thêm polling 30s ngầm, không thêm ma trận tuần 7 ngày, không làm ví tiền hay cổng thanh toán trực tuyến.

---

## 4. Kế hoạch Con Triển Khai (Sub-plans)

1. `2026-11-05-financial-billing.md`: Chi tiết triển khai tính phí chuồng theo ngày, chu kỳ hàng tháng, hạn thanh toán 7 ngày, quét quá hạn và nhãn *Chưa phát hành*.
2. `2026-11-05-trainer-dashboard.md`: Chi tiết triển khai API và UI cho 2 widget *Buổi tập kế tiếp* và *Giáo án gần nhất* trên Trainer Dashboard.
