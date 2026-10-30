/**
 * EquiFlow — Guarded Disposable-Target Migration Chain Verification Harness (CR-026 / CR-027 / TASK-019)
 *
 * Implements strict target safety and verification contracts:
 * - Requires explicit DATABASE_URL and DIRECT_URL.
 * - Validates matching normalized protocol, host, port, database, and schema.
 * - Refuses equiflow, equiflow_task019_codex, remote hosts, or mismatched endpoints.
 * - Refuses nonempty targets by default before deploy/seed.
 * - Uses argument-array process spawning (spawnSync) without shell interpolation.
 * - Uses the same validated datasource for preflight checks via Prisma.
 * - Separates in-run second-deploy idempotency from pre-migrated target verification.
 * - Sanitizes database URLs in all logs (never logs credentials).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { URL } = require('url');
const { PrismaClient } = require('@prisma/client');

const APPROVED_TARGET_DATABASES = [
  'equiflow_task019_migrations_build',
  'equiflow_task019_migrations_verify',
];

const FORBIDDEN_TARGET_DATABASES = [
  'equiflow',
  'equiflow_task019_codex',
  'postgres',
  'template0',
  'template1',
];

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const PRISMA_CLI_PATH = path.resolve(__dirname, '../node_modules/prisma/build/index.js');
const TS_NODE_PATH = path.resolve(__dirname, '../node_modules/ts-node/dist/bin.js');

/**
 * Strips password and sensitive auth credentials from a database URL.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '<empty>';
  try {
    const parsed = new URL(rawUrl.trim());
    const username = parsed.username ? parsed.username : '';
    const authPart = username ? `${username}:***@` : '';
    const portPart = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${authPart}${parsed.hostname}${portPart}${parsed.pathname}${parsed.search}`;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Normalizes host string (removes IPv6 brackets, lowercases).
 */
function normalizeHost(host) {
  return (host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * Validates database target URLs against safety invariants and endpoint matching.
 */
function validateTargets(databaseUrl, directUrl, options = {}) {
  const allowedDatabases = options.allowedDatabases || APPROVED_TARGET_DATABASES;

  if (!databaseUrl || typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('SAFETY GATE REJECTED: DATABASE_URL is required, non-empty, and must be a string.');
  }
  if (!directUrl || typeof directUrl !== 'string' || !directUrl.trim()) {
    throw new Error('SAFETY GATE REJECTED: DIRECT_URL is required, non-empty, and must be a string.');
  }

  let dbParsed;
  let directParsed;
  try {
    dbParsed = new URL(databaseUrl.trim());
  } catch (err) {
    throw new Error(`SAFETY GATE REJECTED: Invalid DATABASE_URL format: ${err.message}`);
  }
  try {
    directParsed = new URL(directUrl.trim());
  } catch (err) {
    throw new Error(`SAFETY GATE REJECTED: Invalid DIRECT_URL format: ${err.message}`);
  }

  const validProtocols = ['postgresql:', 'postgres:'];
  if (!validProtocols.includes(dbParsed.protocol.toLowerCase())) {
    throw new Error(`SAFETY GATE REJECTED: DATABASE_URL must use postgresql: protocol, got '${dbParsed.protocol}'`);
  }
  if (!validProtocols.includes(directParsed.protocol.toLowerCase())) {
    throw new Error(`SAFETY GATE REJECTED: DIRECT_URL must use postgresql: protocol, got '${directParsed.protocol}'`);
  }

  const dbHost = normalizeHost(dbParsed.hostname);
  const directHost = normalizeHost(directParsed.hostname);

  if (!LOCAL_HOSTNAMES.has(dbHost)) {
    throw new Error(`SAFETY GATE REJECTED: DATABASE_URL host '${dbHost}' is not a local address (localhost, 127.0.0.1, [::1]). Remote hosts are strictly forbidden!`);
  }
  if (!LOCAL_HOSTNAMES.has(directHost)) {
    throw new Error(`SAFETY GATE REJECTED: DIRECT_URL host '${directHost}' is not a local address. Remote hosts are strictly forbidden!`);
  }

  if (dbHost !== directHost) {
    throw new Error(`SAFETY GATE REJECTED: Endpoint mismatch: DATABASE_URL host '${dbHost}' does not match DIRECT_URL host '${directHost}'.`);
  }

  const dbPort = dbParsed.port || '5432';
  const directPort = directParsed.port || '5432';
  if (dbPort !== directPort) {
    throw new Error(`SAFETY GATE REJECTED: Endpoint mismatch: DATABASE_URL port '${dbPort}' does not match DIRECT_URL port '${directPort}'.`);
  }

  const dbName = (dbParsed.pathname || '').replace(/^\//, '').trim();
  const directDbName = (directParsed.pathname || '').replace(/^\//, '').trim();

  if (!dbName) {
    throw new Error('SAFETY GATE REJECTED: Database name missing in DATABASE_URL pathname.');
  }
  if (!directDbName) {
    throw new Error('SAFETY GATE REJECTED: Database name missing in DIRECT_URL pathname.');
  }
  if (dbName !== directDbName) {
    throw new Error(`SAFETY GATE REJECTED: Endpoint mismatch: DATABASE_URL database '${dbName}' does not match DIRECT_URL database '${directDbName}'.`);
  }

  const dbSchema = dbParsed.searchParams.get('schema') || 'public';
  const directSchema = directParsed.searchParams.get('schema') || 'public';
  if (dbSchema !== directSchema) {
    throw new Error(`SAFETY GATE REJECTED: Endpoint mismatch: DATABASE_URL schema '${dbSchema}' does not match DIRECT_URL schema '${directSchema}'.`);
  }

  if (FORBIDDEN_TARGET_DATABASES.includes(dbName.toLowerCase())) {
    throw new Error(`SAFETY GATE REJECTED: Target database '${dbName}' is strictly protected and forbidden from verification mutation!`);
  }

  if (!allowedDatabases.includes(dbName)) {
    throw new Error(`SAFETY GATE REJECTED: Database '${dbName}' is not in approved disposable targets list: [${allowedDatabases.join(', ')}]`);
  }

  return {
    databaseName: dbName,
    schema: dbSchema,
    host: dbHost,
    port: dbPort,
    sanitizedDatabaseUrl: sanitizeUrl(databaseUrl),
    sanitizedDirectUrl: sanitizeUrl(directUrl),
  };
}

/**
 * Spawns a process with an exact argument array and propagates errors immediately.
 */
function spawnProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: Object.assign({}, process.env, options.env || {}),
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    cwd: options.cwd || process.cwd(),
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const errorMsg = `Command failed [exit ${result.status}]: ${command} ${args.join(' ')}\n${result.stderr || result.stdout || ''}`;
    const err = new Error(errorMsg.trim());
    err.status = result.status;
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    throw err;
  }
  return result.stdout;
}

/**
 * Spawns Prisma CLI commands using an argument array without shell interpolation.
 */
function runPrismaCommand(args, env = {}) {
  return spawnProcess(process.execPath, [PRISMA_CLI_PATH, ...args], { env });
}

/**
 * Queries the table count directly using the validated datasource URL.
 * Returns -1 if the database does not exist.
 */
async function queryTableCount(databaseUrl, schema = 'public') {
  const client = new PrismaClient({
    datasourceUrl: databaseUrl.trim(),
  });
  try {
    await client.$connect();
    const rows = await client.$queryRawUnsafe(
      "SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE';",
      schema
    );
    return Array.isArray(rows) && rows[0] && typeof rows[0].count === 'number' ? rows[0].count : 0;
  } catch (err) {
    if (err.code === 'P1003' || (err.message && err.message.includes('does not exist'))) {
      return -1; // Database does not exist yet
    }
    throw new Error(`Failed to query table count on datasource: ${err.message}`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/**
 * Ensures the target database exists on the PostgreSQL host.
 */
async function ensureTargetDatabase(databaseUrl, databaseName) {
  const count = await queryTableCount(databaseUrl);
  if (count === -1) {
    console.log(`[HARNESS] Creating disposable database: ${databaseName}...`);
    // Connect to postgres maintenance DB to execute CREATE DATABASE
    const maintenanceUrl = new URL(databaseUrl.trim());
    maintenanceUrl.pathname = '/postgres';
    const maintenanceClient = new PrismaClient({
      datasourceUrl: maintenanceUrl.toString(),
    });
    try {
      await maintenanceClient.$connect();
      await maintenanceClient.$executeRawUnsafe(`CREATE DATABASE "${databaseName}";`);
      console.log(`[HARNESS] Created ${databaseName} successfully.`);
    } finally {
      await maintenanceClient.$disconnect().catch(() => {});
    }
  } else {
    console.log(`[HARNESS] Target database ${databaseName} exists.`);
  }
}

/**
 * Verifies deploy idempotency on an already migrated target database.
 */
async function verifyAlreadyMigratedTarget(databaseUrl, directUrl, options = {}) {
  const target = validateTargets(databaseUrl, directUrl, options);
  console.log(`[HARNESS] Verifying already-migrated target: ${target.databaseName}...`);

  const childEnv = {
    DATABASE_URL: databaseUrl.trim(),
    DIRECT_URL: directUrl.trim(),
  };

  const statusOut = runPrismaCommand(['migrate', 'status'], childEnv);
  if (!statusOut.includes('Database schema is up to date') && !statusOut.includes('up to date')) {
    throw new Error(`Target ${target.databaseName} is not up to date:\n${statusOut}`);
  }

  const deployOut = runPrismaCommand(['migrate', 'deploy'], childEnv);
  if (!deployOut.includes('No pending migrations to apply')) {
    throw new Error(`Expected zero pending migrations, got:\n${deployOut}`);
  }

  runPrismaCommand(
    ['migrate', 'diff', '--exit-code', '--from-url', databaseUrl.trim(), '--to-schema-datamodel', 'prisma/schema.prisma'],
    childEnv
  );
  console.log(`[HARNESS] Pre-migrated target ${target.databaseName} is idempotent and schema-equivalent.`);
  return { success: true, target: target.databaseName };
}

/**
 * Runs the full verification sequence on the validated target database.
 */
async function runVerification(databaseUrl, directUrl, options = {}) {
  const target = validateTargets(databaseUrl, directUrl, options);
  console.log(`\n============================================================`);
  console.log(`[HARNESS] Verified Safe Target: ${target.databaseName}`);
  console.log(`[HARNESS] Sanitized URL: ${target.sanitizedDatabaseUrl}`);
  console.log(`============================================================\n`);

  const queryTableCountFn = options.queryTableCountFn || queryTableCount;
  const ensureTargetDatabaseFn = options.ensureTargetDatabaseFn || ensureTargetDatabase;

  await ensureTargetDatabaseFn(databaseUrl, target.databaseName);

  // Preflight: Query table count using the validated datasource
  const initialTableCount = await queryTableCountFn(databaseUrl, target.schema);
  console.log(`[HARNESS] Preflight table count in ${target.databaseName}: ${initialTableCount}`);

  // Safety Gate: Refuse nonempty targets by default unless explicitly allowed
  if (initialTableCount > 0 && options.allowNonEmpty !== true) {
    throw new Error(
      `SAFETY GATE REJECTED: Target database '${target.databaseName}' is nonempty (contains ${initialTableCount} tables). Nonempty targets are refused by default.`
    );
  }

  const childEnv = {
    DATABASE_URL: databaseUrl.trim(),
    DIRECT_URL: directUrl.trim(),
  };

  // Step 1: Deploy migrations using argument array
  console.log(`\n[HARNESS STEP 1] Running 'prisma migrate deploy'...`);
  const deploy1Out = runPrismaCommand(['migrate', 'deploy'], childEnv);
  console.log(deploy1Out);

  // Step 2: Check migration status
  console.log(`\n[HARNESS STEP 2] Running 'prisma migrate status'...`);
  const statusOut = runPrismaCommand(['migrate', 'status'], childEnv);
  console.log(statusOut);
  if (!statusOut.includes('Database schema is up to date') && !statusOut.includes('up to date')) {
    throw new Error(`Migration status check failed: Expected up to date schema.\n${statusOut}`);
  }

  // Step 3: In-run second-deploy idempotency check
  console.log(`\n[HARNESS STEP 3] In-run second deploy idempotency check...`);
  const deploy2Out = runPrismaCommand(['migrate', 'deploy'], childEnv);
  console.log(deploy2Out);
  if (!deploy2Out.includes('No pending migrations to apply')) {
    throw new Error(`In-run deploy idempotency check failed: Expected 'No pending migrations to apply', got:\n${deploy2Out}`);
  }

  // Step 4: Verify schema equivalence against prisma/schema.prisma
  console.log(`\n[HARNESS STEP 4] Checking schema equivalence with 'prisma migrate diff --exit-code'...`);
  const diffOut = runPrismaCommand(
    ['migrate', 'diff', '--exit-code', '--from-url', databaseUrl.trim(), '--to-schema-datamodel', 'prisma/schema.prisma'],
    childEnv
  );
  console.log(diffOut || 'No difference detected.');
  console.log(`[HARNESS STEP 4] Schema equivalence PASSED: Zero difference detected.`);

  // Step 5: Seed baseline and manual-QA fixtures if requested
  if (options.seed !== false) {
    console.log(`\n[HARNESS STEP 5a] Seeding baseline fixtures ('ts-node prisma/seed.ts')...`);
    spawnProcess(process.execPath, [TS_NODE_PATH, 'prisma/seed.ts'], { env: childEnv, stdio: 'inherit' });

    console.log(`\n[HARNESS STEP 5b] Seeding manual QA fixtures ('ts-node prisma/seed-manual-qa.ts --confirm-local-qa')...`);
    spawnProcess(process.execPath, [TS_NODE_PATH, 'prisma/seed-manual-qa.ts', '--confirm-local-qa'], { env: childEnv, stdio: 'inherit' });
    console.log(`[HARNESS STEP 5] Seeding completed successfully.`);
  }

  const finalTableCount = await queryTableCountFn(databaseUrl, target.schema);
  console.log(`\n[HARNESS] Verification complete on ${target.databaseName}. Tables count: ${finalTableCount}`);
  return {
    success: true,
    target: target.databaseName,
    initialTableCount,
    finalTableCount,
  };
}

// Direct execution entry point
if (require.main === module) {
  const dbUrl = process.env.DISPOSABLE_DATABASE_URL;
  const directUrl = process.env.DISPOSABLE_DIRECT_URL;

  if (!dbUrl || !dbUrl.trim() || !directUrl || !directUrl.trim()) {
    console.error(
      '\n[HARNESS ERROR] SAFETY GATE REJECTED: Both DISPOSABLE_DATABASE_URL and DISPOSABLE_DIRECT_URL must be explicitly provided in environment variables. Default URLs and fallback credentials are strictly forbidden.\n'
    );
    process.exit(1);
  }

  const verifyDbName = 'equiflow_task019_migrations_verify';
  const isAlreadyMigratedCheck =
    process.argv.includes('--verify-already-migrated') ||
    process.env.CHECK_ALREADY_MIGRATED === 'true';

  if (isAlreadyMigratedCheck) {
    console.log(`[HARNESS] Running non-mutating pre-migrated verification on target: ${verifyDbName}...`);
    verifyAlreadyMigratedTarget(dbUrl.trim(), directUrl.trim(), {
      allowedDatabases: [verifyDbName],
    })
      .then((result) => {
        console.log(`\n>>> PRE-MIGRATED TARGET IDEMPOTENCY & EQUIVALENCE PASSED (Target: ${result.target}) <<<\n`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(`\n[HARNESS ERROR] Pre-migrated verification failed:`, err.message);
        process.exit(1);
      });
  } else {
    console.log(`[HARNESS] Starting migration chain verification on target: ${verifyDbName}...`);
    runVerification(dbUrl.trim(), directUrl.trim(), {
      allowedDatabases: [verifyDbName],
      allowNonEmpty: process.env.ALLOW_NONEMPTY === 'true',
    })
      .then((result) => {
        console.log(`\n>>> ALL MIGRATION CHAIN VERIFICATION GATES PASSED (Target: ${result.target}) <<<\n`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(`\n[HARNESS ERROR] Migration verification failed:`, err.message);
        process.exit(1);
      });
  }
}

module.exports = {
  APPROVED_TARGET_DATABASES,
  FORBIDDEN_TARGET_DATABASES,
  LOCAL_HOSTNAMES,
  sanitizeUrl,
  normalizeHost,
  validateTargets,
  spawnProcess,
  runPrismaCommand,
  queryTableCount,
  ensureTargetDatabase,
  verifyAlreadyMigratedTarget,
  runVerification,
};
