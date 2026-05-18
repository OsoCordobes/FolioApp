/**
 * Folio · /api/admin/migrate
 *
 * Endpoint admin one-shot que aplica las migrations + seeds bundled en
 * `supabase/{migrations,seed}/*.sql` al Postgres de Supabase. Se usa cuando
 * no podemos correr `supabase db push` desde local (ej. password del proyecto
 * vive solo en Vercel-integration, sin export al CLI).
 *
 * Auth: Bearer ${CRON_SECRET}.
 *
 * Modos (?mode=):
 *   - all (default): migrations en orden, luego seeds en orden.
 *   - migrations: solo migrations.
 *   - seeds: solo seeds.
 *
 * Las migrations NO son idempotentes (CREATE TABLE / CREATE TYPE fallan en re-run).
 * Los seeds sí son idempotentes (usan ON CONFLICT DO UPDATE).
 *
 * Connection: prefiere POSTGRES_URL_NON_POOLING (direct, 5432) porque las
 * migrations corren múltiples statements pesados y el transaction pooler corta.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { Client } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SEED_DIR = path.join(process.cwd(), "supabase", "seed");

interface FileResult {
  file: string;
  ok: boolean;
  ms: number;
  bytes: number;
  error?: string;
}

async function listSql(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

async function runFiles(client: Client, dir: string, label: string, fromPrefix?: string | null): Promise<FileResult[]> {
  const results: FileResult[] = [];
  let files = await listSql(dir);
  if (fromPrefix) {
    files = files.filter((f) => f >= fromPrefix);
  }
  for (const file of files) {
    const start = Date.now();
    const sql = await readFile(path.join(dir, file), "utf8");
    try {
      await client.query(sql);
      results.push({ file: `${label}/${file}`, ok: true, ms: Date.now() - start, bytes: sql.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ file: `${label}/${file}`, ok: false, ms: Date.now() - start, bytes: sql.length, error: msg });
      throw new MigrationError(results);
    }
  }
  return results;
}

class MigrationError extends Error {
  constructor(public results: FileResult[]) {
    super(results[results.length - 1]?.error ?? "migration failed");
  }
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "all";
  const reset = url.searchParams.get("reset") === "true";
  // `from` = prefijo del filename a partir del cual correr migrations (incluyente).
  // Útil para forward-fix sin tirar todas las migrations ya aplicadas.
  // Ej: ?from=20260519 → aplica solo migrations >= esa fecha.
  const fromPrefix = url.searchParams.get("from");
  if (!["all", "migrations", "seeds"].includes(mode)) {
    return NextResponse.json({ ok: false, error: "mode debe ser all|migrations|seeds" }, { status: 400 });
  }

  const rawDsn = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!rawDsn) {
    return NextResponse.json(
      { ok: false, error: "falta POSTGRES_URL_NON_POOLING / POSTGRES_URL" },
      { status: 500 },
    );
  }

  // El cert de Supabase es self-signed para el chain de Vercel.
  // Forzamos sslmode=no-verify para evitar "self-signed certificate in certificate chain".
  const dsn = (() => {
    const u = new URL(rawDsn);
    u.searchParams.set("sslmode", "no-verify");
    return u.toString();
  })();

  const client = new Client({
    connectionString: dsn,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
  });

  const all: FileResult[] = [];
  try {
    await client.connect();

    if (reset) {
      // Drop+recreate schemas que crean las migrations. Solo seguro en bootstrap
      // inicial — destructivo. Reset ahora también limpia el schema `analytics`
      // (creado por M15).
      await client.query("DROP SCHEMA IF EXISTS analytics CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO postgres");
      await client.query("GRANT ALL ON SCHEMA public TO public");
      // Grants de Supabase: anon (público), authenticated (JWT user), service_role
      // (bypass RLS). Esto es lo que Supabase hace por default al crear el proyecto;
      // el DROP CASCADE los borró así que los restauramos.
      await client.query("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role");
      await client.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role
      `);
      await client.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role
      `);
      await client.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role
      `);
    }

    await client.query("SET check_function_bodies = off");

    if (mode === "all" || mode === "migrations") {
      all.push(...(await runFiles(client, MIGRATIONS_DIR, "migrations", fromPrefix)));
    }
    if (mode === "all" || mode === "seeds") {
      // `from` no aplica a seeds (seeds son idempotentes).
      all.push(...(await runFiles(client, SEED_DIR, "seeds")));
    }

    // Re-grant sobre TODAS las tablas/funciones/secuencias creadas por las
    // migrations (ALTER DEFAULT PRIVILEGES solo aplica a objetos NUEVOS post-set).
    await client.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role");
    await client.query("GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role");
    await client.query("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role");

    await client.query("SET check_function_bodies = on");

    return NextResponse.json({
      ok: true,
      mode,
      totalMs: all.reduce((s, r) => s + r.ms, 0),
      files: all,
    });
  } catch (e) {
    const partial = e instanceof MigrationError ? e.results : all;
    const lastErr = partial[partial.length - 1];
    return NextResponse.json(
      {
        ok: false,
        mode,
        failedAt: lastErr?.file,
        error: lastErr?.error ?? (e instanceof Error ? e.message : String(e)),
        files: partial,
      },
      { status: 500 },
    );
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

export async function GET(req: Request) {
  return POST(req);
}
