# TASK-006 — Execution Report

- **Plan version:** v1-approved-r9
- **Status:** DONE
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / starting: `f4daa68` / ending: working tree (supplies controller guarded with `@UseGuards(JwtAuthGuard, RolesGuard)`, controller spec Reflector tests for supplies and inventory added)
  - Frontend: `main` / starting: `b95035b` / ending: working tree (SuppliesCatalogPage modal renders hardened with `isManager &&`, Playwright E2E test suite `tests/e2e/supplies.spec.ts` added)
- **Files Changed & Why:**
  1. `Racehorse_Training_Management_System_MT_BE/src/supplies/supplies.controller.ts`:
     - Added explicit `@UseGuards(JwtAuthGuard, RolesGuard)` to the controller class to ensure JWT authentication and role-based guards are applied explicitly.
     - Confirmed `@Roles(UserRole.CLUB_MANAGER)` on catalog mutations: `POST /supplies`, `PUT /supplies/:id`, `PATCH /supplies/:id/status`.
     - Confirmed `@Roles(...STAFF)` (`CLUB_MANAGER`, `HEAD_TRAINER`, `VETERINARIAN`, `GROOM`) on catalog queries: `GET /supplies`, `GET /supplies/:id` (with non-CM unit price stripping enforced by `SuppliesService`).
  2. `Racehorse_Training_Management_System_MT_BE/src/supplies/supplies.controller.spec.ts`:
     - Added Reflector metadata assertions verifying:
       - `create`, `update`, `setStatus` are strictly guarded with `@Roles(UserRole.CLUB_MANAGER)` and reject `GROOM` and `HORSE_OWNER`.
       - `findAll`, `findOne` allow `STAFF` roles including `GROOM` and `CLUB_MANAGER`, while excluding `HORSE_OWNER`.
     - Retained and verified handler delegation to `SuppliesService`.
  3. `Racehorse_Training_Management_System_MT_BE/src/inventory/inventory.controller.spec.ts`:
     - Added Reflector metadata assertions verifying:
       - `adjustStock`, `reviewRestockRequest`, `deliverRestockRequest` are strictly guarded with `@Roles(UserRole.CLUB_MANAGER)` and reject `GROOM` and `HORSE_OWNER`.
     - Added test verifying delegation of `createRestockRequest` for `GROOM` role.
     - Retained and verified handler delegation to `InventoryService`.
  4. `Racehorse_Training_Management_System_MT_FE/src/features/master-data/pages/SuppliesCatalogPage.tsx`:
     - Hardened modal renders by wrapping `SupplyModal` and `ConfirmModal` with `isManager &&` to prevent non-managers from triggering mutation dialogs even if component state is altered.
     - Confirmed that table column `Unit Price (VND)` and row actions (`Edit`, `Stop using` / `Use again`) as well as the `+ Add Supply` button remain hidden when `!isManager`.
  5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/supplies.spec.ts`:
     - Created automated Playwright test suite covering:
       - Groom views catalog: unit price and catalog management actions are hidden; category filtering and text search remain functional.
       - Club Manager views catalog: full management controls (`+ Add Supply`, `Edit`) and unit prices are visible.
       - Horse Owner visits `/catalogs/supplies`: blocked by client-side 403 page.
       - Groom views zone inventory (`/supplies/inventory`): `Request Restock` button is visible, `Adjust` stock button is hidden.
       - Club Manager views zone inventory (`/supplies/inventory`): both `Adjust` and `Request Restock` buttons are visible.

---

## Acceptance Criteria Checklist (TASK-006)

- [x] **AC-1:** Groom can view supplies catalog (`/catalog` -> `/catalogs/supplies`):
  - Catalog query returns HTTP 200 OK with `unitPrice` set to `null` for Groom.
  - UI hides `+ Add Supply` button, unit price column, and action buttons (`Edit`, `Stop using` / `Use again`).
  - Category filters and search input remain functional.
- [x] **AC-2:** Groom can view assigned zone inventory (`/supplies/inventory`):
  - Zone inventory table displays stock balances and alert thresholds.
  - `Request Restock` button is visible and allows proposing replenishments.
  - `Adjust` stock button is hidden.
- [x] **AC-3:** Groom can submit restock requests (`POST /inventory/requests`):
  - Positive quantities (`requestedQuantity > 0`) accepted (HTTP 201 Created).
  - Non-positive quantities (`requestedQuantity <= 0`) rejected (HTTP 400 Bad Request).
- [x] **AC-4:** Groom cannot mutate supply catalog or perform manager inventory operations:
  - `POST /supplies`, `PUT /supplies/:id`, `PATCH /supplies/:id/status` rejected with HTTP 403 Forbidden.
  - `POST /inventory/adjust`, `POST /inventory/requests/:id/review`, `POST /inventory/requests/:id/deliver` rejected with HTTP 403 Forbidden.
- [x] **AC-5:** Club Manager retains full catalog and inventory governance:
  - Can view unit price and create, edit, deactivate/reactivate supplies.
  - Can adjust physical inventory stock, review/approve/reject restock requests, and confirm deliveries.
- [x] **AC-6:** Horse Owner cannot access supply catalog or inventory:
  - Backend queries (`GET /supplies`, `GET /inventory`) rejected with HTTP 403 Forbidden.
  - Frontend navigation displays client-side 403 Access Denied page.
- [x] **AC-7:** Full automated test verification:
  - Backend Jest unit tests: 31/31 passed across supplies and inventory suites.
  - Frontend Playwright E2E tests: 10/10 passed across desktop-1280 and desktop-1440 projects.
  - Backend & Frontend lint and typecheck: Backend clean with 0 errors and 0 warnings; Frontend clean with 0 errors (reports existing baseline warnings; does not fail).

---

## Verification Evidence

### 1. Backend Unit Tests (`npm test -- src/supplies/ src/inventory/`)

- **Command:** `npm test -- src/supplies/ src/inventory/`
- **Output:**
  ```
  PASS src/supplies/supplies.service.spec.ts
  PASS src/inventory/inventory.service.spec.ts
  PASS src/supplies/supplies.controller.spec.ts
  PASS src/inventory/inventory.controller.spec.ts

  Test Suites: 4 passed, 4 total
  Tests:       31 passed, 31 total
  Snapshots:   0 total
  Time:        7.879 s
  ```
- **Exit Code:** `0`

---

### 2. Backend Typecheck & Lint

- **Command:** `npm run typecheck`
- **Output:** `tsc --noEmit` exited with code 0.
- **Command:** `npm run lint`
- **Output:** `eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0` exited with code 0 (0 errors, 0 warnings).

---

### 3. Frontend Typecheck & Lint

- **Command:** `npm run typecheck`
- **Output:** `tsc --noEmit` exited with code 0.
- **Command:** `npm run lint`
- **Output:** `oxlint` exited with code 0 (0 errors; reports existing baseline warnings on pre-existing files).

---

### 4. Frontend Playwright E2E Tests (`npx playwright test tests/e2e/supplies.spec.ts`)

- **Command:** `npx playwright test tests/e2e/supplies.spec.ts`
- **Output:**
  ```
  Running 10 tests using 1 worker

    ok  1 [desktop-1280] › tests\e2e\supplies.spec.ts:12:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Groom views catalog: unit price and catalog management actions are hidden (4.2s)
    ok  2 [desktop-1280] › tests\e2e\supplies.spec.ts:40:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Club Manager views catalog: full management controls and unit price are visible (4.3s)
    ok  3 [desktop-1280] › tests\e2e\supplies.spec.ts:57:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Horse Owner cannot access supplies catalog (client 403) (3.7s)
    ok  4 [desktop-1280] › tests\e2e\supplies.spec.ts:68:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Groom views zone inventory: Request Restock is visible, Adjust is hidden (4.1s)
    ok  5 [desktop-1280] › tests\e2e\supplies.spec.ts:82:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Club Manager views zone inventory: Adjust and Request Restock are both visible (3.8s)
    ok  6 [desktop-1440] › tests\e2e\supplies.spec.ts:12:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Groom views catalog: unit price and catalog management actions are hidden (4.3s)
    ok  7 [desktop-1440] › tests\e2e\supplies.spec.ts:40:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Club Manager views catalog: full management controls and unit price are visible (3.9s)
    ok  8 [desktop-1440] › tests\e2e\supplies.spec.ts:57:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Horse Owner cannot access supplies catalog (client 403) (3.6s)
    ok  9 [desktop-1440] › tests\e2e\supplies.spec.ts:68:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Groom views zone inventory: Request Restock is visible, Adjust is hidden (4.0s)
    ok 10 [desktop-1440] › tests\e2e\supplies.spec.ts:82:3 › TASK-006: Supply Catalog and Inventory RBAC (ADR-004 / CR-002) › Club Manager views zone inventory: Adjust and Request Restock are both visible (3.8s)

    10 passed (42.2s)
  ```
- **Exit Code:** `0`

---

### 5. Live Server Endpoint RBAC Matrix Verification

- **Target:** Live NestJS API (`http://localhost:3000/api`)
- **Evidence Summary:**
  - `GET /supplies` as Groom: HTTP 200 OK, `unitPrice: null` stripped on all items.
  - `GET /supplies` as Horse Owner: HTTP 403 Forbidden.
  - `POST /supplies` as Groom: HTTP 403 Forbidden.
  - `PUT /supplies/:id` as Groom: HTTP 403 Forbidden.
  - `PATCH /supplies/:id/status` as Groom: HTTP 403 Forbidden.
  - `POST /inventory/adjust` as Groom: HTTP 403 Forbidden.
  - `POST /inventory/requests` as Groom (qty: 0 or -5): HTTP 400 Bad Request.
  - `POST /inventory/requests` as Groom (qty: 10): HTTP 201 Created.
  - `POST /inventory/requests/:id/review` as Groom: HTTP 403 Forbidden.
  - `POST /inventory/requests/:id/deliver` as Groom: HTTP 403 Forbidden.
  - Club Manager performs catalog creation, inventory adjustment, review, and delivery without role restriction.

---

## Manual QA Verification Steps for the Human Reviewer

### Step 1: Verify Groom Read Access to Catalog (Unit Price Hidden, Mutation Actions Hidden)
1. Open the frontend in browser: `http://localhost:5173`.
2. Sign in as Groom (`groom@gmail.com` / `EquiFlow@2026`).
3. In the sidebar under **SUPPLIES**, click **Supplies Catalog** (or navigate to `http://localhost:5173/catalogs/supplies`).
4. Verify:
   - Page header displays "Supplies Catalog".
   - The **+ Add Supply** button is **NOT** present.
   - The table does **NOT** display the "Unit Price (VND)" column.
   - The table does **NOT** display "Edit" or "Stop using" action buttons.
   - Category filter tabs (e.g., "Feed & Forage") and search input are fully functional.

### Step 2: Verify Groom Zone Inventory & Restock Request
1. While logged in as Groom (`groom@gmail.com`), click **Zone Inventory** (`/supplies/inventory`).
2. Verify:
   - Page displays "Zone Supply Inventory".
   - The **Request Restock** button is visible on each inventory row.
   - The **Adjust** stock button is **NOT** visible.
3. Click **Request Restock** on any item.
4. Input a valid quantity (e.g., `10`) and a reason (e.g., "Replenishing low feed"), then submit.
   - *Expected:* Restock request is submitted successfully (HTTP 201 Created).

### Step 3: Verify Club Manager Full Catalog & Inventory Governance
1. Log out and sign in as Club Manager (`manager@gmail.com` / `EquiFlow@2026`).
2. Navigate to **Supplies Catalog** (`/catalogs/supplies`).
3. Verify:
   - **+ Add Supply** button **IS** visible in the header.
   - Table displays the **Unit Price (VND)** column with formatted amounts.
   - Table rows display **Edit** and **Stop using** / **Use again** buttons.
4. Navigate to **Zone Inventory** (`/supplies/inventory`).
5. Verify:
   - Both **Request Restock** and **Adjust** buttons **ARE** visible on table rows.

### Step 4: Verify Horse Owner Access Block (Client 403)
1. Log out and sign in as Horse Owner (`owner@gmail.com` / `EquiFlow@2026`).
2. Enter the catalog URL in browser address bar: `http://localhost:5173/catalogs/supplies`.
3. Verify:
   - Access is blocked with client-side **403 · ACCESS DENIED** page (*"Access restricted"*).
