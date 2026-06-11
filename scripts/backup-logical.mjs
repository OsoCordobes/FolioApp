/**
 * scripts/backup-logical.mjs
 *
 * Backup lógico de emergencia (plan Supabase FREE = sin backups automáticos).
 * Vuelca cada tabla de los schemas public + analytics a JSON, FUERA del repo
 * (la carpeta destino contiene PHI cifrada y PII — jamás commitearla).
 *
 * Run: node scripts/backup-logical.mjs
 * Destino: %USERPROFILE%\folio-backups\<timestamp>\<schema>.<tabla>.json
 *
 * NO reemplaza un backup real (sin DDL, sin secuencias, sin storage). Es la
 * red mínima hasta que el proyecto pase a plan Pro. Restore: scripts ad-hoc
 * por tabla (los datos cifrados son bytea → se serializan base64).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING/DATABASE_URL not set");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(os.homedir(), "folio-backups", stamp);
fs.mkdirSync(outDir, { recursive: true });

const cleanUrl = url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, "");
const client = new Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await client.connect();

const { rows: tables } = await client.query(`
  select table_schema, table_name
    from information_schema.tables
   where table_schema in ('public', 'analytics')
     and table_type = 'BASE TABLE'
   order by table_schema, table_name
`);

let total = 0;
for (const t of tables) {
  const fq = `"${t.table_schema}"."${t.table_name}"`;
  const { rows } = await client.query(`select * from ${fq}`);
  const file = path.join(outDir, `${t.table_schema}.${t.table_name}.json`);
  // bytea llega como Buffer → base64 para que JSON.stringify no lo destruya.
  const serializable = rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = Buffer.isBuffer(v) ? { __bytea_base64: v.toString("base64") } : v;
    }
    return out;
  });
  fs.writeFileSync(file, JSON.stringify(serializable));
  total += rows.length;
  console.log(`${fq}: ${rows.length} filas`);
}

// El ledger de migraciones también (para saber contra qué schema restaurar).
const { rows: ledger } = await client.query(
  "select version, name from supabase_migrations.schema_migrations order by version",
);
fs.writeFileSync(path.join(outDir, "_schema_migrations.json"), JSON.stringify(ledger));

await client.end();
console.log(`\nBackup: ${tables.length} tablas, ${total} filas → ${outDir}`);
