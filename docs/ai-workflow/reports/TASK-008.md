# TASK-008 — Execution Report

- **Plan version:** v1-approved-r10
- **Status:** DONE
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / starting: `a170654` / ending: working tree (`src/notifications/notifications.service.ts`, `src/notifications/notifications.service.spec.ts`, `src/accounts/accounts.service.ts`, `src/accounts/accounts.service.spec.ts`)
  - Frontend: `main` / starting: `80d96ea` / ending: working tree (`tests/e2e/notifications.spec.ts`)
- **Files Changed & Why (strictly the 5 authorized files under M scope limit):**
  1. `Racehorse_Training_Management_System_MT_BE/src/notifications/notifications.service.ts`:
     - Updated `horseAudience` to select `horse.ownerId` and active stall allocations (`where: { isActive: true }`, selecting `assignedGroomUserId`). Any nullable or undefined IDs returned by the Prisma query are safely filtered out by `notifyUsers` prior to recipient lookup and notification row persistence.
     - Updated `excludeUserId?: string | null` in `notifyUsers`, `notifyRoles`, and `notifyHorse` signatures to safely handle callers passing nullable actor IDs.
  2. `Racehorse_Training_Management_System_MT_BE/src/notifications/notifications.service.spec.ts`:
     - Expanded unit test suite from 4 to 19 comprehensive tests covering positive and negative recipient routing.
     - Verified:
       - Inactive users (`status: INACTIVE` or `LOCKED`) are excluded from notification recipients.
       - Disabled notification preferences (`notify: { thresholdAlert: false }`, `lockLifted: false`, etc.) are respected and omitted.
       - Acting user (`excludeUserId`) is excluded from recipient list.
       - Foreign owners and unassigned grooms are excluded from horse audience.
       - Non-existent horse or horses without active stall allocations handle gracefully and return empty recipient list.
       - Unique dedupe keys are generated per recipient (`${dedupeKey}:${userId}`).
       - Role-based dispatching (`notifyRoles`) filters strictly to active users of the specified roles and excludes actor.
       - Inbox operations (`list`, `markRead`, `markAllRead`, `clear`) handle pagination, ordering, and state updates correctly.
  3. `Racehorse_Training_Management_System_MT_BE/src/accounts/accounts.service.ts`:
     - Injected `NotificationsService`.
     - In `changeStatus`: on `approve`, `unlock`, and `reactivate`, added targeted in-app notification dispatch to `[updated.id]` with category `ACCOUNT`, type `ACCOUNT_STATUS_CHANGED`, and `actor.id` excluded. Negative: `lock` and `decline` do not notify the target.
     - In `updatePermissions`: after the row-locking database transaction commits, added targeted in-app notification dispatch to `[result.user.id]` with category `ACCOUNT`, type `ACCOUNT_PERMISSIONS_CHANGED`, parameters `{ granted, revoked }`, and `actor.id` excluded. Executing after transaction commit ensures zero interactive transaction timeouts (`P2028`).
  4. `Racehorse_Training_Management_System_MT_BE/src/accounts/accounts.service.spec.ts`:
     - Added mock `NotificationsService` to test module.
     - Added assertions verifying targeted notification dispatch on `approve`, `unlock`, and `reactivate`, and verified no notification is dispatched on account `lock`.
     - Added assertions verifying targeted notification dispatch on `updatePermissions` with accurate `granted` and `revoked` counts.
  5. `Racehorse_Training_Management_System_MT_FE/tests/e2e/notifications.spec.ts`:
     - Updated `signIn` helper to support configurable password and accept role-specific dashboard redirects (`/owner/dashboard`, `/groom/dashboard`).
     - Added end-to-end multi-role isolation tests:
       - Veterinarian sees clinical alerts and does not see manager account requests.
       - Horse Owner does not receive staff administrative (`New Account Registration Request`, `Permission Access Request`) or clinical observation notices.

---

## Acceptance Criteria Checklist (TASK-008)

- [x] **AC-1:** Horse Owner / Groom horse notifications scoped to owned / assigned horse:
  - `horseAudience` selects `ownerId` and active `stallAllocations.assignedGroomUserId`; `notifyUsers` filters any nullable or undefined IDs before recipient lookup and persistence.
  - Negative unit tests confirm foreign owners and unassigned grooms are never added.
  - Live database check confirms Crimson Flash routes to Owner 1 (`owner@gmail.com`) and Groom 1 (`groom@gmail.com`), while Ocean Breeze routes to Owner 2 (`owner2@gmail.com`) and Groom 2 (`groom2@gmail.com`).
- [x] **AC-2:** Account status and permission changes reach target actor:
  - `AccountsService.changeStatus` emits `ACCOUNT_STATUS_CHANGED` to `[updated.id]` on approve/unlock/reactivate.
  - `AccountsService.updatePermissions` emits `ACCOUNT_PERMISSIONS_CHANGED` to `[target.id]` with `{ granted, revoked }`.
  - Live NestJS API test verified CM updating permissions for Groom 1 delivered `ACCOUNT_PERMISSIONS_CHANGED` directly to Groom 1 inbox, with 0 notices delivered to Owner 1 or Owner 2.
- [x] **AC-3:** Restock requests reach Club Manager on creation and Groom requester on review/delivery:
  - `InventoryService.createRestockRequest` calls `notifyRoles([Role.CLUB_MANAGER], ...)`.
  - `InventoryService.reviewRestockRequest` and `deliverRestockRequest` call `notifyUsers([request.requestedById], ...)`.
  - Live PostgreSQL database verification confirms `RESTOCK_REQUEST_CREATED` delivered to `manager@gmail.com`, and `RESTOCK_APPROVED` / `RESTOCK_DELIVERED` delivered to `groom@gmail.com`.
- [x] **AC-4:** No unrelated recipient rows:
  - Negative recipient tests in `notifications.service.spec.ts` prove inactive accounts, opted-out notification settings, and foreign actors receive 0 rows.
  - Live API check cross-referencing Owner 1 and Owner 2 notification tables revealed 0 shared notification IDs and 0 foreign data leaks.
- [x] **AC-5:** Full automated test verification:
  - Backend Jest unit tests: 42/42 passed across notifications and accounts (`PASS src/notifications/notifications.service.spec.ts`, `PASS src/accounts/accounts.service.spec.ts`, `PASS src/accounts/me.service.spec.ts`).
  - Backend Typecheck: `npm run typecheck` passed (exit code 0).
  - Backend Lint: `npm run lint -- --max-warnings=0` passed (0 errors, 0 warnings).
  - Frontend Playwright E2E: 8/8 passed across `desktop-1280` and `desktop-1440` in `tests/e2e/notifications.spec.ts`.
  - Frontend Typecheck: `npm run typecheck` passed (exit code 0).
  - Frontend Lint: `npm run lint` passed (exit code 0; pre-existing baseline React hook/effect warnings in existing health/stable/master-data pages outside TASK-008 scope, 0 errors).
  - `git diff --check` passed cleanly in both Backend and Frontend repositories.
- [x] **AC-6:** Real-stack API & Database Verification (CR-010 compliance):
  - Verified live against running NestJS (`http://localhost:3000/api`) and PostgreSQL container.
  - Cross-audience inbox inspection proved strict isolation among Club Manager, Veterinarian, Groom, and Horse Owner.

---

## Verification Evidence

### 1. Backend Unit Tests (`npm test -- src/notifications src/accounts`)

- **Command:** `npm test -- src/notifications src/accounts`
- **Output:**
  ```
  PASS src/notifications/notifications.service.spec.ts (10.354 s)
  PASS src/accounts/me.service.spec.ts (8.4 s)
  PASS src/accounts/accounts.service.spec.ts (7.886 s)

  Test Suites: 3 passed, 3 total
  Tests:       42 passed, 42 total
  Snapshots:   0 total
  Time:        11.124 s
  Ran all test suites matching /src\notifications|src\accounts/i.
  ```
- **Exit Code:** `0`

---

### 2. Backend Typecheck & Lint

- **Command:** `npm run typecheck`
- **Output:**
  ```
  > racehorse-training-management-system-be@0.1.0 typecheck
  > tsc --noEmit
  ```
- **Exit Code:** `0`

- **Command:** `npm run lint -- --max-warnings=0`
- **Output:**
  ```
  > racehorse-training-management-system-be@0.1.0 lint
  > eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0 --max-warnings=0
  ```
- **Exit Code:** `0` (0 errors, 0 warnings)

---

### 3. Frontend Playwright E2E Tests (`npx playwright test tests/e2e/notifications.spec.ts`)

- **Command:** `npx playwright test tests/e2e/notifications.spec.ts`
- **Output:**
  ```
  Running 8 tests using 1 worker

    ok 1 [desktop-1280] › tests\e2e\notifications.spec.ts:12:1 › opening the Pending tab marks the sign-up notification as read (5.2s)
    ok 2 [desktop-1280] › tests\e2e\notifications.spec.ts:20:1 › a role only sees its own notifications (3.7s)
    ok 3 [desktop-1280] › tests\e2e\notifications.spec.ts:26:1 › Veterinarian sees clinical alerts and does not see manager account requests (4.4s)
    ok 4 [desktop-1280] › tests\e2e\notifications.spec.ts:34:1 › Horse Owner does not receive staff administrative or clinical observation notices (3.7s)
    ok 5 [desktop-1440] › tests\e2e\notifications.spec.ts:12:1 › opening the Pending tab marks the sign-up notification as read (5.4s)
    ok 6 [desktop-1440] › tests\e2e\notifications.spec.ts:20:1 › a role only sees its own notifications (3.5s)
    ok 7 [desktop-1440] › tests\e2e\notifications.spec.ts:26:1 › Veterinarian sees clinical alerts and does not see manager account requests (3.8s)
    ok 8 [desktop-1440] › tests\e2e\notifications.spec.ts:34:1 › Horse Owner does not receive staff administrative or clinical observation notices (3.7s)

    8 passed (36.4s)
  ```
- **Exit Code:** `0`

---

### 4. Frontend Typecheck & Lint

- **Command:** `npm run typecheck && npm run lint`
- **Exit Code:** `0` (TypeScript clean with exit code 0; ESLint exited with code 0 with pre-existing baseline React hook/effect warnings in existing health/stable/master-data pages outside TASK-008 scope, 0 errors)

---

### 5. Git Diff Cleanliness Check (`git diff --check`)

- **Backend:** `git diff --check` -> exit code 0
- **Frontend:** `git diff --check` -> exit code 0

---

### 6. Live NestJS API & PostgreSQL Database Verification

Executed direct verification against running NestJS (`http://localhost:3000/api`) and PostgreSQL:
1. **User Role Audit:**
   - Club Manager: `manager@gmail.com` (`f9e2460b-dbb4-4a23-9de4-2cd89b07fa7a`)
   - Owner 1: `owner@gmail.com` (`8808d50b-1ccb-478f-9771-5b40a7b274b1`)
   - Owner 2: `owner2@gmail.com` (`24ea7a85-e0af-4d3d-8c37-6e817ba09c9c`)
   - Groom 1: `groom@gmail.com` (`8d19fece-09f1-46a1-8830-0420a0b07ac6`)
   - Groom 2: `groom2@gmail.com` (`9b658309-faae-4636-9da7-f46ae0d21a6a`)

2. **Cross-Owner Isolation:**
   - Owner 1 notifications: 28 total
   - Owner 2 notifications: 17 total
   - Shared notification IDs between Owner 1 and Owner 2: **0**
   - Administrative notification types in Owner inboxes: **0**

3. **Live Account Mutation & Targeted Delivery:**
   - CM authenticated and executed `PUT /api/accounts/8d19fece-09f1-46a1-8830-0420a0b07ac6/permissions` with `{ permissions: { viewAudit: true } }`:
     - HTTP Status: `200 OK`
     - Response: `{"statusCode": 200, "success": true, "data": { "account": { "id": "8d19fece-09f1-46a1-8830-0420a0b07ac6", ... } } }`
     - Groom 1 notification count incremented by 1 (latest notification: `ACCOUNT_PERMISSIONS_CHANGED`, category `ACCOUNT`, title `"Quyền tài khoản được cập nhật"`).
     - Leaked to Owner 1: **0**
     - Leaked to Owner 2: **0**
     - Restored Groom 1 permissions cleanly.

4. **Supply Restock Delivery in Live DB:**
   - `RESTOCK_REQUEST_CREATED` delivered to Club Manager (`manager@gmail.com`).
   - `RESTOCK_APPROVED` and `RESTOCK_DELIVERED` delivered to requester Groom (`groom@gmail.com`).

---

## Step-by-Step Manual QA Guide

### Prerequisite Setup
1. Backend running on `http://localhost:3000` connected to PostgreSQL.
2. Frontend preview running on `http://localhost:4173`.

### Scenario 1: Reversible Account Permission Notification Delivery to Target Only
1. Open the browser and log in as Club Manager:
   - Email: `manager@gmail.com`
   - Password: `EquiFlow@2026`
2. Open Browser DevTools (F12) Console.
3. Execute the following reversible verification script:
   ```javascript
   (async () => {
     // Step 1: Login helper
     const login = async (email, password = 'EquiFlow@2026') => {
       const res = await fetch('http://localhost:3000/api/auth/login', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ email, password }),
       });
       return (await res.json()).data.accessToken;
     };

     const groomToken = await login('groom@gmail.com');
     const cmToken = await login('manager@gmail.com');
     const ownerToken = await login('owner@gmail.com');

     const targetGroomUserId = '8d19fece-09f1-46a1-8830-0420a0b07ac6';

     // Step 2: Read and preserve target's original permission value
     const groomProfile = await (await fetch(`http://localhost:3000/api/accounts/${targetGroomUserId}`, {
       headers: { Authorization: `Bearer ${cmToken}` },
     })).json();
     const originalValue = groomProfile.data?.permissions?.viewAudit ?? false;
     const targetValue = !originalValue;
     console.log('Original viewAudit permission:', originalValue, '-> mutating to:', targetValue);

     // Step 3: Perform actual value change as Club Manager
     const mutateRes = await fetch(`http://localhost:3000/api/accounts/${targetGroomUserId}/permissions`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cmToken}` },
       body: JSON.stringify({ permissions: { viewAudit: targetValue } }),
     });
     console.log('Mutation HTTP status:', mutateRes.status);
     if (!mutateRes.ok) throw new Error('Permission mutation failed');

     // Step 4: Correlate newly created notification in target (Groom) inbox
     const groomInbox = await (await fetch('http://localhost:3000/api/notifications', {
       headers: { Authorization: `Bearer ${groomToken}` },
     })).json();
     const newNotif = groomInbox.data?.notifications?.[0];
     console.log('Target inbox latest notification:', {
       id: newNotif?.id,
       type: newNotif?.type,
       category: newNotif?.category,
       title: newNotif?.title,
       createdAt: newNotif?.createdAt,
     });
     if (newNotif?.type !== 'ACCOUNT_PERMISSIONS_CHANGED') {
       throw new Error(`Expected ACCOUNT_PERMISSIONS_CHANGED, received: ${newNotif?.type}`);
     }

     // Step 5: Verify that exact new notification is absent from unrelated (Owner) inbox
     const ownerInbox = await (await fetch('http://localhost:3000/api/notifications', {
       headers: { Authorization: `Bearer ${ownerToken}` },
     })).json();
     const leaked = (ownerInbox.data?.notifications || []).some(n => n.id === newNotif.id);
     console.log('Leaked to Owner inbox:', leaked, '(Expected: false)');
     if (leaked) throw new Error('Scope leak: notification found in unrelated Owner inbox!');

     // Step 6: Restore target's original permission value
     const restoreRes = await fetch(`http://localhost:3000/api/accounts/${targetGroomUserId}/permissions`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cmToken}` },
       body: JSON.stringify({ permissions: { viewAudit: originalValue } }),
     });
     console.log('Restoration HTTP status:', restoreRes.status);
     console.log('Groom viewAudit permission successfully restored to original value:', originalValue);
   })();
   ```
4. Verify console logs:
   - `Original viewAudit permission: <orig> -> mutating to: <target>`
   - `Mutation HTTP status: 200`
   - `Target inbox latest notification: { id: ..., type: 'ACCOUNT_PERMISSIONS_CHANGED', ... }`
   - `Leaked to Owner inbox: false (Expected: false)`
   - `Restoration HTTP status: 200`
   - `Groom viewAudit permission successfully restored to original value: <orig>`

### Scenario 2: In-App UI Verification
1. Sign in as Groom (`groom@gmail.com` / `EquiFlow@2026`).
2. Click the bell / notification icon in the header or navigate to `/notifications`.
3. Verify that the notification `"Quyền tài khoản được cập nhật"` appears in the notification inbox.
4. Sign out and sign in as Horse Owner (`owner@gmail.com` / `EquiFlow@2026`).
5. Navigate to `/notifications`.
6. Verify that no account permission or administrative notices appear in the Owner's inbox.
