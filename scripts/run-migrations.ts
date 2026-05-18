/**
 * Folio · runner de migrations + seeds para Supabase.
 *
 * Uso: pnpm exec tsx scripts/run-migrations.ts
 * Requiere: DATABASE_URL en env (direct connection, no pooler).
 *
 * Ejecuta en orden los .sql de supabase/migrations/ luego los de supabase/seed/.
 * Idempotente para los seeds (usan ON CONFLICT DO UPDATE).
 * Las migrations NO son idempotentes — si falla a mitad, hay que dropear el
 * schema public y reintentar.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL en env.");
  process.exit(1);
}

async function runFiles(client: Client, dir: string, label: string): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  console.log(`\n=== ${label} (${files.length}) ===`);
  for (const file of files) {
    const start = Date.now();
    const sql = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`  ${file} (${sql.length} bytes) ... `);
    try {
      await client.query(sql);
      console.log(`OK (${Date.now() - start}ms)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL (${Date.now() - start}ms)`);
      console.error(`    -> ${msg}`);
      throw e;
    }
  }
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
  });
  client.on("error", (e) => console.error("client error:", e.message));
  await client.connect();
  console.log("Conectado a:", DATABASE_URL.replace(/:[^:@]+@/, ":****@"));

  try {
    // Diferir validación de SQL function bodies para permitir forward refs
    // entre migrations (ej: M01 helpers referencian tablas de M02).
    await client.query("SET check_function_bodies = off");
    await runFiles(client, "supabase/migrations", "Migrations");
    await client.query("SET check_function_bodies = on");
    await runFiles(client, "supabase/seed", "Seeds");
  } finally {
    await client.end();
  }

  console.log("\nListo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
