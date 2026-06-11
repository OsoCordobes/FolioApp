/**
 * scripts/diff-migrations.mjs
 *
 * Read-only diagnostic: lists which supabase/migrations/*.sql are NOT yet
 * applied to the database. Does NOT apply anything. Safe to run anytime.
 *
 * Run: node --env-file=.env.local scripts/diff-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const dir = path.resolve("supabase/migrations");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING/DATABASE_URL not set");
  process.exit(1);
}

const cleanUrl = url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, "");
const client = new Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await client.connect();

// Show which DB we connected to (host only, no creds).
const host = new URL(cleanUrl).host;
console.log(`Connected to: ${host}\n`);

// Make sure the migrations table exists; if it doesn't, every migration is "pending".
await client.query(`
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    statements text[],
    name text
  );
`);

const { rows } = await client.query(
  "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
);
const applied = new Set(rows.map((r) => r.version));
const repoVersions = new Set(files.map((f) => f.split("_")[0]));

console.log(`Applied: ${rows.length} migrations`);
console.log(`Repo:    ${files.length} migrations\n`);

const pending = [];
for (const file of files) {
  const version = file.split("_")[0];
  const name = file.replace(/\.sql$/, "").substring(version.length + 1);
  if (!applied.has(version)) pending.push({ version, name, file });
}

// Drift inverso: aplicada en la DB pero sin archivo en el repo. Así se
// escaparon M44–M48 y M52 — el chequeo repo→DB solo no alcanza. Si aparece
// acá, hay que recuperar el DDL del ledger (columna `statements`) al repo.
const missingInRepo = rows.filter((r) => !repoVersions.has(r.version));

if (pending.length === 0) {
  console.log("All repo migrations applied.");
} else {
  console.log(`Pending (${pending.length}):`);
  for (const p of pending) console.log(`  ${p.version}  ${p.name}`);
  console.log(
    `\nTo apply: node --env-file=.env.local scripts/push-pending-migrations.mjs`,
  );
}

if (missingInRepo.length > 0) {
  console.log(`\n⚠ DRIFT: applied in DB but MISSING from repo (${missingInRepo.length}):`);
  for (const m of missingInRepo) console.log(`  ${m.version}  ${m.name ?? "(sin nombre)"}`);
  console.log(
    "  Recover the canonical DDL from supabase_migrations.schema_migrations.statements into supabase/migrations/.",
  );
  process.exitCode = 1;
} else if (pending.length === 0) {
  console.log("Repo and DB ledgers match. Nothing to do.");
}

await client.end();
