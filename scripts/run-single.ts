import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) { console.error("usage: tsx run-single.ts <file.sql>"); process.exit(1); }

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
  });
  c.on("error", (e) => console.error("client error:", e.message));
  await c.connect();
  console.log("Conectado.");
  await c.query("SET check_function_bodies = off");
  console.log("check_function_bodies = off");
  const sql = readFileSync(file, "utf8");
  console.log(`Ejecutando ${file} (${sql.length} bytes)...`);
  const start = Date.now();
  await c.query(sql);
  console.log(`OK (${Date.now() - start}ms)`);
  await c.end();
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
