/**
 * scripts/cleanup-e2e.mjs — limpieza del residuo de tests E2E en prod.
 *
 * Identificado en la re-auditoría 2026-06-12 (autocrítica):
 *   1. En la org de pruebas `lautaro-folio`: turnos origen BOOKING creados por
 *      los specs E2E (+ sus pedidos WEB, recordatorio_jobs pendientes y los
 *      pacientes/identidades creados por esos pedidos, si no tienen otros
 *      turnos).
 *   2. Turno colgado en ATENDIENDO desde el 18-may en esa org (ocupa el slot
 *      vía M40/slot_ocupado para siempre).
 *   3. Orgs `e2e-test-*` (~30) con sus auth.users — crecen con cada corrida
 *      del spec de auth.
 *   4. Orgs `guestuserome*` sin members (bootstraps a medias) — solo reporte.
 *
 * USO:
 *   node scripts/cleanup-e2e.mjs                        ← DRY-RUN (default)
 *   node scripts/cleanup-e2e.mjs --live --solo-folio    ← limpia SOLO lautaro-folio
 *   node scripts/cleanup-e2e.mjs --live                 ← todo (purge e2e-test-* + users)
 *   Correr backup-logical.mjs ANTES de cualquier --live.
 *
 * Conexión: POSTGRES_URL_NON_POOLING de .env.local (igual que los demás scripts).
 */
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const LIVE = process.argv.includes("--live");
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) { console.error("POSTGRES_URL_NON_POOLING/DATABASE_URL no seteada"); process.exit(1); }

const client = new Client({
  connectionString: url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, ""),
  // rejectUnauthorized:false = excepción documentada del repo (known-gaps.md
  // A1: pooler de Supabase con cert self-signed; threat model aceptado, mismo
  // patrón que diff-migrations.mjs/push-pending-migrations.mjs). Fix de fondo
  // pendiente: CA de Supabase en el trust store de los scripts.
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await client.connect();
console.log(LIVE ? "⚠️  MODO LIVE — ejecutando borrados" : "DRY-RUN — solo reporte (usar --live para ejecutar)");

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

// ── 1+2. Residuo E2E en lautaro-folio ──────────────────────────────────────
const [org] = await q(`select id from organization where slug = 'lautaro-folio'`);
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

  console.log(`\n[lautaro-folio] turnos BOOKING: ${turnosBooking.length} · pedidos WEB: ${pedidosWeb.length} · recordatorio_jobs: ${jobs.length} · pacientes E2E: ${pacientesE2E.length} · turnos ATENDIENDO colgados: ${colgados.length}`);
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
      console.log("  [LIVE] limpieza lautaro-folio OK");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("  [LIVE] ROLLBACK lautaro-folio:", e.message);
    }
  }
}

// ── 3. Orgs e2e-test-* ──────────────────────────────────────────────────────
const e2eOrgs = await q(
  `select o.id, o.slug, (select count(*) from member m where m.organization_id = o.id) as members
     from organization o where o.slug like 'e2e-test-%'`);
const e2eUsers = await q(
  `select distinct u.id, u.email from auth.users u where u.email like 'e2e-test-%'`);
console.log(`\n[e2e-test-*] orgs: ${e2eOrgs.length} · auth.users: ${e2eUsers.length}`);

const SOLO_FOLIO = process.argv.includes("--solo-folio");
if (LIVE && SOLO_FOLIO && e2eOrgs.length) {
  console.log("  (--solo-folio: purge de e2e-test-* OMITIDO — requiere --live sin el flag)");
}
if (LIVE && !SOLO_FOLIO && e2eOrgs.length) {
  await client.query("BEGIN");
  try {
    // organization ON DELETE CASCADE arrastra member/servicio/turno/etc.
    await client.query(`delete from organization where slug like 'e2e-test-%'`);
    // profile/auth.users de esos emails (profile.id = auth.users.id).
    await client.query(`delete from profile where email like 'e2e-test-%'`);
    await client.query(`delete from auth.users where email like 'e2e-test-%'`);
    await client.query("COMMIT");
    console.log("  [LIVE] purge e2e-test-* OK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("  [LIVE] ROLLBACK e2e-test-*:", e.message);
  }
}

// ── 4. guestuserome sin members (solo reporte) ─────────────────────────────
const guest = await q(
  `select o.id, o.slug, (select count(*) from member m where m.organization_id = o.id) as members
     from organization o where o.slug like 'guestuserome%'`);
console.log(`\n[guestuserome*] ${guest.map((g) => `${g.slug}(members=${g.members})`).join(" · ") || "ninguna"}`);
console.log("  (sin acción automática — revisar por qué el bootstrap quedó a medias)");

await client.end();
console.log(LIVE ? "\nListo." : "\nDry-run completo. Nada se modificó.");
