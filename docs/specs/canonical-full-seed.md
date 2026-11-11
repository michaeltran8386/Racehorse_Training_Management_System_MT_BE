# Specification: Canonical Full-Scope Seed & Deploy Startup Seeding

- **Status:** Approved (User confirmed `"Yes"` & `"2 và 3"` in `/interview-me` session)
- **Branch:** `chore/canonical-full-seed` (branched from `origin/dev`)
- **Target Repo:** `Racehorse_Training_Management_System_MT_BE`

---

## 1. Objective

Unify EquiFlow's database seeding onto **one canonical seed entry point** (`prisma/seed.ts`, `npm run db:seed`) with a rich, realistic, non-empty 6-month lifecycle dataset (**07/2026 – 12/2026**) covering **every single table (all 38 Prisma models)** and **every business state/enum**, while guaranteeing:

1. **Zero duplicate seed confusion:** Remove `prisma/seed-demo.ts` and `"db:seed:demo"` from `package.json`. Keep `prisma/seed-manual-qa.ts` intact solely for CI/migration-chain check Step 5b (`scripts/verify-migration-chain.cjs`).
2. **Idempotent + CI-safe + Production-safe:** `npm run db:seed` runs cleanly on any PostgreSQL `DATABASE_URL` (local Docker, Neon, Supabase, CI `racehorse_ci`) and can be executed multiple times without failing or wiping live user data. An explicit `--reset` flag (`npm run db:seed -- --reset`) truncates all 38 tables in FK-safe order before seeding for local resets.
3. **Auto-seed on `dev -> main` deployment (`Dockerfile`):** When deployed via Docker (`deploy/docker-compose.prod.yml` / PaaS), container startup syncs schema (`npx prisma db push --skip-generate`), checks if `User` count is `0` (fresh database), automatically runs `npm run db:seed` if empty, and starts `node dist/src/main`. Subsequent restarts/redeploys against a populated DB skip seeding automatically.

---

## 2. Commands & Startup Contracts

| Command | Behavior |
| :--- | :--- |
| `npm run db:seed` | Validates `DATABASE_URL`, runs deterministic idempotent `upsert` / `createMany({ skipDuplicates: true })` across all 38 Prisma models without deleting existing live records. Safe when run 1x or Nx (including CI job `2b`). |
| `npm run db:seed -- --reset` | Runs `clearFixtures(tx)` across all 38 models in FK-safe dependency order, then seeds the complete canonical dataset. |
| `npm run db:setup` | Executes `npx prisma db push && npm run db:seed`. |
| Docker container `CMD` | `npx prisma db push --skip-generate && node -e "..."` (checks `"User"` row count via `@prisma/client`; runs `npm run db:seed` iff count is `0`) `&& node dist/src/main`. |

### Environment Contract
- Reads `process.env.DATABASE_URL` directly (falling back to `.env` only when `!process.env.DATABASE_URL && existsSync('.env')`).
- No `localhost`-only or fixed DB-name restrictions (`equiflow_seed_demo` hardlock removed) so cloud PostgreSQL (Render/Railway/Neon/Supabase/CI) and standard local DB (`equiflow`) work seamlessly.
- `DIRECT_URL` continues to follow `prisma/schema.prisma`.

---

## 3. Dataset Coverage Across All 38 Prisma Models

### 3.1 Identity, Access & Accounts (`User`, `Counter`, `RefreshToken`, `ResetToken`, `GoogleIdentity`, `OtpCode`, `LoginAttempt`, `PermissionRequest`)
- **Shared Demo Password:** `EquiFlow@2026` (bcrypt hash) for ALL seeded accounts, including `vet2@gmail.com` (fixes previous `EquiFlow@2006` typo).
- **Staff & Owner Roster (`ACTIVE` accounts):**
  - `CLUB_MANAGER` (**2**): `manager@gmail.com` (Trần Quang Minh), `manager2@gmail.com` (Nguyễn Hải Đăng)
  - `HEAD_TRAINER` (**4**): `trainer@gmail.com` (Nguyễn Văn Tuấn), `trainer2@gmail.com` (Lê Hoàng Nam), `trainer3@gmail.com` (Phạm Quốc Trung), `trainer4@gmail.com` (Vũ Thành Long)
  - `VETERINARIAN` (**4** — exceeds `> 2` requirement): `vet@gmail.com` (BS. Phạm Minh Trí), `vet2@gmail.com` (BS. Nguyễn Thảo Vy), `vet3@gmail.com` (BS. Trần Đình Khôi), `vet4@gmail.com` (BS. Lê Phương Anh)
  - `GROOM` (**10** — exact user requirement): `groom@gmail.com` through `groom10@gmail.com` (all `ACTIVE`, distributed across all zones/shifts/tasks)
  - `HORSE_OWNER` (**6**): `owner@gmail.com` through `owner6@gmail.com`
- **All 7 `UserStatus` States Covered:** Additional lifecycle fixtures cover `PENDING_EMAIL`, `PENDING_APPROVAL`, `INVITED`, `INACTIVE`, `REJECTED`, `LOCKED` alongside `ACTIVE`.
- **Auth & Support Models Populated:**
  - `GoogleIdentity`: linked Google SSO fixture for `owner@gmail.com` & `trainer2@gmail.com`.
  - `OtpCode`: covering `OtpPurpose` (`SIGNUP`, `RESET`, `INVITE`).
  - `LoginAttempt`: historical failed + successful login records (including locked-account test trace).
  - `RefreshToken` & `ResetToken`: deterministic tokens (active + revoked/expired).
  - `PermissionRequest`: covering all 3 `PermissionRequestStatus` (`OPEN`, `GRANTED`, `DISMISSED`).
  - `Counter`: synced for `'horse_code'`, `'training_plan'`, `'request_code'`, `'forbidden_ref'` above max seeded sequence numbers so subsequent live API creates never collide.

### 3.2 Horse Catalogs, Stalls & Full Lifecycle (`HorseCatalogItem`, `StallZone`, `Stall`, `Horse`, `StallAllocation`)
- **`HorseCatalogItem`:**
  - `BREED` (**8 active** + **1 inactive** = 9 total): `Thoroughbred`, `Arabian`, `Arabian Cross`, `Quarter Horse`, `Warmblood`, `Standardbred`, `Appaloosa`, `Paint`, plus inactive `Morgan` (`isActive: false`) for admin catalog toggle coverage.
  - `COLOR` (**8 active**): `Bay`, `Bay Dark`, `Chestnut`, `Black`, `Grey`, `Gray Roaming`, `Roan`, `Palomino`.
- **`StallZone` & `Stall` (4 Zones, 32 Stalls, grid bounds 1..4 x 1..4 respected):**
  - Zone `A` — `Khu Chuồng A - Đua Chính` (`3x4` = 12 stalls: `STALL-A01..A12`)
  - Zone `B` — `Khu Chuồng B - Huấn Luyện` (`3x4` = 12 stalls: `STALL-B01..B12`)
  - Zone `C` — `Khu Cách Ly Y Tế` (`2x2` = 4 stalls: `STALL-C01..C04`)
  - Zone `H` — `Khu Lưu Giữ Nợ Phí` (`2x2` = 4 stalls: `STALL-H01..H04`)
  - All 4 `StallStatus` covered: `OCCUPIED`, `AVAILABLE`, `MAINTENANCE`, `INACTIVE`.
- **`Horse` (18 horses spanning all 8 active breeds, valid genders `['Stallion', 'Mare', 'Gelding']`, and all 7 `HorseStatus` values):**
  - `ACTIVE` / `IN_TRAINING` / `UNDER_OBSERVATION` / `INJURED` / `ISOLATED` / `RESTING` / `RETIRED`.
  - **BR-STL-07 Compliance:** `RETIRED` horses cover distinct `RetireReason` values (`RETIRED`, `SOLD`, `TRANSFERRED`, `DECEASED`) and have released `StallAllocation` (`isActive: false`, explicit `endDate`), leaving their former stalls `AVAILABLE` and excluding retired horses from daily care task generation.

### 3.3 Training & Simulator (`TrainingPlan`, `WorkoutSession`, `SimulatorSession`)
- Continuous 6-month history (`2026-07` -> today + upcoming week) ensuring ACWR analytics and 4+ completed workouts in 30 days are valid for active race horses.
- All `PlanStatus` (`DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED`) and all `WorkoutStatus` (`SCHEDULED`, `COMPLETED`, `BLOCKED`, `MISSED`, `CANCELLED`).
- Training phase speeds conform to `create-training-plan.dto.ts` (`>= 5`) and workout `targetSpeedKmh` conforms to `create-workout-session.dto.ts` (`10..70` or `undefined` for `WALK`/`SWIM`/`RECOVERY`), avoiding broken FE edit modals.
- Telemetry results on completed `WorkoutSession` rows: realistic distance 50..10000m, duration, peak HR 60..260, recovery HR 25..200, and abnormal-signs alert sample (`abnormalSigns: true`, `abnormalSignTypes`).
- `SimulatorSession`: multiple sessions spanning `SimulatorSessionType` (`WORKOUT`, `RACE`, `EXAM`) and `SimulatorSessionStatus` (`PENDING`, `RUNNING`, `COMPLETED`, `ABORTED_INJURY`).

### 3.4 Medical & Preventive Care (`MedicalRecord`, `InjuryLog`, `MedicalLock`, `PreventiveTypeCatalog`, `PreventiveSchedule`)
- **PR #153 Rule Respected:** At most **1 `OPEN` `MedicalRecord` per horse**.
- Multiple `CLOSED` and `DRAFT` historical medical records + active `OPEN` clinical cases (e.g., `Xích Thố`, plus injured/isolated/under-observation horses).
- `InjuryLog`: covering `BodySide` (`LEFT`, `RIGHT`, `BILATERAL`), `SeverityLevel` (`MILD`, `MODERATE`, `SEVERE`, `CRITICAL`), `InjuryStatus` (`ACTIVE`, `HEALING`, `RESOLVED`) with 2D injury map coordinates.
- `MedicalLock`: both active (`isLocked: true`) and unlocked historical locks with linked heavy-workout `BLOCKED` trace.
- `PreventiveTypeCatalog`: all **4 `PreventiveType`** values (`VACCINATION`, `DEWORMING`, `FARRIER_HOOF_CARE`, `DENTAL`).
- `PreventiveSchedule`: spanning all 3 `PreventiveStatus` (`COMPLETED`, `PENDING`, `OVERDUE`).

### 3.5 Nutrition, Stable Care, Shifts & Supply Inventory (`NutritionPlan`, `ShiftCatalog`, `ShiftRoster`, `DailyCareTask`, `DailyGroomingLog`, `SupplyCatalog`, `StockBalance`, `RestockRequest`, `IncidentReport`)
- `NutritionPlan`: all 5 `NutritionPlanStatus` (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ARCHIVED`) using `MealDto`-compatible `mealsJson` linked to `SupplyCatalog` items.
- `ShiftCatalog`: 3 shifts (`MORNING`, `AFTERNOON`, `NIGHT`).
- `ShiftRoster`: schedules **all 10 Grooms** across a 7-day rolling window (yesterday, today, +5 days) covering every zone.
- `DailyCareTask` & `DailyGroomingLog`: generated via `planDailyTasks(...)` for non-retired horses across all 7 `DailyTaskType` (`FEEDING`, `CLEANING`, `GROOMING`, `ICE_BOOT_REST`, `WALKING`, `MEDICATION`, `OTHER`) plus `DailyGroomingLog` logs across `MORNING`/`AFTERNOON`/`EVENING`.
- `SupplyCatalog` & `StockBalance`: all 7 `SupplyCategory` values, mix of sufficient and low-stock items.
- `RestockRequest`: all 5 `RestockStatus` (`PENDING`, `APPROVED`, `DELIVERING`, `DELIVERED`, `REJECTED`).
- `IncidentReport`: all 4 `IncidentStatus` (`REPORTED`, `UNDER_REVIEW`, `RESOLVED`, `DISMISSED`).

### 3.6 Tournaments, Racing & Settlement (`Tournament`, `TournamentRegistration`, `TournamentResult`)
- All 5 `TournamentStatus`: `COMPLETED`, `CLOSED_REGISTRATION`, `OPEN_REGISTRATION`, `UPCOMING`, `CANCELLED`.
- All 4 `RegistrationStatus`: `REGISTERED`, `CONFIRMED`, `SCRATCHED_MEDICAL`, `DISQUALIFIED`.
- `TournamentResult`: podium placements with **85% Owner / 10% Club / 5% Trainer** prize settlement breakdown matching `FinancialInvoice` credits.

### 3.7 Financial Invoices (`FinancialInvoice`)
- Continuous 6-month billing (`2026-07` through `2026-12`), covering all 5 `InvoiceStatus` (`DRAFT`, `SENT`, `PAID`, `OVERDUE`, `CANCELLED`).
- Boarding fee calculations reuse `calculateBoardingFee` / `BOARDING_MONTHLY_RATE` from `src/financial/boarding-fee.ts`.
- Horse `isDebtImpounded` and Owner `isBadDebtFlagged` reflect overdue debt consistently.

### 3.8 AI Insights, Owner AI Chat, Notifications & Audit (`AIInsight`, `OwnerAiMessage`, `Notification`, `AuditLog`)
- `AIInsight`: covering `InsightType` and `InsightStatus` (`GENERATED`, `ACKNOWLEDGED`, `APPLIED`, `DISMISSED`) with structured telemetry payloads.
- `OwnerAiMessage`: deterministic UUIDs (fixing prior `createMany` duplicate risk), referencing actual seeded horse names such as `Bạch Long Mã` (no stale `"Thunder"` placeholder).
- `Notification`: covering all 7 `NotificationCategory` values across Trainer, Vet, Groom, Owner, Manager accounts.
- `AuditLog`: key operational trails (auth, stall updates, medical lock, invoice transitions, catalog changes).

---

## 4. Verification & Acceptance Criteria

1. `Racehorse_Training_Management_System_MT_BE/prisma/seed-demo.ts` deleted; `"db:seed:demo"` absent from `package.json`.
2. `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build` pass with zero errors/warnings.
3. Against running PostgreSQL:
   - `npx prisma db push --skip-generate` succeeds cleanly.
   - `npm run db:seed` #1 succeeds cleanly and populates **all 38 Prisma models** with `> 0` rows (`Prisma.dmmf.datamodel.models.length === 38`).
   - `npm run db:seed` #2 (idempotency check mirroring CI stage `2b`) exits `0` without errors or duplicating seeded records.
   - `npm run db:seed -- --reset` clears and re-seeds cleanly.
   - `npx ts-node test/seed-lifecycle.check.ts` passes all assertions: `>= 10` active Grooms, `>= 3` active Vets, `>= 8` active Breeds, `>= 18` Horses, all `UserStatus`/`HorseStatus`/`StallStatus`/`InvoiceStatus`/`TournamentStatus`/`PreventiveType` covered, `RETIRED` horses not occupying stalls, zero >1 `OPEN` medical record per horse, and matching boarding-fee/debt invariants.
4. `Dockerfile` contains automatic empty-DB seed logic before starting `node dist/src/main`.
5. `acc.md` and `README.md` accurately match seeded accounts, passwords (`EquiFlow@2026`), horse roster, and `npm run db:seed` commands.
