import { Client } from "pg";

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  console.log(`Tablas en public: ${r.rows.length}`);
  for (const row of r.rows) console.log(" -", row.tablename);

  const schemas = await c.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name",
  );
  console.log(`\nSchemas: ${schemas.rows.map((r) => r.schema_name).join(", ")}`);

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
