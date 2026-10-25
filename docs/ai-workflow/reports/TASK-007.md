# TASK-007 — Execution Report

- **Plan version:** v1-approved-r10
- **Status:** DONE (Approved 2026-10-25)
- **Git branch / starting revision / ending revision:**
  - Backend: `main` / starting: `b9b1bbf` / ending: working tree (`src/accounts/me.service.spec.ts`, `src/horses/horses.service.spec.ts`, `src/financial/financial.service.spec.ts`, `src/tournaments/tournaments.controller.ts`, `src/tournaments/tournaments.service.ts`, `src/tournaments/tournaments.service.spec.ts`)
  - Frontend: `main` / starting: `243c280` / ending: working tree (`tests/e2e/rbac-matrix.spec.ts`)
- **Files Changed & Why (strictly the 7 authorized files per CR-011):**
  1. `Racehorse_Training_Management_System_MT_BE/src/accounts/me.service.spec.ts`:
     - Added unit tests for `updateProfile`: verifies successful update of `fullName` and `phone`, audit log recording, invalid input validation, and verifies that any attempted `role` or `permissions` mutations are ignored/rejected.
     - Added unit tests for `updateNotification`: verifies toggle of editable notifications, 409 Conflict rejection for locked notification (`thresholdAlert`), and 400 Bad Request for unknown notification keys.
  2. `Racehorse_Training_Management_System_MT_BE/src/horses/horses.service.spec.ts`:
     - Added unit test suite for `findAll - ownership scope`: verifies that when caller role is `HORSE_OWNER`, query is automatically constrained with `where.ownerId = user.userId`.
     - Added unit test suite for `findOne - ownership isolation`: verifies that owned horse returns full horse entity, while foreign horse ID throws 404 NOT_FOUND with anti-enumeration message `Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.` without data leakage.
  3. `Racehorse_Training_Management_System_MT_BE/src/financial/financial.service.spec.ts`:
     - Added unit test verifying that when a `HORSE_OWNER` calls `findAll`, any supplied query filter `ownerId` is overridden and forced to the caller's own user ID.
  4. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.controller.ts`:
     - Updated `findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload)` to accept the authenticated caller and forward `user` to `this.tournamentsService.findOne(id, user)`.
  5. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.ts`:
     - Updated `findOne(id: string, user: CurrentUserPayload)` to require a mandatory `user: CurrentUserPayload` (removed optional user, removed `(user as any)?.id` fallback, removed `ownerId || '__NONE__'`, and removed any unauthenticated/full-access service paths).
     - Implemented Prisma query-level scoping: when `user.role === UserRole.HORSE_OWNER`, `registrations` is constrained with `where: { horse: { ownerId: user.userId } }`. This guarantees zero foreign registrations, zero foreign race results, and zero foreign owner identities (ID, full name, email) are loaded or returned across the wire.
     - For non-owner roles (`CLUB_MANAGER`, `HEAD_TRAINER`), full tournament participant lists continue to be returned without restriction.
     - Internal helper calls from staff actions (`recordResults` upon lock and `lockRaceResults`) pass the staff actor's `CurrentUserPayload` to `findOne`.
  6. `Racehorse_Training_Management_System_MT_BE/src/tournaments/tournaments.service.spec.ts`:
     - Updated the two existing unit tests in `describe('findOne')` that called `findOne` without an actor to pass an explicit staff `CurrentUserPayload` (`staffUser`).
     - Added unit test suite `describe('findOne - ownership scoping & PII protection (CR-011 / TASK-007)')` asserting:
       a) Prisma query receives `{ horse: { ownerId: 'owner-1' } }` when caller is `HORSE_OWNER`, returning only owned registrations and results while omitting foreign registrations and foreign owner PII.
       b) Staff callers (`CLUB_MANAGER`) receive all tournament registrations without restriction.
       c) Missing tournament throws 404 NOT_FOUND.
  7. `Racehorse_Training_Management_System_MT_FE/tests/e2e/rbac-matrix.spec.ts`:
     - Updated Playwright test `Horse Owner sees only owned horses on /my-horses and foreign horse details return 404 without leakage` to use the real seeded Owner 2 horse ID (`d2b6aac3-c3f8-4ee7-83f7-d7c7d260347b`), replacing the mock path `/horses/horse-1`.
     - Removed trailing blank lines at EOF, passing `git diff --check`.

---

## Acceptance Criteria Checklist (TASK-007)

- [x] **AC-1:** Horse Owner ownership isolation across domain entities:
  - `GET /horses` returns only owned horses (Owner 1 sees 8 owned horses, 0 foreign; Owner 2 sees 8 owned horses, 0 foreign).
  - `GET /horses/:id` for foreign horse returns HTTP 404 Not Found with anti-enumeration message without data leakage.
  - `GET /invoices` returns only invoices for owned horses. Query filter `ownerId` override attempts are forced to caller's own ID.
  - `GET /invoices/:id` for foreign invoice returns HTTP 403 Forbidden.
  - `GET /tournaments/:id` enforces query-level scoping via `findOne(id: string, user: CurrentUserPayload)`: when called by `HORSE_OWNER`, Prisma executes `registrations: { where: { horse: { ownerId: user.userId } } }`. Exactly 0 foreign registrations, 0 foreign race results, and 0 foreign owner identities (ID, full name, email) are returned. Tournament metadata remains accessible. Non-owner staff (`CLUB_MANAGER`) retain complete participant lists. Unauthenticated requests return HTTP 401 Unauthorized.
- [x] **AC-2:** Self-Profile boundary & contact details:
  - Contact details (`fullName`, `phone`) can be updated via `PUT /me/profile` (HTTP 200 OK).
  - Password change endpoint enforces current password verification and lockout policies.
  - Notification preferences: editable notifications (`dailyDigest`, `trainingReminders`, `healthAlerts`) toggle cleanly (HTTP 200 OK); locked notifications (`thresholdAlert`) are rejected with HTTP 409 Conflict (`LOCKED`).
- [x] **AC-3:** Direct self-permission editing prevention:
  - Direct account permission mutations (`PUT /accounts/:id/permissions`) are restricted to `manageAccounts` (`CLUB_MANAGER`) and return HTTP 403 Forbidden for Horse Owner.
  - Sneaking `role` or `permissions` payloads into `PUT /me/profile` is blocked by ValidationPipe (HTTP 400 Bad Request: `property role should not exist`, `property permissions should not exist`) and ignored by service.
  - In frontend UI, direct permission toggles are absent; visiting restricted administrative routes displays client-side 403 page with request-only "Request the permission" button.
- [x] **AC-4:** Full automated test verification:
  - Backend Jest unit tests: 117/117 passed across me, horses, financial, and tournaments services.
  - Frontend Playwright E2E tests: 6/6 passed across desktop-1280 and desktop-1440 projects against real seeded horse ID `d2b6aac3-c3f8-4ee7-83f7-d7c7d260347b`.
  - Backend & Frontend lint and typecheck: Backend clean with 0 errors and 0 warnings; Frontend clean with 0 errors (existing baseline warnings only).
  - `git diff --check` passed in both Backend and Frontend repositories with exit code 0.
- [x] **AC-5:** Live server real-stack verification:
  - Executed three-actor cross-isolation, tournament race-data scoping, filter override immunity, profile update, notification locking, and permission sneak prevention against live NestJS (`http://localhost:3000/api`) and PostgreSQL.

---

## Verification Evidence

### 1. Backend Unit Tests (`npm test -- src/accounts/me.service.spec.ts src/horses/horses.service.spec.ts src/financial/financial.service.spec.ts src/tournaments/tournaments.service.spec.ts`)

- **Command:** `npm test -- src/accounts/me.service.spec.ts src/horses/horses.service.spec.ts src/financial/financial.service.spec.ts src/tournaments/tournaments.service.spec.ts`
- **Output:**
  ```
  PASS src/financial/financial.service.spec.ts (5.665 s)
  PASS src/horses/horses.service.spec.ts (5.853 s)
  PASS src/accounts/me.service.spec.ts (6.402 s)
  PASS src/tournaments/tournaments.service.spec.ts (9.304 s)

  Test Suites: 4 passed, 4 total
  Tests:       117 passed, 117 total
  Snapshots:   0 total
  Time:        10.237 s
  Ran all test suites matching /src\accounts\me.service.spec.ts|src\horses\horses.service.spec.ts|src\financial\financial.service.spec.ts|src\tournaments\tournaments.service.spec.ts/i.
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

### 3. Frontend Typecheck & Lint

- **Command:** `npm run typecheck`
- **Output:**
  ```
  > equiflow-web@0.1.0 typecheck
  > tsc --noEmit
  ```
- **Exit Code:** `0`

- **Command:** `npm run lint`
- **Output:** `oxlint` exited with code 0 (0 errors; reports pre-existing baseline warnings on existing components only).

---

### 4. Frontend Playwright E2E Tests (`npx playwright test tests/e2e/rbac-matrix.spec.ts -g "TASK-007"`)

- **Command:** `npx playwright test tests/e2e/rbac-matrix.spec.ts -g "TASK-007"`
- **Output:**
  ```
  Running 6 tests using 1 worker

    ok 1 [desktop-1280] › tests\e2e\rbac-matrix.spec.ts:319:1 › TASK-007: Horse Owner sees only owned horses on /my-horses and foreign horse details return 404 without leakage (4.5s)
    ok 2 [desktop-1280] › tests\e2e\rbac-matrix.spec.ts:340:1 › TASK-007: Horse Owner sees only owned financial reports and cannot generate invoices (4.3s)
    ok 3 [desktop-1280] › tests\e2e\rbac-matrix.spec.ts:357:1 › TASK-007: Horse Owner self-profile allows contact updates but prevents direct self-permission editing (6.3s)
    ok 4 [desktop-1440] › tests\e2e\rbac-matrix.spec.ts:319:1 › TASK-007: Horse Owner sees only owned horses on /my-horses and foreign horse details return 404 without leakage (5.3s)
    ok 5 [desktop-1440] › tests\e2e\rbac-matrix.spec.ts:340:1 › TASK-007: Horse Owner sees only owned financial reports and cannot generate invoices (4.2s)
    ok 6 [desktop-1440] › tests\e2e\rbac-matrix.spec.ts:357:1 › TASK-007: Horse Owner self-profile allows contact updates but prevents direct self-permission editing (5.2s)

    6 passed (32.7s)
  ```
- **Exit Code:** `0`

---

### 5. Git Diff Formatting Check (`git diff --check`)

- **Command:** `git diff --check` in `Racehorse_Training_Management_System_MT_BE`
- **Output:** Exit Code `0` (clean, no trailing whitespace or CRLF formatting violations).
- **Command:** `git diff --check` in `Racehorse_Training_Management_System_MT_FE`
- **Output:** Exit Code `0` (clean, zero trailing blank lines at EOF).

---

### 6. Live Server Real-Stack Verification (Direct Three-Actor Matrix on NestJS + PostgreSQL)

- **Target:** Live NestJS API (`http://localhost:3000/api`) with PostgreSQL
- **Method:** Direct authenticated HTTP requests against live NestJS API endpoints using JWT access tokens for Owner 1 (`owner@gmail.com`), Owner 2 (`owner2@gmail.com`), and Club Manager (`manager@gmail.com`).
- **Evidence Output:**
  ```
  1. Logging in as Owner 1 and Owner 2...
  -> Tokens acquired successfully.

  2. Testing GET /horses scoping:
  Owner 1 sees 8 horses: [
    'Apollo Chariot',
    'Bucephalus Brave',
    'Crimson Flash',
    'Golden Eclipse',
    'Midnight Mirage',
    'Pegasus Dream',
    'Starlight Express',
    'Thunderbolt Swift'
  ]
  Does Owner 1 see Ironclad Titan (Owner 2's horse)? false
  Owner 2 sees 8 horses: [
    'Desert Mirage',
    'Ironclad Titan',
    'Northern Dancer Legacy',
    'Ocean Breeze',
    'Red Velvet',
    'Shadowfax Wonder',
    'Storm Runner',
    'Test Victory 2562'
  ]
  Does Owner 2 see Thunderbolt Swift (Owner 1's horse)? false

  3. Testing Cross-Access GET /horses/:id:
  Owner 1 accessing Owner 2 horse status: 404
  Response body: {
    statusCode: 404,
    success: false,
    error: 'Not Found',
    code: 'HORSE_NOT_FOUND',
    message: 'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
    data: {},
    timestamp: '2026-10-25T09:14:26.078Z',
    path: '/api/horses/d2b6aac3-c3f8-4ee7-83f7-d7c7d260347b',
    method: 'GET'
  }
  Owner 2 accessing Owner 1 horse status: 404

  4. Testing GET /invoices scoping:
  Owner 1 sees 6 invoices. Owner IDs: [ '8808d50b-1ccb-478f-9771-5b40a7b274b1' ]
  Owner 1 querying Owner 2 ownerId sees: 6 invoices. Owner IDs: [ '8808d50b-1ccb-478f-9771-5b40a7b274b1' ]

  5. Testing Cross-Access GET /invoices/:id:
  Owner 1 accessing Owner 2 invoice status: 403
  Response body: {
    statusCode: 403,
    success: false,
    error: 'Forbidden',
    code: 'FORBIDDEN',
    message: 'You can only view financial statements for your own horses.',
    data: {},
    timestamp: '2026-10-25T09:14:26.132Z',
    path: '/api/invoices/e9385349-dac6-4585-8509-2d8999beb9d3',
    method: 'GET'
  }

  6. Testing Direct Permission Edit Prevention:
  Owner 1 attempting PUT /accounts/.../permissions status: 403
  Owner 1 attempting to sneak role/permissions via /me/profile status: 400
  Sneak attempt rejected with 400 response: {
    statusCode: 400,
    success: false,
    error: 'Bad Request',
    code: 'VALIDATION',
    message: [
      'property role should not exist',
      'property permissions should not exist'
    ],
    data: {},
    timestamp: '2026-10-25T09:14:26.143Z',
    path: '/api/me/profile',
    method: 'PUT'
  }
  Valid profile update status: 200
  Updated user name: Robert Sterling, role: HORSE_OWNER

  7. Testing Notification toggle:
  Toggling dailyDigest status: 200
  Toggling locked thresholdAlert status: 409
  Locked response body: {
    statusCode: 409,
    success: false,
    error: 'Conflict',
    code: 'LOCKED',
    message: 'This notification cannot be changed',
    data: {},
    timestamp: '2026-10-25T09:14:26.172Z',
    path: '/api/me/notifications',
    method: 'PUT'
  }

  8. Inspecting GET /tournaments/:id for race data scoping (CR-011):
  Checking tournament Verification Target Tournament 2026 (7a93eb39-47a0-40ec-9505-95b4df501427), status: OPEN_REGISTRATION
  Owner 1 receives 4 registrations (all owned by Owner 1):
   - Horse: Pegasus Dream, ownerId: 8808d50b-1ccb-478f-9771-5b40a7b274b1, ownerEmail: owner@gmail.com
   - Horse: Thunderbolt Swift, ownerId: 8808d50b-1ccb-478f-9771-5b40a7b274b1, ownerEmail: owner@gmail.com
   - Horse: Golden Eclipse, ownerId: 8808d50b-1ccb-478f-9771-5b40a7b274b1, ownerEmail: owner@gmail.com
   - Horse: Apollo Chariot, ownerId: 8808d50b-1ccb-478f-9771-5b40a7b274b1, ownerEmail: owner@gmail.com
  Foreign registrations returned for Owner 1: 0
  Foreign owner PII returned for Owner 1: 0

  Owner 2 receives 2 registrations (all owned by Owner 2):
   - Horse: Red Velvet, ownerId: 24ea7a85-e0af-4d3d-8c37-6e817ba09c9c, ownerEmail: owner2@gmail.com
   - Horse: Storm Runner, ownerId: 24ea7a85-e0af-4d3d-8c37-6e817ba09c9c, ownerEmail: owner2@gmail.com
  Foreign registrations returned for Owner 2: 0
  Foreign owner PII returned for Owner 2: 0

  Club Manager receives 6 registrations (complete participant list without filter):
   - Horse: Red Velvet, ownerEmail: owner2@gmail.com
   - Horse: Pegasus Dream, ownerEmail: owner@gmail.com
   - Horse: Thunderbolt Swift, ownerEmail: owner@gmail.com
   - Horse: Golden Eclipse, ownerEmail: owner@gmail.com
   - Horse: Storm Runner, ownerEmail: owner2@gmail.com
   - Horse: Apollo Chariot, ownerEmail: owner@gmail.com

  9. Testing Unauthenticated Request:
  GET /api/tournaments/7a93eb39-47a0-40ec-9505-95b4df501427 without auth token:
  HTTP 401 Unauthorized, code: UNAUTHENTICATED
  ```

---

## Manual QA Verification Steps for the Human Reviewer

All manual QA steps are performed directly against the real running NestJS API (`http://localhost:3000/api`) and PostgreSQL database.

### Step 1: Verify Horse Owner Scoped Horse List & Foreign Horse 404 in UI
1. Open the frontend in browser: `http://localhost:5173`.
2. Sign in as Horse Owner 1 (`owner@gmail.com` / `EquiFlow@2026`).
3. In the sidebar under **HORSES**, click **My Horses** (`/my-horses`).
4. Verify:
   - Only horses owned by Owner 1 (e.g. *Thunderbolt Swift*, *Apollo Chariot*) are listed.
   - Horses owned by Owner 2 (e.g. *Ironclad Titan*) do NOT appear in the list or search results.
5. In the browser address bar, enter the ID of Owner 2's horse directly (`http://localhost:5173/horses/d2b6aac3-c3f8-4ee7-83f7-d7c7d260347b`):
6. Verify:
   - Access is rejected with a 404 page ("Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem." / "Horse profile not found").
   - No sensitive horse details, pedigree, or workout history are leaked.

### Step 2: Verify Tournament Race-Data Ownership Scoping & Zero Foreign PII (Authenticated DevTools Console)

*Note: The frontend router currently serves `/races` and `/races/results` for race management, and does not provide an interactive tournament-detail participant page for Horse Owners. Scoping of the `GET /api/tournaments/:id` endpoint is verified directly via authenticated browser DevTools against real NestJS and PostgreSQL.*

1. Sign in as Horse Owner 1 (`owner@gmail.com` / `EquiFlow@2026`) at `http://localhost:5173`.
2. Open Browser DevTools (press `F12`) and select the **Console** tab.
3. Paste and run the following script:
   ```javascript
   (async () => {
     const rawTokens =
       localStorage.getItem("equiflow.tokens") ??
       sessionStorage.getItem("equiflow.tokens");

     if (!rawTokens) throw new Error("No EquiFlow token pair found");

     const { accessToken } = JSON.parse(rawTokens);
     const response = await fetch(
       "http://localhost:3000/api/tournaments/7a93eb39-47a0-40ec-9505-95b4df501427",
       { headers: { Authorization: `Bearer ${accessToken}` } }
     );

     const body = await response.json();
     const registrations = body?.data?.registrations;

     if (!Array.isArray(registrations)) {
       throw new Error(`Unexpected response: ${JSON.stringify(body)}`);
     }

     console.log("Status:", response.status);
     console.log("Registration count:", registrations.length);
     console.table(
       registrations.map(({ horse }) => ({
         horse: horse.name,
         ownerId: horse.ownerId,
         ownerEmail: horse.owner?.email,
       }))
     );
   })();
   ```
4. Verify:
   - Status is `200`.
   - `Registration count:` is `4`.
   - Table shows only horses owned by `owner@gmail.com` (*Pegasus Dream*, *Thunderbolt Swift*, *Golden Eclipse*, *Apollo Chariot*).
   - Zero registrations or emails for Owner 2 (`owner2@gmail.com`) are present.
5. Sign out, and sign in as Horse Owner 2 (`owner2@gmail.com` / `EquiFlow@2026`).
6. Run the same console script.
7. Verify:
   - Status is `200`.
   - `Registration count:` is `2`.
   - Table shows only horses owned by `owner2@gmail.com` (*Red Velvet*, *Storm Runner*). Zero registrations from Owner 1 are returned.
8. Sign out, and sign in as Club Manager (`manager@gmail.com` / `EquiFlow@2026`).
9. Run the same console script.
10. Verify:
    - Status is `200`.
    - `Registration count:` is `6` (all registrations are returned for staff).

### Step 3: Verify Financial Reports Scoping & Invoice Generation Block
1. Sign in as Horse Owner (`owner@gmail.com`), click **Financial Reports** (`/financial-reports`).
2. Verify:
   - Only invoices and training fee statements belonging to Owner 1 are shown.
   - The **+ Generate Monthly Invoices** button is **NOT** present (restricted to Club Manager).

### Step 4: Verify Profile Contact Updating & Read-Only Role/Permissions
1. In the sidebar under **OTHER**, click **My Profile** (`/profile`).
2. Verify:
   - "Personal details" section shows the user's role as **Horse Owner** and email as **owner@gmail.com** (both inputs are disabled/read-only).
   - "Permissions" badge/list is displayed without direct toggles/checkboxes.
3. Edit the Full Name field to `Robert Sterling` and Phone to `0901234567`, then click **Save details**.
4. Verify:
   - A success notification appears.
   - Refresh the page to confirm that the updated contact details persist.

### Step 5: Verify Direct Permission Navigation Block & Request-Only Workflow
1. While logged in as Horse Owner, enter the administration URL in browser address bar: `http://localhost:5173/accounts`.
2. Verify:
   - Access is blocked with client-side **403 · ACCESS DENIED** page (*"This screen is not part of your permissions"*).
   - The page includes a **Request the permission** ("Xin cấp quyền") button, confirming that permission elevation is request-only and cannot be applied directly by the owner.
3. Enter `http://localhost:5173/accounts/seed-owner/permissions`.
4. Verify:
   - Access is blocked with **403 · ACCESS DENIED**.
