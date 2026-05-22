/**
 * Apply ONLY the latest missing migrations (M19 + M20) to the live DB.
 *
 * Used when the DB was provisioned manually (not via supabase db push)
 * and the schema_migrations table is empty, but most of the schema is
 * already there. We only need the deltas after the last manual state.
 *
 * Run: node scripts/apply-missing-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const TARGETS = [
  "20260519000018_M18_whatsapp_inbound_outbound.sql",
  "20260520000019_M19_suscripcion.sql",
  "20260520000020_M20_organization_public_fields.sql",
];

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING not set");
  process.exit(1);
}
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, "");

const c = new Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
});
await c.connect();

// search_path so extensions.hmac and similar resolve
await c.query("SET search_path = public, extensions, pg_catalog");

// First, check what tables / columns we actually have
const orgCols = await c.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='organization'
   ORDER BY ordinal_position`,
);
console.log(`organization columns (${orgCols.rows.length}):`,
  orgCols.rows.map((r) => r.column_name).join(", "));

const dir = path.resolve("supabase/migrations");

for (const fname of TARGETS) {
  const full = path.join(dir, fname);
  if (!fs.existsSync(full)) { console.log(`SKIP missing file: ${fname}`); continue; }
  const sql = fs.readFileSync(full, "utf8");
  console.log(`\nApplying ${fname} ...`);
  try {
    await c.query("BEGIN");
    await c.query(sql);
    await c.query("COMMIT");
    console.log(`  OK`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`  FAILED: ${err.message}`);
    console.error(`  (continuing to next — partial state will be visible)`);
  }
}

// Verify column now exists
const after = await c.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='organization' AND column_name='onboarding_completed'`,
);
console.log(`\norganization.onboarding_completed exists?`, after.rows.length > 0 ? "YES" : "NO");

await c.end();
