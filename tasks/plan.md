# Implementation Plan: Canonical Full-Scope Seed & Deploy Auto-Seed

**Spec:** [canonical-full-seed.md](../docs/specs/canonical-full-seed.md)

## Strategy

Preserve the deterministic UUID helper (`id(tag)`), real relative dates around `now`, shared helper imports (`calculateBoardingFee`, `planDailyTasks`, `clubDate`, `yymm`), and clean modular structure of `prisma/seed.ts` while upgrading it into a single idempotent, environment-agnostic seed covering all 38 Prisma models and rich counts.

### Phase 1: Cleanup Legacy Seed Split
1. Delete `prisma/seed-demo.ts`.
2. Remove `"db:seed:demo"` from `package.json`.
3. Update `Dockerfile` startup `CMD` so fresh empty DBs (`"User"` count = 0) auto-run `npm run db:seed` after `npx prisma db push --skip-generate` and before `node dist/src/main`.

### Phase 2: Canonical Idempotent `prisma/seed.ts`
1. **DB Connection & Reset Flag:**
   - Replace `demoDatabase()` localhost-only restriction with `resolveDatabaseUrl()`: loads `.env` if needed, validates `DATABASE_URL` exists without rejecting non-localhost hosts or custom DB names.
   - Parse `--reset` (`process.argv.includes('--reset')`):
     - When `--reset` is passed: run `clearFixtures(tx)` across all 38 models in FK-safe order, then insert/upsert seed data.
     - Default (`npm run db:seed`): idempotent `upsert` / `createMany({ skipDuplicates: true })` (plus deterministic IDs everywhere, including `OwnerAiMessage`, `GoogleIdentity`, `OtpCode`, `LoginAttempt`, `ResetToken`, `RefreshToken`, `PermissionRequest`), preserving existing live/user data on populated DBs and succeeding on repeat runs (`CI 2b`).
2. **Module Expansion in `seed.ts`:**
   - `seedClub`: 2 `CLUB_MANAGER`, 4 `HEAD_TRAINER`, 4 `VETERINARIAN` (all password `EquiFlow@2026`), 10 active `GROOM`, 6 `HORSE_OWNER`, plus 6 extra lifecycle users covering `PENDING_EMAIL`, `PENDING_APPROVAL`, `INVITED`, `INACTIVE`, `REJECTED`, `LOCKED`; 8 active + 1 inactive `BREED`; 8 active `COLOR`; 4 `StallZone` / 32 `Stall` (`OCCUPIED`, `AVAILABLE`, `MAINTENANCE`, `INACTIVE`); 18 `Horse` spanning all 8 breeds & all 7 `HorseStatus` (`RETIRED` released from stalls per `BR-STL-07`); `StallAllocation`; `GoogleIdentity`; `OtpCode`; `LoginAttempt`; `PermissionRequest`; `RefreshToken`; `ResetToken`.
   - `seedTraining`: 6-month continuous `TrainingPlan` (`DRAFT`/`ACTIVE`/`COMPLETED`/`CANCELLED`), `WorkoutSession` (no invalid `RECOVERY` speed `< 10` on editable workouts, all 5 `WorkoutStatus`, inline telemetry + abnormal-sign sample), `SimulatorSession` (`WORKOUT`/`RACE`/`EXAM`).
   - `seedMedical`: max 1 `OPEN` `MedicalRecord` per horse (PR #153), historical `CLOSED` & `DRAFT` records, `InjuryLog` (2D coordinates, all `SeverityLevel`/`InjuryStatus`/`BodySide`), `MedicalLock` (locked + unlocked), `PreventiveTypeCatalog` (all 4 `PreventiveType` incl. `FARRIER_HOOF_CARE`), `PreventiveSchedule` (`COMPLETED`/`PENDING`/`OVERDUE`).
   - `seedStableCare`: `SupplyCatalog` (all 7 categories), `StockBalance` (sufficient/low), `NutritionPlan` (all 5 statuses, `MealDto`-compliant `mealsJson`), `ShiftCatalog` (3 shifts), `ShiftRoster` (all 10 Grooms scheduled across 7 days), `DailyCareTask` (via `planDailyTasks`, excluding `RETIRED` horses, covering all 7 `DailyTaskType`), `DailyGroomingLog`, `RestockRequest` (all 5 statuses), `IncidentReport` (all 4 statuses).
   - `seedRacingAndInvoices`: `Tournament` (all 5 statuses), `TournamentRegistration` (all 4 statuses), `TournamentResult` (85/10/5 settlement), 6-month `FinancialInvoice` (`2026-07..2026-12`, all 5 statuses, exact `calculateBoardingFee` & overdue debt sync).
   - `seedActivityAndSupport`: `AIInsight`, `OwnerAiMessage` (deterministic IDs, clean seeded horse names), `Notification` (all 7 categories), `AuditLog`, and `Counter` synchronization (`horse_code`, `training_plan`, `request_code`, `forbidden_ref`).

### Phase 3: Verification Script & Docs Sync
1. Update `test/seed-lifecycle.check.ts` to remove localhost restriction, validate `Prisma.dmmf.datamodel.models.length` (38 models) dynamically, and assert all new counts, enum coverages, PR #153 unique open medical record rule, and `BR-STL-07` retired-horse stall release invariant.
2. Update `acc.md` and `README.md` with accurate account roster (`EquiFlow@2026`), breeds, counts, and canonical `npm run db:seed` / `--reset` documentation.
3. Run static gates (`lint`, `typecheck`, `test:unit`, `build`) and live PostgreSQL verification (`db push`, double `npm run db:seed`, `--reset`, `seed-lifecycle.check.ts`).
