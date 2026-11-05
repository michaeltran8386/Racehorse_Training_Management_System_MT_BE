# Financial Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phí lưu chuồng chuẩn xác theo ngày thực tế (6.000.000đ/tháng), tự động phát sinh hóa đơn riêng cho từng chu kỳ tháng khi ngựa lưu trú liên tục, kiểm soát hạn trả 7 ngày và quá hạn, hiển thị nhãn "Chưa phát hành / Not issued" thay cho "Nháp".

**Architecture:** 
- Tính toán số ngày lưu trú từ bảng `StallAllocation` trong tháng đã kết thúc. Lưu snapshot `boardingDays`, `boardingMonthlyRate`, và `dueAt` vào model `FinancialInvoice`.
- Giữ nguyên enum CSDL `InvoiceStatus.DRAFT`; chỉ đổi nhãn hiển thị tại tầng UI (FE).
- Định kỳ hàng tháng và nút tạo thủ công tạo hóa đơn `DRAFT` cho tháng trước. Ngựa ở chuồng tháng sau tự sinh hóa đơn tháng sau độc lập.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest; React 19, TypeScript, i18next.

**Spec:** [2026-11-05-equiflow-scope.md](2026-11-05-equiflow-scope.md) và [docs/intent/financial-and-trainer-dashboard.md](../../../docs/intent/financial-and-trainer-dashboard.md).

## Global Constraints

- Chỉ thay đổi module tài chính và các báo cáo liên quan; tuân thủ branch `dev`.
- Định mức phí lưu chuồng: **6.000.000đ/tháng dương lịch**.
- Hạn trả: **7 ngày sau khi Quản lý phát hành** (`DRAFT` → `SENT`).
- Quá hạn không tự cộng tiền phạt, vẫn cho phép thanh toán bình thường.
- Không ghi đè hoặc sửa đổi hóa đơn cũ đã thanh toán (`PAID`).

## Review Focus

- Ngựa ở chuồng liên tục từ tháng 10 sang tháng 11: Tháng 10 đã `PAID` thì tháng 11 vẫn sinh hóa đơn riêng đủ 6.000.000đ — Task 1.
- Chuyển chuồng trong ngày hoặc khoảng thời gian chồng chéo chỉ tính mỗi ngày 1 lần — Task 1.
- Hóa đơn phát hành lúc T sẽ có hạn thanh toán đúng T + 7 ngày; quá hạn chuyển sang `OVERDUE` — Task 2.
- Báo cáo tài chính hiển thị đúng nhãn *Chưa phát hành / Not issued* và tổng hợp công nợ tồn đọng — Task 3.

---

## File Structure

- `src/financial/boarding-fee.ts` (mới): Hàm thuần tính số ngày lưu trú duy nhất và phí chuồng trong 1 tháng.
- `src/financial/financial.service.ts`: Tạo hóa đơn tháng, snapshot, gán hạn trả 7 ngày khi phát hành, quét quá hạn.
- `src/financial/financial.controller.ts`: Endpoint tạo bù tháng `generate-monthly`, xem báo cáo và thanh toán.
- `prisma/schema.prisma`: Thêm `boardingDays Int?`, `boardingMonthlyRate Decimal?`, `dueAt DateTime?` vào `FinancialInvoice`.
- `FE/src/features/financial/types.ts`: Bổ sung trường snapshot và hạn thanh toán vào type `Invoice`.
- `FE/src/features/financial/invoiceStatus.ts` (mới hoặc cập nhật): Hàm format trạng thái hóa đơn hiển thị *Chưa phát hành* thay cho *Nháp*.
- `FE/src/features/financial/pages/OwnerFinancialReportsPage.tsx`: Cập nhật nhãn trạng thái, hiển thị hạn thanh toán và chi tiết phí chuồng.
- `FE/src/shared/i18n/vi-text.ts`: Thêm các chuỗi tiếng Việt mới.

---

### Task 1: Tính phí theo ngày lưu trú thực tế & Chu kỳ tháng độc lập

**Files:**
- Create: `src/financial/boarding-fee.ts`
- Modify: `src/financial/financial.service.ts`
- Modify: `src/financial/financial.controller.ts`
- Modify: `prisma/schema.prisma`
- Test: `src/financial/boarding-fee.spec.ts`

**Interfaces:**
- `calculateBoardingFee(billingPeriod: string, allocations: { startDate: Date; endDate: Date | null }[]): { boardingDays: number; boardingFee: Prisma.Decimal }`
- Hóa đơn mới tạo có: `boardingDays`, `boardingMonthlyRate = 6000000`, `boardingFee = round(6000000 / daysInMonth * boardingDays)`.

- [ ] **Step 1: Viết unit test thất bại trong `boarding-fee.spec.ts`**
  - Đủ tháng 30 ngày (tháng 11) = 6.000.000đ.
  - Đủ tháng 31 ngày (tháng 12) = 6.000.000đ.
  - Đủ tháng 28/29 ngày (tháng 2) = 6.000.000đ.
  - Một phần tháng: 10 ngày tháng 11 = 2.000.000đ; 10 ngày tháng 12 = 1.935.484đ.
  - Ngựa đổi chuồng trong cùng ngày: chỉ tính 1 ngày lưu trú.
  - Ngựa lưu chuồng liên tục qua 2 tháng: tháng nào tính đúng số ngày của tháng đó.
- [ ] **Step 2: Chạy test và xác nhận FAIL.**
- [ ] **Step 3: Cài đặt logic trong `boarding-fee.ts` và tích hợp vào `financial.service.ts`.**
  - Cắt khoảng lưu trú theo ranh giới tháng `[đầu tháng, đầu tháng sau)`.
  - Hợp nhất các ngày lưu trú duy nhất theo múi giờ UTC+7.
  - Nhân tỷ lệ và làm tròn đến đơn vị đồng.
  - Cập nhật Prisma schema (nếu chưa có `boardingDays`, `boardingMonthlyRate`).
- [ ] **Step 4: Chạy lại test và xác nhận PASS 100%.**
- [ ] **Step 5: Commit:** `feat(financial): calculate monthly boarding fee based on actual stay days`.

---

### Task 2: Hạn thanh toán 7 ngày & Quản lý nợ quá hạn (Overdue)

**Files:**
- Modify: `src/financial/financial.service.ts`
- Modify: `src/financial/financial.controller.ts`
- Test: `src/financial/financial.service.spec.ts`

**Interfaces:**
- Khi phát hành hóa đơn (`changeStatus` từ `DRAFT` sang `SENT`): tự động gán `dueAt = now + 7 ngày`.
- Cơ chế `sweepOverdue()`: Hóa đơn có `status === SENT` và `dueAt < now` và `netAmount > 0` tự động chuyển sang `OVERDUE`.
- Báo cáo tài chính chủ ngựa: Tính toán tổng nợ `outstandingDebt = sum(netAmount)` của các hóa đơn `SENT` và `OVERDUE`.

- [ ] **Step 1: Viết unit test thất bại trong `financial.service.spec.ts`**
  - Khi phát hành (`SENT`), `dueAt` được gán chính xác `now + 7 ngày`.
  - Quá 7 ngày chưa thanh toán: chuyển thành `OVERDUE`.
  - Hóa đơn `OVERDUE` vẫn cho phép gọi `payInvoice` để chuyển thành `PAID`.
  - Tổng hợp nợ chủ ngựa tính đúng tổng tiền các hóa đơn chưa trả.
- [ ] **Step 2: Chạy test và xác nhận FAIL.**
- [ ] **Step 3: Cài đặt logic hạn thanh toán và quét quá hạn trong `financial.service.ts`.**
- [ ] **Step 4: Chạy lại test và xác nhận PASS 100%.**
- [ ] **Step 5: Commit:** `feat(financial): enforce 7-day payment deadline and overdue accumulation`.

---

### Task 3: Đổi nhãn "Chưa phát hành / Not issued" và Hiển thị báo cáo trên Frontend

**Files:**
- Create: `FE/src/features/financial/invoiceStatus.ts`
- Modify: `FE/src/features/financial/pages/OwnerFinancialReportsPage.tsx`
- Modify: `FE/src/features/financial/pages/CostReportPage.tsx`
- Modify: `FE/src/shared/i18n/vi-text.ts`

- [ ] **Step 1: Định nghĩa hàm format trạng thái hóa đơn song ngữ:**
  - `DRAFT`: *"Chưa phát hành"* (VI) / *"Not issued"* (EN) với badge tone `neutral`/`muted`.
  - `SENT`: *"Đã phát hành"* (VI) / *"Issued"* (EN) với badge tone `info`.
  - `PAID`: *"Đã thanh toán"* (VI) / *"Paid"* (EN) với badge tone `success`.
  - `OVERDUE`: *"Quá hạn"* (VI) / *"Overdue"* (EN) với badge tone `danger`.
- [ ] **Step 2: Cập nhật giao diện `OwnerFinancialReportsPage.tsx`:**
  - Hiển thị cột hạn thanh toán (`Hạn thanh toán: DD/MM/YYYY`).
  - Hiển thị badge tổng nợ tồn đọng của chủ ngựa ở đầu trang.
  - Hiển thị chi tiết số ngày lưu trú (ví dụ: `Lưu chuồng: 30 ngày (6.000.000 đ)`).
- [ ] **Step 3: Kiểm tra chất lượng FE:**
  - `npm run typecheck`: 0 lỗi.
  - `npm run build`: Thành công.
- [ ] **Step 4: Commit:** `feat(financial): update invoice status labels to Not Issued and display stay details`.
