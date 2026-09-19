/** Historical E2E cleanup is restricted to an explicitly named local test DB.
 * Default remains dry-run. Hosted maintenance is a separate reviewed procedure.
 * No .env files or inherited production DB variables are loaded. */
import { Client } from "pg";
import {assertLocalDatabase,isolationError} from "./testing/isolation-policy.mjs";

const LIVE = process.argv.includes("--live");
const url = process.env.FOLIO_TEST_DATABASE_URL;
if (!url) throw isolationError("Set FOLIO_TEST_DATABASE_URL to an explicitly dedicated local test database.");
assertLocalDatabase(url);
const fixtureSlug=process.env.FOLIO_TEST_BOOKING_SLUG??"folio-test-booking";
if(!/^folio-test-[a-z0-9-]+$/.test(fixtureSlug))throw isolationError("Only a named folio-test-* fixture is allowed.");

const client = new Client({
  connectionString: url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, ""),
  ssl: false,
  connectionTimeoutMillis: 30000,
});
await client.connect();
console.log(LIVE ? "⚠️  MODO LIVE — ejecutando borrados" : "DRY-RUN — solo reporte (usar --live para ejecutar)");

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

// ── 1+2. Residuo E2E en local test fixture ──────────────────────────────────────
const [org] = await q(`select id from organization where slug = $1 AND is_synthetic = true`,[fixtureSlug]);
if (org) {
  const turnosBooking = await q(
    `select t.id, t.inicio, t.estado, t.paciente_id from turno t
      where t.organization_id = $1 and t.origen = 'BOOKING'`, [org.id]);
  const colgados = await q(
    `select t.id, t.inicio, t.estado from turno t
      where t.organization_id = $1 and t.estado = 'ATENDIENDO' and t.inicio < now() - interval '1 day'`, [org.id]);
  const pedidosWeb = await q(
    `select id, estado from pedido where organization_id = $1 and canal = 'WEB'`, [org.id]);
  const jobs = await q(
    `select r.id from recordatorio_job r
      join turno t on t.id = r.turno_id
     where t.organization_id = $1 and t.origen = 'BOOKING'`, [org.id]);
  // Pacientes creados por pedidos web SIN otros turnos no-booking.
  const pacientesE2E = await q(
    `select distinct p.id, p.identidad_id from paciente p
      join pedido pe on pe.paciente_id = p.id and pe.canal = 'WEB'
     where p.organization_id = $1
       and not exists (select 1 from turno t2 where t2.paciente_id = p.id and t2.origen <> 'BOOKING')`,
    [org.id]);

  console.log(`\n[local test fixture] turnos BOOKING: ${turnosBooking.length} · pedidos WEB: ${pedidosWeb.length} · recordatorio_jobs: ${jobs.length} · pacientes E2E: ${pacientesE2E.length} · turnos ATENDIENDO colgados: ${colgados.length}`);
  for (const t of colgados) console.log(`  colgado: turno ${t.id} inicio=${t.inicio.toISOString?.() ?? t.inicio}`);

  if (LIVE) {
    await client.query("BEGIN");
    try {
      // Orden: jobs → sesiones de esos turnos no hay (BOOKING nunca atendidos) →
      // turnos → pedidos → pacientes → identidades. RLS no aplica (conexión directa).
      await client.query(
        `delete from recordatorio_job where turno_id in (select id from turno where organization_id = $1 and origen = 'BOOKING')`, [org.id]);
      // El turno colgado primero a CERRADO no — es data de test: va junto con el resto si es BOOKING;
      // si es de otro origen, lo cerramos para liberar el slot.
      await client.query(
        `update turno set estado = 'CERRADO', atendiendo_desde = null
          where organization_id = $1 and estado = 'ATENDIENDO' and origen <> 'BOOKING' and inicio < now() - interval '1 day'`, [org.id]);
      await client.query(
        `delete from turno where organization_id = $1 and origen = 'BOOKING'`, [org.id]);
      await client.query(
        `delete from pedido where organization_id = $1 and canal = 'WEB'`, [org.id]);
      const ids = pacientesE2E.map((p) => p.id);
      const idents = pacientesE2E.map((p) => p.identidad_id).filter(Boolean);
      if (ids.length) await client.query(`delete from paciente where id = any($1::uuid[])`, [ids]);
      if (idents.length) await client.query(`delete from paciente_identidad where id = any($1::uuid[])`, [idents]);
      await client.query("COMMIT");
      console.log("  [LIVE] limpieza local test fixture OK");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("  [LIVE] ROLLBACK local test fixture:", e.message);
    }
  }
}

// Bulk historical organization/user cleanup is intentionally not performed.
// This command owns only the explicitly selected synthetic local fixture.
await client.end();
console.log(LIVE ? "\nListo." : "\nDry-run completo. Nada se modificó.");
