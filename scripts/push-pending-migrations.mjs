/**
 * scripts/push-pending-migrations.mjs
 *
 * Apply pending Supabase migrations directly via pg + POSTGRES_URL_NON_POOLING.
 *
 * - Reads supabase/migrations/*.sql
 * - Queries supabase_migrations.schema_migrations to see what's applied
 * - Applies each missing migration in a single transaction
 * - Records applied version in schema_migrations after success
 *
 * Run: node --env-file=.env.local scripts/push-pending-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const dir = path.resolve("supabase/migrations");
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING/DATABASE_URL not set");
  process.exit(1);
}

// Strip sslmode from URL so our explicit ssl: {rejectUnauthorized:false} wins.
// Otherwise pg-connection-string sets ssl to strict verify-full mode and
// self-signed certs (used by Supabase poolers) are rejected.
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, "");
const client = new Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
});
await client.connect();

// Ensure schema_migrations table exists (Supabase creates it on first push)
await client.query(`
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    statements text[],
    name text
  );
`);

const { rows } = await client.query(
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
);
const applied = new Set(rows.map((r) => r.version));
console.log(`Already applied: ${rows.length} migrations`);

let appliedNow = 0;
for (const file of files) {
  // file format: 20260518000001_M01_extensions_and_helpers.sql
  const version = file.split("_")[0];
  const name = file.replace(/\.sql$/, "").substring(version.length + 1);
  if (applied.has(version)) continue;

  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  console.log(`\nApplying ${version} :: ${name} ...`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
      [version, name],
    );
    await client.query("COMMIT");
    appliedNow++;
    console.log(`  OK`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`  FAILED: ${err.message}`);
    process.exit(1);
  }
}

await client.end();
console.log(`\nDone. ${appliedNow} migration(s) applied this run.`);
