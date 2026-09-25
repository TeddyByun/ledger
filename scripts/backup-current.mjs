#!/usr/bin/env node
// Run from the repository: node --env-file=.env scripts/backup-current.mjs
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'apps/api/package.json'));
const { PrismaClient } = require('@prisma/client');
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const pg = (name) => process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
const id = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const root = path.resolve(process.env.BACKUP_DIR || path.join(homedir(), 'db-backups/snapshots'));
const temporary = path.join(root, `.${id}.partial`);
const destination = path.join(root, id);
const exclusions = ['node_modules', '.next', 'dist', 'build', 'out', '.turbo', 'coverage',
  '.pm2-logs', '*.log', '*.tsbuildinfo'];
let db;

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  process.umask(0o077);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; use node --env-file=.env.');
  if (root === repo || root.startsWith(repo + path.sep)) throw new Error('BACKUP_DIR must be outside the repository.');
  const url = new URL(process.env.DATABASE_URL);
  const pgEnvironment = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c timezone=UTC -c datestyle=ISO,YMD',
  };
  for (const [parameter, variable] of [['sslmode', 'PGSSLMODE'], ['sslrootcert', 'PGSSLROOTCERT']]) {
    if (url.searchParams.has(parameter)) pgEnvironment[variable] = url.searchParams.get(parameter);
  }
  await run(pg('pg_dump'), ['--version']);
  if (process.argv.length > 2) throw new Error('This command creates a local backup only. Use the encrypted host backup service for remote storage.');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(temporary, { mode: 0o700 });
  console.log(`Creating snapshot ${id}`);
  db = new PrismaClient();
  const database = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    await tx.$executeRawUnsafe("SET LOCAL DateStyle = 'ISO, YMD'");
    const [snapshot] = await tx.$queryRawUnsafe(
      'SELECT pg_export_snapshot() AS snapshot, version() AS version, current_database() AS database, current_timestamp AS captured_at',
    );
    const tables = await tx.$queryRawUnsafe(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type = 'BASE TABLE' ORDER BY 1,2",
    );
    for (const table of tables) {
      const [result] = await tx.$queryRawUnsafe(
        `SELECT count(*)::text AS rows, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS fingerprint FROM ${quote(table.table_schema)}.${quote(table.table_name)} t`,
      );
      Object.assign(table, result);
    }
    await run(pg('pg_dump'), [
      '--format=custom', '--no-owner', '--no-privileges', `--snapshot=${snapshot.snapshot}`,
      '--file', path.join(temporary, 'database.dump'),
    ], { env: pgEnvironment, timeout: 240_000 });
    return { version: snapshot.version, name: snapshot.database, capturedAt: snapshot.captured_at, tables };
  }, { isolationLevel: 'RepeatableRead', timeout: 300_000 });
  await db.$disconnect();
  db = undefined;
  await run(pg('pg_restore'), ['--list', path.join(temporary, 'database.dump')]);
  await run('tar', [
    ...exclusions.map((entry) => `--exclude=${entry}`),
    '-czf', path.join(temporary, 'application.tar.gz'), '-C', repo, '.',
  ], { timeout: 240_000 });
  await run('gzip', ['--test', path.join(temporary, 'application.tar.gz')]);
  const { stdout: archiveListing } = await run('tar', ['-tzf', path.join(temporary, 'application.tar.gz')], { maxBuffer: 16 * 1024 * 1024 });
  const archivePaths = new Set(archiveListing.trim().split('\n'));
  for (const expected of ['./.env', './package.json', './pnpm-lock.yaml', './apps/api/prisma/schema.prisma']) {
    if (!archivePaths.has(expected)) throw new Error(`Missing recovery file: ${expected}`);
  }
  const gitHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const gitStatus = (await run('git', ['status', '--short'], { cwd: repo })).stdout;
  const artifacts = [];
  for (const name of ['database.dump', 'application.tar.gz']) {
    const filename = path.join(temporary, name);
    await chmod(filename, 0o600);
    artifacts.push({ name, bytes: (await stat(filename)).size, sha256: await sha256(filename) });
  }
  const manifest = { format: 1, id, createdAt: new Date().toISOString(), database, gitHead, gitStatus,
    application: { includes: 'Working tree (including uncommitted/untracked files), Git history, environment files and uploads', exclusions },
    artifacts,
    recovery: 'Use PostgreSQL 18 or newer. Restore database.dump with pg_restore --no-owner --no-privileges --exit-on-error into a NEW empty database. See docs/DB_BACKUP_RECOVERY.md in application.tar.gz.',
  };
  await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(temporary, 'SHA256SUMS'), [
    ...artifacts.map((file) => `${file.sha256}  ${file.name}`),
    `${await sha256(path.join(temporary, 'manifest.json'))}  manifest.json`,
  ].join('\n') + '\n', { mode: 0o600 });
  await run('sha256sum', ['--check', 'SHA256SUMS'], { cwd: temporary });
  await rename(temporary, destination);
  console.log(`Local backup verified: ${destination}`);
  console.log('Local backup only. Use ledger-db-backup.service for encrypted remote backups.');
  console.log(`Database tables: ${database.tables.length}; application archive and database hashes verified. No old backups removed.`);
} catch (error) {
  console.error(`Backup failed: ${error.message}`);
  console.error(`Inspect ${temporary} and ${destination}; incomplete files are not successful backups.`);
  process.exitCode = 1;
} finally {
  if (db) await db.$disconnect();
}
