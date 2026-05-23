/**
 * One-off: aplica M28 (audit_log partition safety) sola.
 *
 * push-pending-migrations.mjs intenta aplicar M27 primero y falla porque
 * storage.objects es owned por supabase_storage_admin (no postgres). M28
 * sólo toca audit_log y no tiene esa dependencia, así que la aplicamos por
 * separado. Una vez que M27 esté aplicada manualmente vía Dashboard
 * (ver docs/audit/m27-manual-application.md), el script principal continuará
 * normal y M28 quedará como no-op idempotente.
 *
 * Uso: node --env-file=.env.local scripts/apply-m28.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const FILE = "supabase/migrations/20260524000028_M28_audit_log_partition_safety.sql";
const VERSION = "20260524000028";
const NAME = "M28_audit_log_partition_safety";

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING no seteada");
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

// ¿Ya está aplicada?
const { rows: applied } = await c.query(
  "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1",
  [VERSION],
);
if (applied.length > 0) {
  console.log(`M28 ya está aplicada (version ${VERSION}). Nada que hacer.`);
  await c.end();
  process.exit(0);
}

const sql = fs.readFileSync(path.resolve(FILE), "utf8");
console.log(`Aplicando ${VERSION} :: ${NAME} ...`);
try {
  await c.query("BEGIN");
  await c.query(sql);
  await c.query(
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
    [VERSION, NAME],
  );
  await c.query("COMMIT");
  console.log("  OK · M28 aplicada con éxito.");
} catch (err) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`  FAILED: ${err.message}`);
  process.exit(1);
}

await c.end();
