# Statement of Intent: Comprehensive Past-Present-Future Seed Dataset

**Topic:** Hệ thống dữ liệu mẫu toàn diện Quá khứ - Hiện tại - Tương lai (Seed Data Lifecycle Enhancement)  
**Date:** 2026-11-05  
**Author:** Pair-programming session (User & Antigravity)  
**Target File:** `Racehorse_Training_Management_System_MT_BE/prisma/seed.ts`

---

## 1. Outcome & Objective
Nâng cấp và làm giàu toàn diện file seed (`prisma/seed.ts`) trong môi trường phát triển (`dev`), xây dựng một bộ dữ liệu lớn gồm **10–15 con ngựa** có vòng đời hoàn chỉnh, bao quát 100% các phân hệ (Luyện tập, Y tế, Giải đấu, Tài chính, Kho vận tư, Chuồng trại và Phân ca chăm sóc).

## 2. Core Pillars & Timeline Dimensions
Bộ dữ liệu sử dụng **mốc thời gian động** tương đối dựa trên `new Date()` và giờ câu lạc bộ (UTC+7: `clubDay(offset)`), đảm bảo bất kỳ ngày nào mở máy chấm thi/demo thì dữ liệu luôn "sống":

- **Quá khứ (-90 ngày đến -1 ngày):**
  - Các giáo án huấn luyện đã hoàn thành (`COMPLETED`) với hơn 30 buổi tập có chỉ số thực đo (tốc độ, nhịp tim, mặt sân, cự ly).
  - Các giải đấu đã kết thúc với kết quả bảng vàng (Hạng 1, 2, 3), tiền thưởng và thành tích huy chương.
  - Các ca chấn thương đã bình phục hoàn toàn (`RESOLVED`), các đợt tiêm phòng/tẩy giun định kỳ đã hoàn thành (`COMPLETED`).
  - Hóa đơn tài chính tháng trước đã thanh toán (`PAID`).
- **Hiện tại (Hôm nay / Day 0):**
  - Trainer Dashboard: Có ít nhất 2 buổi tập đã xếp lịch sáng nay (08:00 và 08:15) để hiển thị ngay trên thẻ "Buổi tập kế tiếp" và "Giáo án gần nhất".
  - Slot an toàn chạy thử: Buổi chạy thử lúc 08:00 và 08:15 trên sân Turf (đúng khoảng cách 15 phút an toàn theo quy tắc `TRIAL_SLOT_MINUTES = 15`).
  - An toàn y tế: 1 ngựa bị `isMedicalLocked = true` (chấn thương cấp) để demo tính năng Vet khóa và Trainer bị chặn xếp bài nặng / cấm tham gia giải.
  - Tài chính: 1 hóa đơn tiền chuồng quá hạn 7 ngày (`OVERDUE`) để hiện badge cảnh báo nợ xấu và số ngày lưu chuồng thực tế (6.000.000đ/tháng pro-rated). 1 hóa đơn nháp `DRAFT` (hiển thị "Chưa phát hành").
  - Kho vật tư: Có mặt hàng cảnh báo dưới ngưỡng tồn kho (Low Stock) và đơn yêu cầu nhập hàng (`RestockRequest`) trạng thái `PENDING` chờ Manager duyệt.
  - Chăm sóc: Lịch Groom xúc chuồng và chia khẩu phần hôm nay.
  - Sự cố: 1 sự cố chuồng trại mới báo cáo hôm nay (`REPORTED`).
- **Tương lai (+1 ngày đến +60 ngày):**
  - Các giải đấu đua ngựa sắp diễn ra (`REGISTRATION_OPEN` / `SCHEDULED`) với các lượt đăng ký thi đấu.
  - Lịch tập tuần tới của các giáo án đang chạy.
  - Lịch tiêm phòng sắp đến hạn trong 14 ngày tới.

## 3. Personas (Đàn ngựa demo 12 con)
1. **HR-000001 (Bạch Long Mã):** Champion Racehorse, phong độ đỉnh cao, nhiều huy chương quá khứ, có buổi tập hôm nay, đăng ký cúp mùa đông tương lai.
2. **HR-000002 (Xích Thố):** Bị khóa y tế (`isMedicalLocked = true`), viêm gân, cấm tập nặng/đua, có lịch tái khám.
3. **HR-000003 (Hắc Báo):** Bị nợ phí quá hạn (`OVERDUE`), kích hoạt badge nợ trên Dashboard và thông báo tài chính.
4. **HR-000004 (Thần Phong):** Ngựa ngôi sao đội 2 (HLV Nam), có lượt chạy thử hôm nay lúc 08:15 kiểm chứng luật slot 15 phút.
5. **HR-000005 (Lão Tướng):** Ngựa đã giải nghệ (`RETIRED`), lý do tuổi tác, lưu trữ bảng vàng thành tích lịch sử đồ sộ.
6. **HR-000006 (Tuyết Ảnh):** Ngựa cách ly y tế tại Zone C (Quarantine), chờ bác sĩ kiểm tra nhập đàn.
7. **HR-000007 (Kim Long):** Đang nghỉ dưỡng mùa đông (`RESTING`), chế độ dinh dưỡng duy trì.
8. **HR-000008 (Vân Tiêu):** Ngựa tơ đào tạo căn bản (`IN_TRAINING`), giáo án Base Phase.
9. **HR-000009 (Dạ Nguyệt):** Đang theo dõi phục hồi (`UNDER_OBSERVATION`), tập bơi lội (`SWIM`).
10. **HR-000010 (Lôi Chấn):** Ngựa đua cự ly ngắn (Sprint), tốc độ cao.
11. **HR-000011 (Hồng Kỳ):** Ngựa tơ tiềm năng.
12. **HR-000012 (Thanh Loan):** Ngựa đua sân cỏ Turf chuyên biệt.

## 4. Constraints & Non-Negotiables
- Không phá vỡ bất kỳ unit test nào trong bộ 58 suites (120+ tests PASS).
- Chạy `npx prisma db seed` trơn tru, xử lý upsert hoặc dọn dẹp sạch theo thứ tự quan hệ bảng để không bao giờ bị dính lỗi Foreign Key constraint.
- Đầy đủ dữ liệu cho 100% 37 Prisma Models.

