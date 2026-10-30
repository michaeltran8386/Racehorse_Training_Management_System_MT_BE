/**
 * EquiFlow — Unit Tests for Migration Chain Verification Harness (CR-026 / CR-027 / TASK-019)
 *
 * Verifies safety gates, target refusal, endpoint mismatch, nonempty refusal, and command failure propagation.
 */

const assert = require('assert');
const {
  sanitizeUrl,
  validateTargets,
  spawnProcess,
  runVerification,
} = require('./verify-migration-chain.cjs');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('--- Running Enhanced Migration Verification Harness Unit Tests ---\n');

  // 1. URL Sanitization Tests
  await runTest('sanitizeUrl strips user password from PostgreSQL URL', () => {
    const raw = 'postgresql://postgres:SuperSecret123@localhost:5432/equiflow_task019_migrations_verify?schema=public';
    const sanitized = sanitizeUrl(raw);
    assert(!sanitized.includes('SuperSecret123'), 'Sanitized URL must not contain password');
    assert(sanitized.includes('***'), 'Sanitized URL must contain *** placeholder');
    assert(sanitized.includes('equiflow_task019_migrations_verify'), 'Sanitized URL must preserve DB name');
    assert(sanitized.includes('schema=public'), 'Sanitized URL must preserve query params');
  });

  await runTest('sanitizeUrl handles empty, missing, or invalid URLs safely', () => {
    assert.strictEqual(sanitizeUrl(''), '<empty>');
    assert.strictEqual(sanitizeUrl(null), '<empty>');
    assert.strictEqual(sanitizeUrl('invalid-not-a-url'), '<invalid-url>');
  });

  // 2. Target Validation — Happy Path
  await runTest('validateTargets accepts approved local disposable targets with identical endpoints', () => {
    const dbUrl = 'postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify?schema=public';
    const directUrl = 'postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify?schema=public';
    const target = validateTargets(dbUrl, directUrl);
    assert.strictEqual(target.databaseName, 'equiflow_task019_migrations_verify');
    assert.strictEqual(target.host, 'localhost');
    assert.strictEqual(target.port, '5432');
    assert.strictEqual(target.schema, 'public');
    assert(!target.sanitizedDatabaseUrl.includes('postgres:postgres@'));
  });

  await runTest('validateTargets accepts build target when explicitly allowed', () => {
    const dbUrl = 'postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_build?schema=public';
    const target = validateTargets(dbUrl, dbUrl);
    assert.strictEqual(target.databaseName, 'equiflow_task019_migrations_build');
  });

  // 3. Target Validation — Rejection Gates
  await runTest('validateTargets rejects missing or empty DATABASE_URL', () => {
    assert.throws(
      () => validateTargets('', 'postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify'),
      /DATABASE_URL is required/
    );
  });

  await runTest('validateTargets rejects missing or empty DIRECT_URL', () => {
    assert.throws(
      () => validateTargets('postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify', ''),
      /DIRECT_URL is required/
    );
  });

  await runTest('validateTargets rejects non-postgresql protocol', () => {
    assert.throws(
      () => validateTargets('mysql://user:pass@localhost:3306/equiflow_task019_migrations_verify', 'mysql://user:pass@localhost:3306/equiflow_task019_migrations_verify'),
      /must use postgresql: protocol/
    );
  });

  await runTest('validateTargets strictly rejects remote hostnames (e.g. AWS, Supabase, external IPs)', () => {
    assert.throws(
      () => validateTargets('postgresql://postgres:pass@aws.rds.amazonaws.com:5432/equiflow_task019_migrations_verify', 'postgresql://postgres:pass@aws.rds.amazonaws.com:5432/equiflow_task019_migrations_verify'),
      /is not a local address/
    );
    assert.throws(
      () => validateTargets('postgresql://postgres:pass@192.168.1.100:5432/equiflow_task019_migrations_verify', 'postgresql://postgres:pass@192.168.1.100:5432/equiflow_task019_migrations_verify'),
      /is not a local address/
    );
  });

  await runTest('validateTargets strictly protects original database "equiflow"', () => {
    assert.throws(
      () => validateTargets('postgresql://postgres:pass@localhost:5432/equiflow', 'postgresql://postgres:pass@localhost:5432/equiflow'),
      /strictly protected and forbidden/
    );
  });

  await runTest('validateTargets strictly protects quarantined database "equiflow_task019_codex"', () => {
    assert.throws(
      () => validateTargets('postgresql://postgres:pass@localhost:5432/equiflow_task019_codex', 'postgresql://postgres:pass@localhost:5432/equiflow_task019_codex'),
      /strictly protected and forbidden/
    );
  });

  await runTest('validateTargets rejects unapproved arbitrary database names', () => {
    assert.throws(
      () => validateTargets('postgresql://postgres:pass@localhost:5432/some_random_db', 'postgresql://postgres:pass@localhost:5432/some_random_db'),
      /not in approved disposable targets list/
    );
  });

  // 4. Endpoint Mismatch Tests (R-2)
  await runTest('validateTargets rejects mismatched hosts between DATABASE_URL and DIRECT_URL', () => {
    assert.throws(
      () => validateTargets(
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_verify',
        'postgresql://postgres:pass@127.0.0.1:5432/equiflow_task019_migrations_verify'
      ),
      /Endpoint mismatch: DATABASE_URL host 'localhost' does not match DIRECT_URL host '127.0.0.1'/
    );
  });

  await runTest('validateTargets rejects mismatched ports between DATABASE_URL and DIRECT_URL', () => {
    assert.throws(
      () => validateTargets(
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_verify',
        'postgresql://postgres:pass@localhost:5433/equiflow_task019_migrations_verify'
      ),
      /Endpoint mismatch: DATABASE_URL port '5432' does not match DIRECT_URL port '5433'/
    );
  });

  await runTest('validateTargets rejects mismatched database names between DATABASE_URL and DIRECT_URL', () => {
    assert.throws(
      () => validateTargets(
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_verify',
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_build'
      ),
      /Endpoint mismatch: DATABASE_URL database 'equiflow_task019_migrations_verify' does not match DIRECT_URL database 'equiflow_task019_migrations_build'/
    );
  });

  await runTest('validateTargets rejects mismatched search schema between DATABASE_URL and DIRECT_URL', () => {
    assert.throws(
      () => validateTargets(
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_verify?schema=public',
        'postgresql://postgres:pass@localhost:5432/equiflow_task019_migrations_verify?schema=tenant1'
      ),
      /Endpoint mismatch: DATABASE_URL schema 'public' does not match DIRECT_URL schema 'tenant1'/
    );
  });

  // 5. Nonempty Target Refusal Test (R-2) — Runs Offline Without PostgreSQL
  await runTest('runVerification refuses nonempty targets by default (offline test without database)', async () => {
    const dbUrl = 'postgresql://postgres:postgres@localhost:5432/equiflow_task019_migrations_verify?schema=public';
    await assert.rejects(
      async () => {
        await runVerification(dbUrl, dbUrl, {
          allowNonEmpty: false, // Default behavior
          ensureTargetDatabaseFn: async () => {}, // Mock ensure DB (no network)
          queryTableCountFn: async () => 37, // Mock table count (no network)
        });
      },
      /SAFETY GATE REJECTED: Target database 'equiflow_task019_migrations_verify' is nonempty \(contains 37 tables\)\. Nonempty targets are refused by default\./
    );
  });

  // 6. Command Failure Propagation Test (R-2)
  await runTest('spawnProcess propagates non-zero exit status as an Error with exit code and stderr', () => {
    assert.throws(
      () => {
        // Run node with an intentional non-zero exit and error message
        spawnProcess(process.execPath, ['-e', 'console.error("Intentional failure diagnostic"); process.exit(42);']);
      },
      (err) => {
        assert.strictEqual(err.status, 42);
        assert(err.message.includes('Command failed [exit 42]'));
        assert(err.message.includes('Intentional failure diagnostic'));
        return true;
      }
    );
  });

  // 7. Missing Explicit Environment Datasources Refusal (R-2)
  await runTest('CLI entry point strictly refuses execution when DISPOSABLE_DATABASE_URL or DISPOSABLE_DIRECT_URL is missing', () => {
    const harnessScript = require.resolve('./verify-migration-chain.cjs');
    assert.throws(
      () => {
        // Run harness CLI without providing DISPOSABLE_DATABASE_URL or DISPOSABLE_DIRECT_URL
        spawnProcess(process.execPath, [harnessScript], {
          env: {
            PATH: process.env.PATH,
            DISPOSABLE_DATABASE_URL: '',
            DISPOSABLE_DIRECT_URL: '',
          },
        });
      },
      (err) => {
        assert.strictEqual(err.status, 1);
        assert(err.message.includes('SAFETY GATE REJECTED: Both DISPOSABLE_DATABASE_URL and DISPOSABLE_DIRECT_URL must be explicitly provided'));
        return true;
      }
    );
  });

  await runTest('CLI entry point with --verify-already-migrated also requires explicit DISPOSABLE URLs', () => {
    const harnessScript = require.resolve('./verify-migration-chain.cjs');
    assert.throws(
      () => {
        spawnProcess(process.execPath, [harnessScript, '--verify-already-migrated'], {
          env: {
            PATH: process.env.PATH,
            DISPOSABLE_DATABASE_URL: '',
            DISPOSABLE_DIRECT_URL: '',
          },
        });
      },
      (err) => {
        assert.strictEqual(err.status, 1);
        assert(err.message.includes('SAFETY GATE REJECTED'));
        return true;
      }
    );
  });

  console.log(`\nAll ${passedTests}/${totalTests} unit tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\nFatal test execution error:', err);
  process.exit(1);
});
