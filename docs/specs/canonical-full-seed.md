# Canonical small-business seed

Confirmed scope: one `prisma/seed.ts`, current application rules, both volume and connected lifecycle history. Replace all alternative runnable seed templates. No schema changes and no database execution as part of implementation.

## Dataset

- Business opens 2025-12-01; daily care history until the recent window, detailed current care and staff schedules through today +21 days in club time (+07:00).
- Preserve the canonical roster and logins: 19 resident/historical horses, 5 additional intake profiles, 32 accounts, 48 stalls across A/B/C/H, 4 tracks, 7 supply categories.
- Histories connect horse, allocation, groom, roster, care task, completion, nutrition, clinical record, training cycle, workout, race registration and results.
- Intake: all statuses, chip/legal verification, health reviews, manager decisions, and transition logs. Handover: all statuses, two pending SLA examples. Transfers, staff work, reviews and complaints are included.
- Invoices: 2025-12 through 2026-10 inclusive. Legacy packages before 2026-09; actual usage thereafter. Amounts reuse boarding/prize/usage helpers; immutable lines trace care charges and a reversal. Cancelled invoices retain lines without claims. Later care is unbilled.
- All 50 current Prisma models contain data. No claim that every possible enum combination or every application error is represented.

## Execution

`npm run db:seed` and Prisma's seed hook run the same file with tsconfig paths. Existing invoice edits are preserved. Deterministic IDs and unique business keys make repeated runs nonduplicating. Existing unrelated data is retained; use an empty demo database for a coherent fresh dataset. Explicit `--reset` clears all application tables in dependency order in the same transaction, disabled in production.

Migration verification runs this same seed twice and the read-only lifecycle check. There is no manual-QA overlay. `npm run test:seed` exercises generation with a Prisma-metadata-backed in-memory recorder without reading environment credentials or connecting to a database. This checks required fields, unique keys, foreign keys, billing arithmetic/claims, timelines, model/status coverage, reruns, preservation of payment edits, and reset dependency order. It does not replace PostgreSQL integration testing.

## Validation

Run `npm run test:seed`, `npm run typecheck`, lint, focused business-rule tests and build. `npm run db:verify` is reserved for an explicitly seeded demo database. No database seed, reset, migration or application startup is performed while implementing this change.
