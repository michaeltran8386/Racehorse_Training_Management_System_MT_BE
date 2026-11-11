# Tasks: Canonical Full-Scope Seed & Deploy Auto-Seed

- [x] Create clean branch `chore/canonical-full-seed` from `origin/dev` and verify domain validation rules (`HORSE_GENDERS`, `StallZone` bounds, `MealDto`, `Counter` keys, PR #153 unique `OPEN` medical record)
- [x] Write specification (`docs/specs/canonical-full-seed.md`), implementation plan (`tasks/plan.md`), and task checklist (`tasks/todo.md`)
- [x] Remove `prisma/seed-demo.ts` and `"db:seed:demo"` from `package.json`
- [x] Update `Dockerfile` startup command to auto-run `npm run db:seed` when `"User"` table is empty
- [x] Implement expanded, environment-agnostic, idempotent (`--reset`-supported) `prisma/seed.ts` across all 38 Prisma models
- [x] Update `test/seed-lifecycle.check.ts` to assert all 38 models, expanded counts, enum coverage, PR #153, and `BR-STL-07`
- [x] Update `acc.md` and `README.md` to match canonical accounts, passwords, and commands
- [x] Verify with `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`
- [x] Verify on real PostgreSQL: `npx prisma db push --skip-generate`, `npm run db:seed` twice (CI 2b idempotency), `npm run db:seed -- --reset`, and `npx ts-node test/seed-lifecycle.check.ts`
