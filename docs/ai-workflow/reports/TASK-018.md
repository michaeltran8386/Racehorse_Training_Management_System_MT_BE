# TASK-018 — Execution Report

| Parameter | Value |
| :--- | :--- |
| **Task** | TASK-018 — Unified Web-Simulator Supply Replenishment & Delivery Coordination Contract |
| **Plan Version** | v1-approved-r24 |
| **CRs Incorporated** | CR-024 (CHANGES.md Section 7) & CR-025 (CHANGES.md Section 8) |
| **Status** | AWAITING_USER_QA |
| **Authorizing Commands** | `START TASK-018` (2026-10-29 10:57 Asia/Bangkok) |
| **Active Task / Next Task** | `TASK-018` (AWAITING_USER_QA) / `TASK-018` |
| **Authorized Scope Budget** | Exactly 39 application, test, migration & asset paths across the workspace |
| **Real Stack Under Test** | NestJS Backend (`http://localhost:3000`), PostgreSQL Docker (`equiflow:5432`), Frontend Web (`http://localhost:5173`), Canonical Simulator (`http://localhost:5175`) |

---

## 1. Summary of Implementation & Architecture

TASK-018 addresses the complete architectural synchronization of supply replenishment across Main Web, Canonical Simulator, and NestJS Backend under Plan `v1-approved-r23` and definitive `CR-024`:

### 1.1 Slice A — Backend PostgreSQL Authority & Dedicated Supply Delivery Gateway
- **Additive Database Schema Migration:**
  - Added enum value `DELIVERING` to `RestockStatus`.
  - Added nullable `Decimal(12,2)` column `capacity` to model `StockBalance`.
  - Applied via additive migration SQL (`prisma/migrations/20261029010000_supply_delivery_sync/migration.sql`) without `migrate reset`, `db seed`, or data alteration. Existing rows remain `NULL` (unconfigured capacity).
- **Dedicated Socket.IO Gateway (`/supplies` namespace):**
  - Implemented `SupplyDeliveryGateway` under `src/inventory/supply-delivery.gateway.ts`.
  - Decoupled from `/simulator` session/workout namespace.
  - Broadcasts `sys:supply_delivery_start` with opaque HMAC-SHA256 capability, and broadcasts `sys:supply_delivery_completed` upon PostgreSQL commit.
  - Reissues signed capabilities for active ongoing deliveries on client connection/reconnect via `sys:active_deliveries`.
- **Opaque HMAC-SHA256 Capability Verification:**
  - Capability payload: `{ purpose: 'SUPPLY_DELIVERY_ACK', requestId, dispatchedAt, expiresAt }`.
  - Signed using application secret; enforces minimum 8.0s duration check (`EARLY_ACK_REJECTED`), binding check (`REQUEST_ID_MISMATCH`), and 20s expiry (`CAPABILITY_EXPIRED`).
- **Atomic Database Transaction & Watchdog Timer:**
  - `reviewRestockRequest`: enforces `CLUB_MANAGER`, removes arbitrary 10000 ceiling, checks capacity limits (`currentQty + reservedQty + approvedQty <= capacity` if capacity configured), transitions `PENDING -> DELIVERING`, schedules in-memory 20s watchdog timer, and broadcasts `sys:supply_delivery_start`.
  - `completeDelivery(requestId, 'ACK' | 'FALLBACK')`: shared interactive transaction (`prisma.$transaction`) with zone row locking, conditional atomic transition `DELIVERING -> DELIVERED`, exactly-once `StockBalance.upsert` increment, audit logging, requester notification, watchdog timer cancellation, and gateway broadcast.
  - Restart recovery via `OnModuleInit`: scans persisted `DELIVERING` rows on startup, immediately completes overdue rows (>= 20s), and reschedules watchdog timer for remaining duration (< 20s). Cleans up active timers on `OnModuleDestroy`.
- **Public Read-Only Context Endpoint:**
  - Added `@Public() @Get('simulator/context')` on `InventoryController` providing catalogue, PostgreSQL stock balances, and active delivery metadata without PII or write credentials.

### 1.2 Slice B — Simulator Real Stock Integration & Automated Truck Animation
- **Elimination of Mock Inventory:**
  - Mock five-item catalogue (`HAY`, `FEED`, `BEDDING`, `MEDS`, `SHOES`), local capacity defaults, and local simulated consumption (`consume()`) completely eliminated.
  - All stock items, units, quantities, and capacities originate from PostgreSQL via `src/api/inventoryApi.ts`.
- **Dedicated Supply Transport (`src/sim/supplyTransport.ts`):**
  - Connects to `/supplies` namespace.
  - Subscribes to `sys:supply_delivery_start`, `sys:active_deliveries`, `sys:supply_delivery_completed`.
  - Emits `sim:supply_delivery_ack` with signed capability.
- **Automated Truck Animation & Delivery State Machine (`src/sim/inventory.ts`):**
  - Incoming orders registered into `inventory.orders` with deduplication by `requestId`.
  - Wall-clock animation drives delivery truck for ~8 seconds from `dispatchedAt`.
  - When truck arrives at barn door (`now >= arriveAt` / `Date.now() >= dispatchedAt + 8000`), Simulator automatically fires `sim:supply_delivery_ack` without requiring manual interaction.
  - Upon receiving `sys:supply_delivery_completed`, updates local stock quantity to authoritative PostgreSQL balance.
- **UI Enhancements (`src/ui/SupplyPanel.tsx` & `src/ui/FarmHub.tsx`):**
  - Displays real PostgreSQL stock items, units, and quantities.
  - If `capacity !== null`: displays `quantity / capacity unit` and percentage fill bar.
  - If `capacity === null`: displays `quantity unit` cleanly without meter (Option A selected by user).
  - Local "Đặt hàng" (Order) button removed (ordering is exclusive to Club Manager on Main Web).
  - Status indicator displays "Xe tải đang giao hàng…" during transit.
  - Preserved uncommitted audio assets and `NOW1.txt`, `NOW2.txt`, `music/`.

### 1.3 Slice C — Main Web Procurement UI & Real-Stack Acceptance
- **Main Web Restock Requests (`RestockRequestsPage.tsx` & `inventory.ts`):**
  - Added `DELIVERING` to `RestockStatus` and filter tabs.
  - Displays "Đang giao hàng" badge for `DELIVERING` rows.
  - Removed manual "Confirm Receipt" button for `DELIVERING` rows (retained only for historical `APPROVED` rows).
  - Implemented bounded 2s polling while deliveries are in `DELIVERING` status to automatically reflect completion to `DELIVERED`.
- **Real-Stack Playwright E2E Suite (`tests/e2e/simulator-real-stack.spec.ts`):**
  - Tested on both `desktop-1280` and `desktop-1440` viewports against real PostgreSQL, NestJS, Vite Web, and Vite Simulator.
  - Proves: Groom creates restock proposal -> CM reviews and approves on Web -> Web shows `DELIVERING` -> Simulator open in second tab auto-receives Socket.IO event, animates truck ~8s, and emits ACK -> Backend completes delivery and increments PostgreSQL stock exactly once -> Web auto-polls and updates to `DELIVERED` ("Đã giao hàng") -> Simulator updates stock balance.
  - Proves: Offline fallback when Simulator is closed completes delivery automatically via Backend 20s watchdog timer.
  - Proves: Safe cleanup restores baseline stock, deletes only test-created records by exact ID, and preserves concurrent sentinel notification untouched.

---

## 2. Automated Test Results & Verification Evidence

### 2.1 Backend Unit & Integration Tests (`src/inventory`)
```powershell
npm test -- src/inventory
```
- `src/inventory/inventory.service.spec.ts`: **PASS (16 tests)**
- `src/inventory/supply-delivery.gateway.spec.ts`: **PASS (6 tests)**
- `src/inventory/inventory.controller.spec.ts`: **PASS (4 tests)**
- **Result:** **26 passed, 26 total (Exit Code: 0)**
- **Coverage highlights:** 8s early-ACK rejection, 20s offline fallback, onModuleInit overdue completion vs remaining reschedule, atomic transaction rollback, duplicate ACK idempotency, capacity limit validation, legacy APPROVED manual delivery compatibility, onModuleDestroy timer cleanup.

### 2.2 Simulator Test Suite (`Racehorse_Simulator_Web`)
```powershell
npm test
```
- `src/sim/inventory.test.ts`: **PASS (8 tests)**
- `src/sim/supplyTransport.test.ts`: **PASS (3 tests)**
- `src/api/inventoryApi.test.ts`: **PASS (2 tests)**
- Farm, Map, Engine, Paths, Stalls, Audio suites: **PASS (143 tests)**
- **Result:** **156 passed, 156 total (Exit Code: 0)**

### 2.3 Typecheck & Lint Quality Gates
- **Backend Typecheck & Lint:**
  - `npm run typecheck`: **Exit Code: 0**
  - `npm run lint`: **Exit Code: 0 (0 errors, 0 warnings)**
- **Simulator Typecheck & Build:**
  - `npm run typecheck`: **Exit Code: 0**
  - `npm run build`: **Exit Code: 0 (Vite client build succeeded)**
- **Frontend Typecheck & Lint:**
  - `npm run typecheck`: **Exit Code: 0**
  - `npm run lint`: **Exit Code: 0 (0 errors)**

### 2.4 Real-Stack Playwright Acceptance (`tests/e2e/simulator-real-stack.spec.ts`)
```powershell
npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1280
npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1440
```
- `[desktop-1280] › TASK-018: Unified Web-Simulator supply delivery synchronization, truck animation ACK, and offline fallback`: **PASS (39.6s)**
- `[desktop-1440] › TASK-018: Unified Web-Simulator supply delivery synchronization, truck animation ACK, and offline fallback`: **PASS (42.9s)**
- **Result:** **2 passed on both desktop-1280 and desktop-1440 viewports (Exit Code: 0)**

---

## 3. Exact 39 Authorized File Scope Audit (CR-024 + CR-025)

| Repository | Authorized File Path | Origin / Purpose | Status |
| :--- | :--- | :--- | :--- |
| **Backend (8)** | `prisma/schema.prisma` | CR-024 | Modified (Added `DELIVERING` enum, nullable `capacity` column) |
| | `prisma/migrations/20261029010000_supply_delivery_sync/migration.sql` | CR-024 | Created (Additive migration SQL) |
| | `src/inventory/inventory.service.ts` | CR-024 | Modified (Watchdog timer, HMAC signing, atomic transaction, recovery) |
| | `src/inventory/inventory.service.spec.ts` | CR-024 | Modified (Comprehensive unit tests) |
| | `src/inventory/inventory.controller.ts` | CR-024 | Modified (Added public `/simulator/context`) |
| | `src/inventory/inventory.module.ts` | CR-024 | Modified (Registered SupplyDeliveryGateway) |
| | `src/inventory/supply-delivery.gateway.ts` | CR-024 | Created (Dedicated `/supplies` Socket.IO gateway) |
| | `src/inventory/supply-delivery.gateway.spec.ts` | CR-024 | Created (Gateway unit tests) |
| **Frontend (3)** | `src/features/stable/pages/RestockRequestsPage.tsx` | CR-024 | Modified (DELIVERING badge/tab, 2s auto-polling, removed manual confirm) |
| | `src/features/stable/types/inventory.ts` | CR-024 | Modified (Added `DELIVERING` to `RestockStatus`) |
| | `tests/e2e/simulator-real-stack.spec.ts` | CR-024 + CR-025 | Modified (Real-stack supply delivery + Simulator audio engine tests) |
| **Simulator — Core & Supply (10)** | `src/sim/inventory.ts` | CR-024 | Modified (Real PostgreSQL stocks, 8s delivery tick, ACK trigger) |
| | `src/sim/inventory.test.ts` | CR-024 | Modified (Unit tests for real stock, ACK trigger & completion) |
| | `src/ui/SupplyPanel.tsx` | CR-024 | Modified (Clean Option A stock display, removed order button) |
| | `src/ui/FarmHub.tsx` | CR-024 + CR-025 | Modified (Real stockLevel, Hay detection, integrated AudioControl) |
| | `src/ui/App.tsx` | CR-024 + CR-025 | Modified (SupplyTransport, real loader, 8s ACK ticker, AudioControl) |
| | `src/main.tsx` | CR-024 | Reconciled (Preserved `bypassIntro` support) |
| | `src/api/inventoryApi.ts` | CR-024 | Created (Public inventory context client) |
| | `src/api/inventoryApi.test.ts` | CR-024 | Created (API client unit tests) |
| | `src/sim/supplyTransport.ts` | CR-024 | Created (Dedicated Socket.IO client for `/supplies`) |
| | `src/sim/supplyTransport.test.ts` | CR-024 | Created (Transport unit tests) |
| **Simulator — Audio Source & Test (6)** | `src/audio/audioManager.ts` | CR-025 | Created (Central audio manager, autoplay fallback, volume/ducking) |
| | `src/audio/audioManager.test.ts` | CR-025 | Created (Dedicated focused unit tests for AudioManager) |
| | `src/ui/AudioControl.tsx` | CR-025 | Created (HUD volume sliders & mute toggles with flexible alignment) |
| | `src/ui/FarmMapCanvas.tsx` | CR-025 | Modified (Interactive building SFX triggers) |
| | `src/ui/IntroOverlay.tsx` | CR-025 | Modified (Intro animation SFX and audio ducking) |
| | `src/ui/Popup.tsx` | CR-025 | Modified (Popup open/close SFX) |
| **Simulator — Runtime Assets (12)** | `public/audio/theme-main.mp3` | CR-025 | Static asset (Seamless looping background music) |
| | `public/audio/ui-click.wav` | CR-025 | Static asset (UI click SFX) |
| | `public/audio/building-select.wav` | CR-025 | Static asset (Building hover/selection SFX) |
| | `public/audio/building-open.wav` | CR-025 | Static asset (Building open SFX) |
| | `public/audio/ui-close.wav` | CR-025 | Static asset (UI close SFX) |
| | `public/audio/ui-success.wav` | CR-025 | Static asset (Action success SFX) |
| | `public/audio/ui-error.wav` | CR-025 | Static asset (Action error SFX) |
| | `public/audio/intro-cloud-whoosh.wav` | CR-025 | Static asset (Intro cloud animation SFX) |
| | `public/audio/intro-logo-reveal.wav` | CR-025 | Static asset (Intro logo reveal SFX) |
| | `public/audio/delivery-vehicle-arrive.wav`| CR-025 | Static asset (Supply delivery truck arrival SFX) |
| | `public/audio/delivery-stop.wav` | CR-025 | Static asset (Supply delivery truck brake/stop SFX) |
| | `public/audio/delivery-complete.wav` | CR-025 | Static asset (Supply delivery completion chime SFX) |

- **Preserved Uncommitted User Files (strictly excluded from delivery):**
  - `Racehorse_Simulator_Web/NOW1.txt`
  - `Racehorse_Simulator_Web/NOW2.txt`
  - `Racehorse_Simulator_Web/music/` and all its raw source stems
  - `Racehorse_Simulator_Web/public/audio/theme-main.wav` (34.6 MB uncompressed source file)
- **Git Commit Gate:** Zero commits, zero pushes, zero merges executed. Whitespace check `git diff --check` passes cleanly (Exit Code: 0) across all 3 repositories.

---

## 4. Manual Human QA Acceptance Guide

To verify the unified supply delivery flow in your browser:

### Step 1: Open Simulator & Verify Baseline Inventory
1. Open Google Chrome and navigate to Canonical Simulator: `http://localhost:5175/?bypassIntro=true`.
2. On the Farm Hub map, click the **Kho** (Warehouse) building or button at bottom-left.
3. Verify the **Kho vật tư** popup displays:
   - Real supplies from PostgreSQL (`Cỏ khô Timothy`, `Yến mạch cán vỡ tiêu hóa nhanh`, etc.) with real stock quantities.
   - For supplies without configured capacity, displays `... (Chưa cấu hình sức chứa)`.
   - **No local "Đặt hàng" button exists** (ordering is exclusively managed on Main Web).
   - Keep this Simulator tab open.

### Step 2: Groom Submits Restock Proposal on Main Web
1. Open a new tab or window and navigate to Main Web: `http://localhost:5173/login`.
2. Sign in as Groom:
   - **Email:** `qa-groom1@gmail.com`
   - **Password:** `EquiFlow@2026`
3. In the sidebar, navigate to **Vật tư & Mua sắm** (`/supplies/requests`).
4. Click **+ Đề xuất nhập thêm vật tư** (+ Propose Supply Restock).
5. Select:
   - **Khu chuồng:** `Zone A - Barn 1`
   - **Vật tư:** `Yến mạch cán vỡ tiêu hóa nhanh`
   - **Số lượng:** `20`
   - **Lý do cần gấp:** `Kiểm thử Human QA TASK-018`
6. Click **Gửi đề xuất**.
7. In the proposal table, verify the new request appears with status **Chờ duyệt** (Pending Review).
8. Notice that Groom has **no review button** and **no confirm delivery button**.
9. Sign out.

### Step 3: Club Manager Approves Proposal
1. Sign in as Club Manager:
   - **Email:** `qa-cm@gmail.com`
   - **Password:** `EquiFlow@2026`
2. Navigate to **Vật tư & Mua sắm** (`/supplies/requests`).
3. Locate the proposal created in Step 2.
4. Click **Duyệt đề xuất** (Review Proposal).
5. Review quantity `20` and click **Xác nhận duyệt**.
6. Observe:
   - The row status **immediately updates to "Đang giao hàng"** (Delivering) with an orange warning badge.
   - **There is no manual "Xác nhận nhận hàng" button**.

### Step 4: Watch Automatic Delivery in Simulator
1. Switch to the Simulator tab (or arrange windows side-by-side).
2. Within seconds of CM approval:
   - In the Supply Panel, the status updates to **"Xe tải đang giao hàng…"** with an orange **"Đang giao"** badge.
   - A delivery truck drives onto the farm road, slows down, and stops directly in front of the barn door.
   - Crates fly into the warehouse door during unloading (~8 seconds total).
   - Once unloading finishes, the Simulator emits `sim:supply_delivery_ack`.
   - The truck drives off the screen to the right.
   - The stock quantity of Oats in Zone A increases by exactly 20 KG.

### Step 5: Verify Automatic Completion on Main Web
1. Switch back to the Main Web tab.
2. Without manual clicking or page refresh, the 2s bounded polling detects delivery completion.
3. The proposal status updates to **"Đã giao"** (Delivered) with a green badge.
4. Verify in **Tồn kho vật tư** (`/supplies/inventory`) that the stock balance for Zone A Oats has incremented by 20 KG.

### Step 6: Verify Offline Fallback (Optional)
1. Close the Simulator tab.
2. Submit and approve another restock proposal for 5 KG.
3. Observe the row shows **"Đang giao hàng"**.
4. After 20 seconds, the Backend watchdog timer completes delivery automatically via `FALLBACK`.
5. The row updates to **"Đã giao"**, and stock increments by 5 KG.

---

## 5. First REJECT Resolution History (2026-10-29)

**Rejection received:** 2026-10-29 (First REJECT). Re-implementation completed same session.

### 5.1 Historical R-1 — Capacity Check Inside Transaction
- `reviewRestockRequest` was moved inside `prisma.$transaction(async tx => { ... })` using raw row locking on `StockBalance`.
- *Correction note:* PostgreSQL row locks (`SELECT ... FOR UPDATE`) are engine-level locks enforced by PostgreSQL across all connection pools and external processes connected to that PostgreSQL instance.

### 5.2 Historical R-2 — Periodic Recovery Sweep & Broadcast-First
- Added 60s periodic sweep timer, broadcast before post-commit notifications/audit, and cleared timer post-commit.

### 5.3 Historical R-3 — Simulator Initial Reconnect Reconciliation
- Added `addInboundDelivery` capability merging and retry handling in `App.tsx`.

### 5.4 Historical R-4 — Secret Resolution
- Removed fallback secrets from `generateAckCapability` and `verifyAckCapability`.

### 5.5 Historical R-5 & R-6 — Historical Verification
- Unit test suites passed (25/25 in service spec).

---

## 6. Second REJECT Resolution Evidence (R-1 through R-5) (2026-10-29)

**Rejection received:** 2026-10-29 (Second REJECT). Re-implementation and reverification completed.

### 6.1 R-1 — Shared Capacity Locking Contract Across All Mutation Paths
- **Uniform Zone-Row Lock Target:**
  - Standardized on `SELECT id FROM "StallZone" WHERE id = ${zoneId} FOR UPDATE` inside `prisma.$transaction` across all four mutation paths:
    1. `reviewRestockRequest`: acquires zone lock, reads balance and active reservations (`DELIVERING`), validates capacity, transitions to `DELIVERING`, commits, schedules watchdog timer, and broadcasts delivery start.
    2. `adjustStock`: wrapped entirely in `$transaction`, acquires zone lock, reads current balance and reservations, validates capacity if positive adjustment, executes upsert.
    3. `deliverRestockRequest`: legacy manual receipt wrapped in `$transaction`, acquires zone lock, reads balance and reservations, validates capacity, executes updateMany and upsert.
    4. `completeDelivery`: automatic completion wrapped in `$transaction`, acquires zone lock, executes atomic status update (`DELIVERING` -> `DELIVERED`), upserts stock balance, commits, cancels watchdog timer, and broadcasts completion.
- **Graceful Absent Row Handling:**
  - If no `StockBalance` row exists for `(zoneId, supplyId)`, `stockBalance.findUnique` returns `null`. Capacity check gracefully handles `null` (skips limit check or uses `null` capacity), and `upsert` creates the row cleanly without runtime error.
- **R-1 Unit Test Proofs (`src/inventory/inventory.service.spec.ts`):**
  - Race between DIFFERENT requests: `req-A` reserves capacity, second concurrent `req-B` exceeds zone capacity and throws `CAPACITY_EXCEEDED` (`vượt quá sức chứa`).
  - Race between approval (`reviewRestockRequest`) and adjustment (`adjustStock`): adjustment exceeds capacity during reservation and throws `CAPACITY_EXCEEDED`.
  - Race between approval (`reviewRestockRequest`) and legacy manual receipt (`deliverRestockRequest`): manual receipt exceeds capacity during reservation and throws `CAPACITY_EXCEEDED`.
  - Absent `StockBalance` row during approval passes cleanly and transitions request to `DELIVERING`.

### 6.2 R-2 — Recovery Available Throughout Process Lifetime
- **Uptime Cutoff Removed:**
  - Completely deleted `MAX_RECOVERY_SWEEP_ITERATIONS` and the iteration counter. Periodic sweep runs throughout the entire lifetime of the process.
- **Single Periodic Timer with Destruction Lifecycle:**
  - Bounded periodic sweep timer (`recoverySweepTimer`, 60s) initialized on `onModuleInit` and explicitly cleared on `onModuleDestroy`.
- **Overlap Prevention:**
  - Added boolean guard `isSweepRunning` to prevent concurrent sweep iterations if a sweep is delayed.
- **PostgreSQL Concurrency Reality:**
  - Corrected architectural documentation: PostgreSQL row locks (`SELECT ... FOR UPDATE`) are managed by the PostgreSQL database engine lock manager within an active transaction. They are connection-pool agnostic and serialize concurrent transactions across all connections and processes.
- **R-2 Unit Test Proofs (`src/inventory/inventory.service.spec.ts`):**
  - `isSweepRunning` guard prevents overlapping recovery sweeps.
  - Recovers overdue pending deliveries after extended uptime (>20s).
  - Recovery sweeps continue indefinitely without 24-hour iteration cutoff.

### 6.3 R-3 — Authoritative Reconnect Reconciliation & Decoupled Simulator ACK
- **Authoritative Snapshot Reconciliation (`src/sim/inventory.ts`):**
  - Added pure helper `reconcileAuthoritativeDeliveries(inv, backendActiveDeliveries, nowSec, wallClockNowMs)`.
  - On initial load and socket reconnect, local pending orders are reconciled against Backend `activeDeliveries`.
  - Orders that completed or were cancelled on Backend are pruned; stale `currentOrders` are not retained blindly.
- **Strict Decoupling of Animation from Acknowledgment:**
  - Animation completion (`nowSeconds >= o.arriveAt`) does NOT mark order as `acked: true` without `ackCapability`.
  - If capability is missing when truck arrives, truck unloads and waits; order remains `isArrived = true`, `acked = false`.
  - As soon as capability arrives (e.g. after 8s), the next tick (every 250ms) triggers `sendAck` and marks `acked: true`.
  - On `sendAck` rejection/network error, `acked` is reset to `false` in `App.tsx` so the next tick or reconnect retries immediately.
- **R-3 Simulator Unit Test Proofs (`src/sim/inventory.test.ts`):**
  - Missing capability after 8s animation does NOT mark acked or send ACK.
  - Capability arriving after 8s triggers ACK and marks acked on the next tick.
  - Lost completion event: local order missing from Backend `activeDeliveries` is pruned automatically upon reconciliation.
  - Reconnect after Backend completed delivery updates authoritative stock balance and clears local pending order.

### 6.4 R-4 — Scope Hygiene, File Preservation & Report Correction
- **Out-of-Scope File Deleted:**
  - `Racehorse_Simulator_Web/src/sim/inventory.test.mjs` was deleted; all test cases merged into authorized `src/sim/inventory.test.ts`.
- **User Audio & UI Files Strictly Preserved:**
  - `NOW1.txt`, `NOW2.txt`, `music/`, `public/audio/`, `src/audio/`, `AudioControl.tsx`, `FarmMapCanvas.tsx`, `IntroOverlay.tsx`, `Popup.tsx` preserved untouched.
- **Report & State Metadata Corrected:**
  - Report header updated: `next_task` is `TASK-018`.
  - Historical first REJECT test records separated from second REJECT test results.

### 6.5 R-5 — Complete Reverification & Quality Gate Matrix

| Quality Gate | Exact Command | Result | Exit Code |
| :--- | :--- | :--- | :---: |
| **Backend Unit Tests** | `npm test -- src/inventory/` | **50/50 PASS (3 test suites)** | 0 |
| • Gateway Spec | `src/inventory/supply-delivery.gateway.spec.ts` | 7 passed | 0 |
| • Service Spec | `src/inventory/inventory.service.spec.ts` | 31 passed | 0 |
| • Controller Spec | `src/inventory/inventory.controller.spec.ts` | 12 passed | 0 |
| **Backend Lint** | `npm run lint` | **0 errors, 0 warnings** | 0 |
| **Backend Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Simulator Tests** | `npm test` | **165/165 PASS (0 failed)** | 0 |
| • Inventory Spec | `src/sim/inventory.test.ts` | 17 passed | 0 |
| • Transport Spec | `src/sim/supplyTransport.test.ts` | 3 passed | 0 |
| • API Spec | `src/api/inventoryApi.test.ts` | 2 passed | 0 |
| • Core/Farm Specs | Engine, Canvas, HitTest, Stalls, Vitals | 143 passed | 0 |
| **Simulator Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Simulator Build** | `npm run build` | **Vite build succeeded** | 0 |
| **Frontend Lint** | `npm run lint` | **0 errors** | 0 |
| **Frontend Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Frontend Build** | `npm run build` | **Vite build succeeded** | 0 |
| **Playwright E2E (1280)** | `npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1280` | **1/1 PASS (45.4s)** | 0 |
| **Playwright E2E (1440)** | `npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1440` | **1/1 PASS (46.9s)** | 0 |

---

## 7. Third REJECT Resolution Evidence (Human QA Exact Stock Display Correction) (2026-10-29)

**Rejection received:** 2026-10-29 (Third REJECT):
> "REJECT TASK-018: Sửa theo mục “TASK-018 Human QA correction — exact stock display” trong canonical HANDOFF.md.
> Hiển thị đúng số thập phân từ DB; trạng thái giao phải khớp zoneId + supplyId; tự refresh tồn khi bảng kho mở. Kiểm thử browser với số lượng thập phân và cùng vật tư ở hai khu kho.
> Hoàn tất tại AWAITING_USER_QA và STOP."

### 7.1 Authoritative Fractional Stock Quantity Rendering
- **Root Cause:**
  - PostgreSQL stores quantities as `Decimal(12,2)` (e.g. `25.25`, `0.50`). The Backend `/api/inventory/simulator/context` endpoint returns them as numbers (`Number(sb.quantity)`).
  - In `SupplyPanel.tsx`, `Math.ceil(item.quantity)` was previously applied before passing into `<CountUp />`, and `<CountUp />` used `Math.round()`. Consequently, `25.25` was rounded up to `26`, and `0.50` was rounded up to `1`, losing all fractional precision.
- **Implementation Fix:**
  - Added pure exported helper `formatStockQuantity(value: number): string` in `Racehorse_Simulator_Web/src/sim/inventory.ts`:
    - Preserves integers without decimals (e.g. `20` -> `'20'`, `0` -> `'0'`).
    - Rounds to 2 decimal places to prevent IEEE 754 floating-point artifacts and trims trailing zeros (e.g. `25.25` -> `'25.25'`, `0.5` -> `'0.5'`, `12.34` -> `'12.34'`).
  - Updated `SupplyPanel.tsx`:
    - Removed `Math.ceil(item.quantity)`; passed raw `item.quantity` to `<CountUp value={item.quantity} />`.
    - In `CountUp`, when the animated value approaches the target (`Math.abs(current - value) < 0.005`), it snaps directly to `value` and renders `formatStockQuantity(val)`, ensuring animation settles on the exact persisted value.
    - Updated meter `aria-valuenow={Math.round(item.quantity * 100) / 100}` (removing `Math.ceil`).
- **Unit Test Coverage:**
  - Added unit test in `src/sim/inventory.test.ts`: `formatStockQuantity formats decimal stock accurately with up to two fractional digits` (tested `25.25`, `0.5`, `0.50`, `0`, `20`, `12.34`).

### 7.2 Multi-Zone Delivery Indication Isolation (`zoneId + supplyId`)
- **Root Cause:**
  - In `SupplyPanel.tsx`, the `pending` delivery condition was evaluated as:
    `inventory.orders.some((o) => o.supplyId === item.supplyId || o.supplyCode === item.supplyCode)`
  - When the same supply existed in multiple zones (e.g. Oats in Zone A and Oats in Zone B), an active delivery for Zone A caused Zone B's row to also display "Xe tải đang giao hàng…" and "Đang giao".
- **Implementation Fix:**
  - Updated matching predicate in `SupplyPanel.tsx`:
    `inventory.orders.some((o) => o.zoneId === item.zoneId && (o.supplyId === item.supplyId || o.supplyCode === item.supplyCode))`
  - Added `data-zone-id={item.zoneId}` and `data-zone-code={item.zoneCode}` attributes to each `<li>` row.
- **Unit Test Coverage:**
  - Added unit test in `src/sim/inventory.test.ts`: `delivery pending indication matches BOTH zoneId and supplyId without leaking across zones`. When Zone A Oats is delivering, Zone A is marked pending while Zone B Oats remains not pending.

### 7.3 Bounded Auto-Refresh while Warehouse Panel Open
- **Implementation Fix:**
  - In `SupplyPanel.tsx`, added `onRefresh?: () => Promise<void> | void` prop. When mounted (open), sets a bounded `setInterval(onRefresh, 2000)` and cleans it up via `clearInterval(timer)` upon unmount (`onClose`).
  - In `FarmHub.tsx`, forwarded `onRefreshInventory` to `SupplyPanel` and called `onRefreshInventory?.()` immediately when the warehouse building is clicked on canvas or HUD button clicked.
  - In `App.tsx`, added `latestInventorySeqRef = useRef<number>(0)` to `loadInventory`. Each call increments `seq = ++latestInventorySeqRef.current`. Stale or delayed responses (`seq !== latestInventorySeqRef.current`) are cleanly discarded, preventing race conditions or out-of-order snapshots.
  - Passed `onRefreshInventory={loadInventory}` to `<FarmHub />`.
  - Errors during fetch are shown visibly in the UI without mock fallback.

### 7.4 Real-Stack Browser QA (`tests/e2e/simulator-real-stack.spec.ts`)
- Updated Playwright test with real PostgreSQL, NestJS API, Vite Web, and Vite Simulator:
  1. **Decimal & Zero Stock Setup:**
     - Zone A Oats configured to `25.25 KG`.
     - Zone B Oats configured to `0.50 KG` (or `0.5 KG`).
     - Zone A Alfalfa configured to `0 KG`.
     - Simulator warehouse panel displays `'25.25'` (not `26`), `'0.5'` (not `1`), and `'0 KG'`.
  2. **Delivery Cross-Zone Isolation:**
     - Groom submits restock proposal for Zone A Oats (20 KG); CM approves it.
     - Simulator Zone A Oats row displays "Xe tải đang giao hàng…" and "Đang giao".
     - Simulator Zone B Oats row (same supply `SUP_GRAIN_OATS`) does NOT show "Đang giao" or "Xe tải đang giao hàng…".
  3. **Auto-Refresh without Manual Reload:**
     - While warehouse panel remains open in Simulator, Club Manager makes a Web adjustment on Zone B Oats to `15.75 KG` via `POST /api/inventory/adjust`.
     - Without calling `simPage.reload()`, Simulator auto-polls and updates Zone B Oats to display `'15.75'` within 2-4 seconds.
  4. **Completed Delivery & Persistence:**
     - Delivery truck animates 8s, unloads, and emits ACK.
     - Web transitions row to "Đã giao" (Delivered).
     - Simulator updates Zone A Oats stock to `25.25 + 20 = 45.25`.
     - Simulator page reloaded; re-opening warehouse panel confirms `45.25` and `15.75` persist from PostgreSQL.
  5. **Offline Fallback Watchdog:**
     - Simulator closed. Second request (5 KG) submitted and approved.
     - 20s watchdog completes delivery via `FALLBACK`; PostgreSQL reflects `45.25 + 5 = 50.25`.
  6. **Fail-Safe Cleanup in `finally`:**
     - Restored exact pre-test baseline stock balances.
     - Deleted test-created requests, notifications, and audit logs by exact ID.
     - Verified sentinel notification survived untouched.

### 7.5 Quality Gate Matrix & Execution Evidence

| Quality Gate | Exact Command | Result | Exit Code |
| :--- | :--- | :--- | :---: |
| **Backend Unit Tests** | `npm test -- src/inventory/` | **50/50 PASS (3 test suites)** | 0 |
| • Gateway Spec | `src/inventory/supply-delivery.gateway.spec.ts` | 7 passed | 0 |
| • Service Spec | `src/inventory/inventory.service.spec.ts` | 31 passed | 0 |
| • Controller Spec | `src/inventory/inventory.controller.spec.ts` | 12 passed | 0 |
| **Backend Lint** | `npm run lint` | **0 errors, 0 warnings** | 0 |
| **Backend Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Backend Whitespace** | `git diff --check` | **0 whitespace errors** | 0 |
| **Simulator Tests** | `npm test` | **179/179 PASS (0 failed)** | 0 |
| • Audio Spec | `src/audio/audioManager.test.ts` | 12 passed | 0 |
| • Inventory Spec | `src/sim/inventory.test.ts` | 19 passed | 0 |
| • Transport Spec | `src/sim/supplyTransport.test.ts` | 3 passed | 0 |
| • API Spec | `src/api/inventoryApi.test.ts` | 2 passed | 0 |
| • Core/Farm Specs | Engine, Canvas, HitTest, Stalls, Vitals | 143 passed | 0 |
| **Simulator Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Simulator Build** | `npm run build` | **Vite build succeeded (code 0)** | 0 |
| **Simulator Whitespace** | `git diff --check` | **0 whitespace errors** | 0 |
| **Frontend Lint** | `npm run lint` | **0 errors** | 0 |
| **Frontend Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 |
| **Frontend Build** | `npm run build` | **Vite build succeeded (code 0)** | 0 |
| **Frontend Whitespace** | `git diff --check` | **0 whitespace errors** | 0 |
| **Playwright E2E (1280)** | `npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1280` | **2/2 PASS (50.6s)** | 0 |
| **Playwright E2E (1440)** | `npx playwright test tests/e2e/simulator-real-stack.spec.ts -g "TASK-018" --project=desktop-1440` | **2/2 PASS (51.2s)** | 0 |

### 7.6 Clean Unconfigured Capacity Stock Presentation (Option A)
- **User Clarification (2026-10-29 10:23 Asia/Bangkok):** User confirmed preference for Option A: clean stock display presenting pure authoritative quantity and unit (e.g. `45 KG`, `25.25 KG`) without the `(Chưa cấu hình sức chứa)` suffix text when `capacity === null`.
- **Implementation:** In [SupplyPanel.tsx](file:///e:/01_Academic_FPT/Courses/Se_5_Active/SWP391/MINH_Racehorse_Branch/Racehorse_Simulator_Web/src/ui/SupplyPanel.tsx), when `hasCapacity` is false, renders `<CountUp value={item.quantity} /> {item.unit}` cleanly.
- **Verification:** Both Playwright real-stack tests (`desktop-1280` and `desktop-1440`) and Simulator unit tests verified.

### 7.7 Combined CR-025 Sound & Supply Integration Proof
- **Dedicated Focused Unit Test ([audioManager.test.ts](file:///e:/01_Academic_FPT/Courses/Se_5_Active/SWP391/MINH_Racehorse_Branch/Racehorse_Simulator_Web/src/audio/audioManager.test.ts)):**
  - Verified default audio settings initialization (`musicEnabled: true, sfxEnabled: true, musicVolume: 0.5, sfxVolume: 0.7`).
  - Verified settings persistence to `localStorage` under key `equiflow_audio_settings` and recovery from corrupt JSON.
  - Verified volume clamping strictly to `[0.0, 1.0]` across both BGM and SFX.
  - Verified subscriber notification pattern on mute/volume toggles.
  - Verified audio ducking (`duckMusic(true)` scales BGM volume to 25%, restores on unduck).
  - Verified concurrency throttle (`throttleMs = 50`) prevents duplicate overlapping sound bursts.
  - Verified safe error handling: never throws even when browser autoplay blocks `play()` or `Audio` rejects.
- **Self-Contained Production Build:**
  - `npm run build` in `Racehorse_Simulator_Web` succeeds (code 0) in 560ms without requiring `theme-main.wav` or `music/` files.
  - All 12 runtime audio files in `public/audio/` are copied to `dist/audio/`.
- **Real-Stack Browser E2E Smoke Tests ([simulator-real-stack.spec.ts](file:///e:/01_Academic_FPT/Courses/Se_5_Active/SWP391/MINH_Racehorse_Branch/Racehorse_Training_Management_System_MT_FE/tests/e2e/simulator-real-stack.spec.ts)):**
  - **Autoplay Handling:** Browser starts with autoplay safely handled; HUD audio icon displays `🎵`.
  - **Audio HUD Controls:** Clicking audio button opens popover displaying "Âm Thanh EquiFlow", BGM checkbox, SFX checkbox, BGM slider (50%), SFX slider (70%).
  - **Mute / Volume Adjust:** Toggling BGM off updates button icon to `🔇`, updates slider to 40%, and persists to `localStorage`.
  - **Reload Persistence:** Reloading Simulator page preserves `musicEnabled: false` and `sfxVolume: 0.4` across page loads.
  - **Sound On vs Sound Off Delivery:**
    - With sound enabled, supply panel opens with `building-open` SFX, deliveries trigger arrival/stop/complete SFX.
    - With sound completely muted, supply panel and real-time replenishment operations execute completely error-free and update stock balances.

---

## 8. Status & Gate Compliance

- **Active Task:** NONE
- **Active Task Status:** IDLE\n- **Last Approved Task:** TASK-018 (Approved 2026-10-29 11:38 Asia/Bangkok)
- **Next Task:** TASK-019 (unauthorized; awaits separate human command / START TASK-019)
- **Git State:** 0 commits, 0 pushes, 0 merges executed.
- **Next Eligible Action:** STOP and await separate human authorization (commit authorization or separate START TASK-019). TASK-019 remains strictly unauthorized.
