# EquiFlow Database Baseline & Migration Chain Runbook

> **Governing Contract:** Approved CR-026 (Plan `v1-approved-r25` / `TASK-019`).  
> **Status:** ACTIVE & PRODUCTION-GRADE.

---

## 1. Provenance & Architecture

Historically, the EquiFlow database was provisioned via `prisma db push` during initial prototype development before migrations were introduced in commit `537a919`. As a result, the migration history began with `20261021_add_simulator_sessions`, which performed an `ALTER TABLE "IncidentReport" ADD COLUMN "sourceEventId"`. On an empty database, running `prisma migrate deploy` failed with error `P3018 (table "IncidentReport" does not exist)`.

Under approved **CR-026**, the missing baseline is cleanly reconstructed without altering historical migrations:

| Component | Identifier / Checksum | Provenance Description |
| :--- | :--- | :--- |
| **Parent Commit** | `7c589e145b2316dbbf301dbc7c82e0c4a6fdc671` | Direct parent of `537a919` (`537a919~1` / `fix(auth): tighten login validation...`) |
| **Commit Date** | `Wed Oct 21 14:31:55 2026 +0700` | Committed immediately prior to Simulator integration |
| **Baseline Schema** | `prisma/baselines/pre-simulator.prisma` | Pre-simulator schema snapshot from resolved parent commit |
| **Schema SHA-256** | `352d278bb689c9122bfa33f5b582ed838282b2f1c5932759ca439876f72921c9` | Immutable content digest (credentials stripped, env references only) |
| **Initial Migration** | `20261020000000_initial_baseline` | DDL generated from empty datamodel to frozen baseline schema |
| **Reconcile Migration**| `20261030000000_reconcile_acceptance_schema` | Safe idempotent reconciliation of db-push schema drift (`Horse.rfid` drop, `Horse.weightKg` add) |

---

## 2. Complete Migration Chain

The Prisma migration chain in `prisma/migrations/` consists of five sequential migrations:

1. `20261020000000_initial_baseline`: Creates core tables (`User`, `Horse`, `IncidentReport`, `StockBalance`, `Stall`, `DailyCareTask`, `Tournament`, etc.), enums, indexes, and foreign key constraints.
2. `20261021_add_simulator_sessions` *(historical, byte-for-byte preserved)*: Adds `SimulatorSessionType`, `SimulatorSessionStatus`, `sourceEventId` on `IncidentReport`, and `SimulatorSession` table.
3. `20261023_add_simulator_exam_sessions` *(historical, byte-for-byte preserved)*: Adds `EXAM` to `SimulatorSessionType`.
4. `20261029010000_supply_delivery_sync` *(historical, byte-for-byte preserved)*: Adds `DELIVERING` to `RestockStatus` and nullable `capacity` to `StockBalance`.
5. `20261030000000_reconcile_acceptance_schema`: Safe idempotent alignment dropping unused `Horse_rfid` index/column and adding `Horse.weightKg`.

Result: `prisma migrate diff --exit-code --from-url <DB_URL> --to-schema-datamodel prisma/schema.prisma` returns exit code **0** (`No difference detected`).

---

## 3. Fresh Database Provisioning Runbook

To provision a fresh database from scratch (e.g. CI/CD, staging, new developer machine):

1. **Ensure PostgreSQL is running:**
   ```bash
   npm run db:up
   ```
2. **Apply all migrations:**
   ```bash
   npx prisma migrate deploy
   ```
3. **Verify migration status:**
   ```bash
   npx prisma migrate status
   # Output: Database schema is up to date!
   ```
4. **Seed base catalogs and master data:**
   ```bash
   npm run db:seed
   ```
5. **(Optional for local QA/dev) Seed deterministic manual-QA fixtures:**
   ```bash
   npm run db:seed:manual-qa -- --confirm-local-qa
   ```

---

## 4. Existing Populated Database Adoption Runbook

For existing populated databases (such as local dev database `equiflow`) that were previously populated via `db:setup` / `prisma db push`:

> [!CAUTION]
> **NO POPULATED DATABASE MODIFICATION IS AUTHORIZED.**  
> Modifying the live/populated `equiflow` database, executing DDL against populated tables, or running blanket `prisma migrate resolve --applied` commands is **STRICTLY FORBIDDEN** under TASK-019 / CR-026. Adoption of migrations on populated databases requires separate, exact-target human authorization.

### Step 4.1: Read-Only Preflight & Schema Inventory
1. Inspect the migration tracking table `_prisma_migrations` read-only:
   ```bash
   docker exec equiflow-postgres psql -U postgres -d <TARGET_DB> -c "SELECT id, migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"
   ```
2. Verify domain schema against target datamodel read-only:
   ```bash
   npx prisma migrate diff \
     --from-url "<TARGET_DATABASE_URL>" \
     --to-schema-datamodel prisma/schema.prisma
   ```

### Step 4.2: Mandatory Backup and Verified Restoration in Disposable Target
Before any metadata or migration write is ever contemplated on an existing database:
1. Export a complete custom-format backup:
   ```bash
   docker exec equiflow-postgres pg_dump -U postgres -d <TARGET_DB> -F c -b -v -f /tmp/backup_pre_adoption.dump
   ```
2. Restore the backup into a separate, isolated disposable database (e.g. `equiflow_test_restore`) and verify that table count, row count, and checksums match the source.

### Step 4.3: Per-Migration Applied-State, Checksum, and Effect Inspection
Blanket `migrate resolve` is strictly forbidden. For each migration in `prisma/migrations/`:
1. Inspect the SQL file and verify that every object, column, index, and constraint created or altered by that migration demonstrably exists in the populated database.
2. If and only if a migration's effects are demonstrably present, its entry is absent from `_prisma_migrations`, and explicit human authorization has been granted, resolve that specific migration individually:
   ```bash
   # ONLY with separate explicit human authorization for <TARGET_DB>:
   # npx prisma migrate resolve --applied <exact_migration_name>
   ```

### Step 4.4: Final Status Verification
```bash
npx prisma migrate status
```
All migrations must show applied; zero failed or pending migrations.

---

## 5. Automated Harness Verification

### Full Verification (Clean Provisioning & Seeding)
To run complete verification on an empty disposable target:
```bash
$env:DISPOSABLE_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify?schema=public"
$env:DISPOSABLE_DIRECT_URL=$env:DISPOSABLE_DATABASE_URL
npm run test:migrations
```
This runs `scripts/verify-migration-chain.cjs`, which:
- Confirms safety invariants (only accepts local disposable targets, protects `equiflow`).
- Provisions `equiflow_task019_migrations_verify`.
- Replays all 5 migrations from empty.
- Verifies in-run deploy idempotency (second deploy applies 0 migrations).
- Asserts strict schema equivalence against `prisma/schema.prisma` (`exit 0`).
- Seeds baseline and manual QA fixtures into the disposable target.

### Non-Mutating Re-Check (Pre-Migrated Target, Zero Seeding)
To verify status, deploy idempotency, and schema equivalence on an already-migrated disposable target without seeding or data mutation:
```bash
$env:DISPOSABLE_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify?schema=public"
$env:DISPOSABLE_DIRECT_URL=$env:DISPOSABLE_DATABASE_URL
npm run test:migrations:check
# Or directly:
# node scripts/verify-migration-chain.cjs --verify-already-migrated
```
This invokes `verifyAlreadyMigratedTarget` directly:
- Validates target safety and explicit matching URLs.
- Asserts `prisma migrate status` is up to date.
- Asserts `prisma migrate deploy` reports `No pending migrations to apply`.
- Asserts `prisma migrate diff --exit-code` reports zero schema difference.
- Performs **NO seeding, NO DDL, and NO data mutation**.
