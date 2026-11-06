# Head Trainer Dashboard Implementation Plan (Action-Oriented UX)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cao trải nghiệm người dùng của Huấn luyện viên trưởng trên Dashboard chính: Hiển thị ngay **Buổi tập kế tiếp** và **Giáo án gần nhất** với các nút hành động nhanh dẫn sang các màn hình chính (Lịch tuần, Kế hoạch huấn luyện).

**Architecture:** 
- BE: Mở rộng endpoint `GET /training/overview` để trả về thêm 2 đối tượng `nextWorkout` và `latestPlan`. Truy vấn nhẹ, trực tiếp từ CSDL, không tải toàn bộ lịch sử.
- FE: Cập nhật component `TrainerDashboard` trong `RoleDashboards.tsx`. Thay thế bảng ma trận tuần phức tạp bằng 2 widget thẻ thông tin hành động trực quan, tải đồng bộ cùng dữ liệu Dashboard.

**Tech Stack:** NestJS 11, Prisma 6, Jest; React 19, TypeScript, CSS Modules, i18next.

**Spec:** [2026-11-05-equiflow-scope.md](2026-11-05-equiflow-scope.md) và [docs/intent/financial-and-trainer-dashboard.md](../../../docs/intent/financial-and-trainer-dashboard.md).

## Global Constraints

- Chỉ thay đổi Trainer Dashboard; tuân thủ branch `dev`.
- Giữ nguyên các KPI thống kê cơ bản hiện có (ngựa quản lý, giáo án hoạt động, cảnh báo).
- Không bổ sung cơ chế polling ngầm 30 giây hay lắng nghe `visibilitychange`.
- Hỗ trợ đầy đủ song ngữ Anh - Việt và responsive trên mobile/desktop.

## Review Focus

- Khi có buổi tập sắp tới trong ngày: hiển thị giờ tập, ngựa, bài tập của buổi tập gần nhất — Task 1 & 2.
- Khi hôm nay đã tập xong hết hoặc không có lịch hôm nay: tự động tìm buổi tập gần nhất trong những ngày tiếp theo (ví dụ: ngày mai) — Task 1 & 2.
- Khi không có bất kỳ buổi tập hoặc giáo án nào: hiển thị trạng thái trống (empty state) thân thiện kèm nút tạo giáo án — Task 2.
- Bấm vào widget điều hướng chính xác sang tab tính năng chính (`/training/calendar` hoặc `/training/plans/:id`) — Task 2.

---

## File Structure

- Modify: `src/training/training-insights.service.ts`: Truy vấn `nextWorkout` và `latestPlan` bổ sung vào overview.
- Test: `src/training/training-services.spec.ts`: Unit test kiểm tra độ chính xác của buổi tập kế tiếp và giáo án gần nhất.
- Modify: `FE/src/features/training/types.ts`: Cập nhật interface `TrainingOverview`, thêm `NextWorkoutInfo` và `LatestPlanInfo`.
- Modify: `FE/src/features/dashboard/components/RoleDashboards.tsx`: Cập nhật component `TrainerDashboard` để render 2 widget mới.
- Modify: `FE/src/features/dashboard/components/RoleDashboards.module.css`: Thêm kiểu dáng cho 2 thẻ hành động nhanh.
- Modify: `FE/src/shared/i18n/vi-text.ts`: Thêm các nhãn tiếng Việt tương ứng.

---

### Task 1: Bổ sung "Buổi tập kế tiếp" và "Giáo án gần nhất" vào Backend Overview

**Files:**
- Modify: `src/training/training-insights.service.ts`
- Test: `src/training/training-services.spec.ts`

**Interfaces:**
```ts
export interface NextWorkoutInfo {
  id: string;
  planId: string;
  horseId: string;
  horseName: string;
  horseCode?: string;
  workoutType: string;
  scheduledDate: string; // ISO
  intensity: string;
  surface?: string;
  status: string;
}

export interface LatestPlanInfo {
  id: string;
  planCode: string;
  name: string;
  horseId: string;
  horseName: string;
  status: string;
  startDate: string;
  endDate: string;
  currentPhaseName?: string;
}
```

- [ ] **Step 1: Viết unit test thất bại trong `training-services.spec.ts`**
  - Test `nextWorkout`: Chọn buổi tập có trạng thái `SCHEDULED`, ngày tập `>= hôm nay`, sắp xếp theo thời gian tăng dần (`scheduledDate: 'asc'`), lấy bản ghi đầu tiên.
  - Test `nextWorkout` khi hôm nay không có: Lấy buổi tập của ngày mai hoặc ngày tiếp theo gần nhất.
  - Test `latestPlan`: Chọn giáo án có trạng thái `ACTIVE`, sắp xếp theo ngày cập nhật hoặc ngày bắt đầu mới nhất (`updatedAt: 'desc'` hoặc `startDate: 'desc'`).
  - Test khi không có dữ liệu: trả về `null` thay vì ném lỗi.
- [ ] **Step 2: Chạy test và xác nhận FAIL.**
- [ ] **Step 3: Triển khai truy vấn trong `TrainingInsightsService.getOverview()`**
  - Thực hiện query `prisma.workoutSession.findFirst` và `prisma.trainingPlan.findFirst` kèm thông tin `horse`.
  - Gắn vào object trả về của `getOverview()`.
- [ ] **Step 4: Chạy lại test và xác nhận PASS 100%.**
- [ ] **Step 5: Commit:** `feat(training): include next workout and latest plan in overview response`.

---

### Task 2: Render 2 Widget Thực Chiến trên Trainer Dashboard (Frontend)

**Files:**
- Modify: `FE/src/features/training/types.ts`
- Modify: `FE/src/features/dashboard/components/RoleDashboards.tsx`
- Modify: `FE/src/features/dashboard/components/RoleDashboards.module.css`
- Modify: `FE/src/shared/i18n/vi-text.ts`

- [ ] **Step 1: Cập nhật types trong `types.ts`**
  - Thêm `nextWorkout?: NextWorkoutInfo | null` và `latestPlan?: LatestPlanInfo | null` vào `TrainingOverview`.
- [ ] **Step 2: Xây dựng UI cho 2 thẻ trên `TrainerDashboard`:**
  - **Thẻ 1 — Buổi tập kế tiếp (Next Workout):**
    - Tiêu đề: *Buổi tập kế tiếp* / *Next Workout*.
    - Nội dung: Huy hiệu thời gian (VD: `Hôm nay 14:00` hoặc `06/11 08:30`), tên chiến mã kèm mã ngựa, bài tập (VD: `Chạy nước rút · Cỏ`), cường độ.
    - Nút hành động: Nút *Mở lịch tuần* (dẫn tới `/training/calendar`) hoặc *Ghi kết quả* (dẫn tới `/training/sessions/:id/result`).
    - Nếu không có: Hiển thị thông báo nhẹ *Không có buổi tập nào sắp diễn ra*.
  - **Thẻ 2 — Giáo án gần nhất (Latest Active Plan):**
    - Tiêu đề: *Giáo án gần nhất* / *Latest Training Plan*.
    - Nội dung: Tên giáo án kèm mã `GA-xxxxxx`, tên ngựa áp dụng, giai đoạn hiện tại (VD: `Giai đoạn 1: Nền tảng`), thời hạn.
    - Nút hành động: Nút *Xem giáo án* (dẫn tới `/training/plans/:id`).
    - Nếu không có: Nút *+ Lập giáo án mới* (dẫn tới `/training/plans/new`).
- [ ] **Step 3: Xác minh chất lượng:**
  - `npm run typecheck`: 0 lỗi.
  - `npm run build`: Thành công.
- [ ] **Step 4: Commit:** `feat(dashboard): display actionable next workout and latest plan cards on trainer dashboard`.
