#!/usr/bin/env node
/**
 * Folio · seed de datos MOCK para una org (demo / QA de features).
 *
 * Crea pacientes ficticios con turnos + pagos (para Finanzas y agenda) y
 * sesiones clínicas con tool_data en las TRES especialidades (quiropraxia /
 * cardiología / psicología), para poder previsualizar todas las planillas con
 * contenido usando el selector de cuenta interna. Marca todo con tag MOCK para
 * poder borrarlo en bloque.
 *
 * Reusa el MISMO crypto que la app (AES-256-GCM + HMAC blind-index per-tenant),
 * reimplementado acá para no importar lib/crypto.ts (igual que rehash-blind-indexes).
 * Conecta directo como `postgres` (POSTGRES_URL_NON_POOLING) → bypassa RLS.
 *
 * Uso:
 *   node --env-file=.env.local scripts/seed-mock-org.mjs --slug=folioasistencia
 *   node --env-file=.env.local scripts/seed-mock-org.mjs --slug=folioasistencia --force    (recrea)
 *   node --env-file=.env.local scripts/seed-mock-org.mjs --slug=folioasistencia --cleanup  (solo borra MOCK)
 *
 * Idempotente: si ya hay pacientes MOCK y no pasás --force, no hace nada.
 * Además setea organization.is_internal_account = true (habilita el selector
 * de especialidad y saltea el gate de billing).
 */

import { randomBytes, createCipheriv, createHmac } from "node:crypto";
import { Client } from "pg";

// ─── Args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const slug = argv.find((a) => a.startsWith("--slug="))?.split("=")[1] ?? "folioasistencia";
const force = argv.includes("--force");
const cleanupOnly = argv.includes("--cleanup");

// ─── Crypto (idéntico a lib/crypto.ts) ───────────────────────────────
const ALG = "aes-256-gcm";
const IV_LEN = 12;
function encKey() {
  const k = Buffer.from(process.env.FOLIO_ENC_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FOLIO_ENC_KEY ausente/!=32 bytes");
  return k;
}
function hmacKey() {
  const k = Buffer.from(process.env.FOLIO_ENC_HMAC_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FOLIO_ENC_HMAC_KEY ausente/!=32 bytes");
  return k;
}
function enc(pt) {
  if (pt === null || pt === undefined) return null;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, encKey(), iv);
  const ct = Buffer.concat([c.update(String(pt), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return "\\x" + Buffer.concat([iv, tag, ct]).toString("hex");
}
function bi(plain, salt) {
  if (plain === null || plain === undefined) return null;
  const n = String(plain).trim().toLowerCase();
  if (n === "") return null;
  const input = salt ? `${salt}:${n}` : n;
  return createHmac("sha256", hmacKey()).update(input, "utf8").digest("hex");
}
function biPhone(raw, salt) {
  if (raw === null || raw === undefined) return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length < 8) return null;
  const last10 = d.slice(-10);
  const input = salt ? `${salt}:tel:${last10}` : `tel:${last10}`;
  return createHmac("sha256", hmacKey()).update(input, "utf8").digest("hex");
}

// ─── DB ──────────────────────────────────────────────────────────────
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING / POSTGRES_URL no seteada");
  process.exit(1);
}
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/i, "").replace(/[?&]$/, "");
const client = new Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
});

// ─── Pacientes ficticios ─────────────────────────────────────────────
const PACIENTES = [
  { nombre: "María Laura", apellido: "Gómez", dni: "28456789", tel: "+54 9 351 511 2233", email: "marialaura.gomez@example.com", nac: "1986-03-12", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Cervicalgia y cefaleas tensionales.", notas: "Trabaja muchas horas frente a la computadora.", cond: "Cervicalgia" },
  { nombre: "Jorge Alberto", apellido: "Fernández", dni: "20567891", tel: "+54 9 351 522 3344", email: "jorge.fernandez@example.com", nac: "1972-07-25", sexo: "M", ciudad: "Villa Carlos Paz", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Lumbalgia mecánica crónica.", notas: "Antecedente de hernia L4-L5.", cond: "Lumbalgia" },
  { nombre: "Sofía", apellido: "Martínez", dni: "39456123", tel: "+54 9 351 533 4455", email: "sofia.martinez@example.com", nac: "1996-11-03", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Estrés y trastornos del sueño.", notas: "Derivada por su médica clínica.", cond: "Ansiedad" },
  { nombre: "Diego", apellido: "Romero", dni: "33778452", tel: "+54 9 351 544 5566", email: "diego.romero@example.com", nac: "1990-01-18", sexo: "M", ciudad: "Río Cuarto", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Control de hipertensión.", notas: "Padre con cardiopatía isquémica.", cond: "HTA" },
  { nombre: "Carolina", apellido: "López", dni: "31234987", tel: "+54 9 351 555 6677", email: "carolina.lopez@example.com", nac: "1988-09-09", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Dorsalgia y mala postura.", notas: "Practica running.", cond: "Dorsalgia" },
  { nombre: "Martín", apellido: "Díaz", dni: "27654321", tel: "+54 9 351 566 7788", email: "martin.diaz@example.com", nac: "1983-05-30", sexo: "M", ciudad: "Alta Gracia", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Palpitaciones, descartar arritmia.", notas: "Consumo de café elevado.", cond: "Palpitaciones" },
  { nombre: "Valentina", apellido: "Sánchez", dni: "40123567", tel: "+54 9 351 577 8899", email: "valentina.sanchez@example.com", nac: "1999-12-21", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Cuadro ansioso-depresivo leve.", notas: "Primer tratamiento psicológico.", cond: "Ánimo" },
  { nombre: "Pablo", apellido: "Torres", dni: "25896374", tel: "+54 9 351 588 9900", email: "pablo.torres@example.com", nac: "1979-08-14", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Ciática derecha.", notas: "Mejora con tracción.", cond: "Ciática" },
  { nombre: "Lucía", apellido: "Ramírez", dni: "34567812", tel: "+54 9 351 599 0011", email: "lucia.ramirez@example.com", nac: "1992-04-07", sexo: "F", ciudad: "Jesús María", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Seguimiento de perfil lipídico.", notas: "Dislipemia en tratamiento.", cond: "Dislipemia" },
  { nombre: "Federico", apellido: "Herrera", dni: "30985217", tel: "+54 9 351 600 1122", email: "federico.herrera@example.com", nac: "1985-10-02", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Contracturas dorsales recurrentes.", notas: "Bruxismo nocturno.", cond: "Contracturas" },
];

// ─── tool_data por especialidad (válidos contra los schemas zod) ─────
function quiroToolData() {
  return {
    v: 2,
    vista: "posterior",
    vertebras: [
      { id: "C2", tecnicaAjuste: "Toggle recoil" },
      { id: "T6", listado: "PR" },
      { id: "L4", tecnicaAjuste: "Drop", listado: "PLI" },
    ],
    palpacionEstatica: "Hipertonía paravertebral cervical baja y dorsal alta.",
    palpacionDinamica: "Restricción de movilidad en flexión L4-L5.",
    postura: {
      // Dos trazos de muestra sobre la figura (coords del viewBox 280×230):
      // línea de hombros + plomada.
      strokes: [
        [{ x: 58, y: 150 }, { x: 222, y: 150 }],
        [{ x: 140, y: 30 }, { x: 140, y: 200 }],
      ],
      nota: "Hombro derecho elevado, leve inclinación cefálica izquierda.",
    },
    legCheck: { modo: "prono_extension", pronoExtensionNota: "Pierna corta funcional derecha ~5 mm." },
    notasLibres: "Paciente refiere mejoría progresiva del dolor entre sesiones.",
  };
}
function cardioToolData(i) {
  const sis = 128 + (i % 5) * 4;
  const dia = 78 + (i % 4) * 3;
  return {
    v: 1,
    panel: {
      taSistolica: sis,
      taDiastolica: dia,
      fc: 68 + (i % 6) * 3,
      factores: { hta: i % 2 === 0, dislipemia: i % 3 === 0, sedentarismo: true, tabaquismo: i % 4 === 0 },
    },
    estudios: [
      { tipo: "ECG", fecha: "2026-05-20", hallazgos: "Ritmo sinusal, sin alteraciones agudas del ST-T.", conclusion: "normal" },
      { tipo: "Laboratorio", fecha: "2026-05-18", hallazgos: "LDL 145 mg/dl, HDL 38 mg/dl, glucemia 98.", conclusion: "requiere_seguimiento" },
    ],
  };
}
function psicoToolData(i) {
  const phq = [1, 2, 1, 0, 2, 1, 1, 0, 1].map((n) => (n + (i % 2)) % 4);
  const gad = [2, 1, 1, 0, 1, 1, 0].map((n) => (n + (i % 2)) % 4);
  return {
    v: 1,
    phq9: phq,
    gad7: gad,
    registro: { apariencia: "cuidada", animo: "ansioso", afecto: "congruente", pensamiento: "lineal", riesgo: "sin_riesgo" },
    objetivos: [
      { texto: "Reducir sintomatología ansiosa", estado: "en_curso" },
      { texto: "Mejorar higiene del sueño", estado: "en_curso" },
    ],
  };
}

const SOAP = {
  s: "Refiere evolución favorable desde la última consulta.",
  o: "Examen físico dentro de parámetros esperados para el cuadro.",
  a: "Cuadro estable, buena respuesta al plan terapéutico.",
  p: "Continuar plan; control según frecuencia indicada.",
};

// ─── Slots no solapados (turno_no_overlap_excl) ──────────────────────
// Genera (fecha, hora) únicas. Hora en ART (UTC-3) → ISO UTC = hora+3.
function* slotGen(year, monthIdx, dayFrom, dayTo, hours) {
  for (let d = dayFrom; d <= dayTo; d++) {
    for (const h of hours) {
      yield new Date(Date.UTC(year, monthIdx, d, h + 3, 0, 0)).toISOString();
    }
  }
}
const HOURS = [9, 11, 13, 15, 17];
const juneGen = slotGen(2026, 5, 1, 14, HOURS); // junio (mes actual)
const mayGen = slotGen(2026, 4, 1, 28, HOURS); // mayo
const aprilGen = slotGen(2026, 3, 1, 28, HOURS); // abril
const futureGen = slotGen(2026, 5, 16, 27, [9, 11, 15]); // próximos días de junio
const todayGen = slotGen(2026, 5, 15, 15, [9, 11, 14]); // hoy
function pop(gen) {
  const r = gen.next();
  if (r.done) throw new Error("slot pool agotado");
  return r.value;
}

const METODOS = ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "MERCADOPAGO", "OBRA_SOCIAL"];
const ORIGENES = ["MANUAL", "WALK_IN", "BOOKING"];

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  await client.connect();
  console.log(`Folio · seed-mock-org  slug=${slug}  ${cleanupOnly ? "(cleanup)" : force ? "(force)" : ""}`);
  console.log(`DB: ${cleanUrl.replace(/:[^@]+@/, ":***@")}`);

  const orgRes = await client.query("select id, nombre, especialidad, is_internal_account from organization where slug=$1 and deleted_at is null", [slug]);
  if (orgRes.rows.length === 0) throw new Error(`org slug="${slug}" no encontrada`);
  const org = orgRes.rows[0];
  const orgId = org.id;
  console.log(`org: ${org.nombre} (${orgId})  especialidad=${org.especialidad}  internal=${org.is_internal_account}`);

  // MOCK existentes
  const existing = await client.query("select id, identidad_id from paciente where organization_id=$1 and tags @> ARRAY['MOCK']", [orgId]);
  if (existing.rows.length > 0 && (force || cleanupOnly)) {
    console.log(`Borrando ${existing.rows.length} pacientes MOCK existentes…`);
    await deleteMock(orgId, existing.rows);
    console.log("MOCK previos borrados.");
  } else if (existing.rows.length > 0) {
    console.log(`Ya hay ${existing.rows.length} pacientes MOCK. Usá --force para recrear o --cleanup para borrar. Saliendo.`);
    await client.end();
    return;
  }
  if (cleanupOnly) {
    await client.end();
    return;
  }

  // owner member (profesional de los turnos/sesiones)
  const ownerRes = await client.query("select id from member where organization_id=$1 and role='OWNER' and deleted_at is null order by created_at limit 1", [orgId]);
  if (ownerRes.rows.length === 0) throw new Error("la org no tiene member OWNER");
  const memberId = ownerRes.rows[0].id;

  // servicios activos
  const servRes = await client.query("select id, nombre, duracion_min, precio_cents from servicio where organization_id=$1 and activo=true and deleted_at is null order by created_at", [orgId]);
  if (servRes.rows.length === 0) throw new Error("la org no tiene servicios activos (configurá al menos uno)");
  const servicios = servRes.rows;
  const servAt = (n) => servicios[n % servicios.length];

  // is_internal_account = true (selector + bypass billing)
  if (!org.is_internal_account) {
    await client.query("update organization set is_internal_account=true where id=$1", [orgId]);
    console.log("organization.is_internal_account → true");
  }

  let nTurnos = 0, nPagos = 0, nSesiones = 0;
  await client.query("BEGIN");
  try {
    for (let i = 0; i < PACIENTES.length; i++) {
      const p = PACIENTES[i];
      const fullName = `${p.nombre} ${p.apellido}`;
      const identRes = await client.query(
        `insert into paciente_identidad
           (organization_id, nombre_cifrado, apellido_cifrado, numero_doc_cifrado, email_cifrado, telefono_cifrado,
            tipo_doc, fecha_nacimiento, sexo_biologico, domicilio_ciudad, domicilio_provincia,
            nombre_hash, dni_hash, telefono_hash)
         values ($1,$2::bytea,$3::bytea,$4::bytea,$5::bytea,$6::bytea,$7::tipo_doc,$8::date,$9,$10,$11,$12,$13,$14)
         returning id`,
        [orgId, enc(p.nombre), enc(p.apellido), enc(p.dni), enc(p.email), enc(p.tel),
         "DNI", p.nac, p.sexo, p.ciudad, p.prov,
         bi(fullName, orgId), bi(p.dni, orgId), biPhone(p.tel, orgId)],
      );
      const identidadId = identRes.rows[0].id;

      const pacRes = await client.query(
        `insert into paciente
           (organization_id, identidad_id, motivo_consulta_cifrado, notas_importantes_cifrado, tipo, tags, profesional_principal_id)
         values ($1,$2,$3::bytea,$4::bytea,$5::tipo_paciente,$6,$7)
         returning id`,
        [orgId, identidadId, enc(p.motivo), enc(p.notas), p.tipo, ["MOCK", p.cond], memberId],
      );
      const pacienteId = pacRes.rows[0].id;

      // 3 sesiones CERRADAS, una por especialidad (junio/mayo/abril) + pago
      const sesionesPlan = [
        { tool_id: "quiropraxia.ficha.v2", data: quiroToolData(), inicio: pop(juneGen) },
        { tool_id: "cardiologia.cv.v1", data: cardioToolData(i), inicio: pop(mayGen) },
        { tool_id: "psicologia.escalas.v1", data: psicoToolData(i), inicio: pop(aprilGen) },
      ];
      for (let j = 0; j < sesionesPlan.length; j++) {
        const sp = sesionesPlan[j];
        const serv = servAt(i + j);
        const turnoId = await insertTurno({ orgId, pacienteId, serv, memberId, inicio: sp.inicio, estado: "CERRADO", origen: ORIGENES[(i + j) % ORIGENES.length] });
        await insertPago({ turnoId, monto: serv.precio_cents, metodo: METODOS[(i + j) % METODOS.length], inicio: sp.inicio });
        await insertSesion({ orgId, turnoId, pacienteId, tool_id: sp.tool_id, data: sp.data, eva_antes: 6 + (i % 4), eva_despues: 2 + (i % 3) });
        nTurnos++; nPagos++; nSesiones++;
      }

      // turno CERRADO extra en junio (sin sesión) → volumen de Finanzas
      {
        const serv = servAt(i + 1);
        const inicio = pop(juneGen);
        const turnoId = await insertTurno({ orgId, pacienteId, serv, memberId, inicio, estado: "CERRADO", origen: ORIGENES[i % ORIGENES.length] });
        await insertPago({ turnoId, monto: serv.precio_cents, metodo: METODOS[i % METODOS.length], inicio });
        nTurnos++; nPagos++;
      }

      // turno futuro (agenda): los primeros 3 hoy (CONFIRMADO), el resto próximos días (AGENDADO)
      {
        const serv = servAt(i);
        const inicio = i < 3 ? pop(todayGen) : pop(futureGen);
        const estado = i < 3 ? "CONFIRMADO" : "AGENDADO";
        await insertTurno({ orgId, pacienteId, serv, memberId, inicio, estado, origen: "MANUAL" });
        nTurnos++;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  console.log("=== seed OK ===");
  console.log(`  pacientes: ${PACIENTES.length}`);
  console.log(`  turnos: ${nTurnos}  pagos: ${nPagos}  sesiones: ${nSesiones}`);
  await client.end();
}

async function insertTurno({ orgId, pacienteId, serv, memberId, inicio, estado, origen }) {
  const duracionReal = estado === "CERRADO" ? serv.duracion_min : null;
  const r = await client.query(
    `insert into turno
       (organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado, origen, duracion_real_min)
     values ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::estado_turno,$9::origen_turno,$10)
     returning id`,
    [orgId, pacienteId, serv.id, memberId, inicio, serv.duracion_min, serv.precio_cents, estado, origen, duracionReal],
  );
  return r.rows[0].id;
}
async function insertPago({ turnoId, monto, metodo, inicio }) {
  await client.query(
    `insert into pago (turno_id, monto_cents, metodo, estado, pagado_ts, notas)
     values ($1,$2,$3::metodo_pago,'PAGADO'::estado_pago,$4::timestamptz,$5)`,
    [turnoId, monto, metodo, inicio, "Pago de muestra (MOCK)."],
  );
}
async function insertSesion({ orgId, turnoId, pacienteId, tool_id, data, eva_antes, eva_despues }) {
  await client.query(
    `insert into sesion
       (organization_id, turno_id, paciente_id, soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado,
        eva_antes, eva_despues, tool_id, tool_data_cifrado, vertebras_json)
     values ($1,$2,$3,$4::bytea,$5::bytea,$6::bytea,$7::bytea,$8,$9,$10,$11::bytea,$12::jsonb)`,
    [orgId, turnoId, pacienteId, enc(SOAP.s), enc(SOAP.o), enc(SOAP.a), enc(SOAP.p),
     eva_antes, eva_despues, tool_id, enc(JSON.stringify(data)), "[]"],
  );
}

async function deleteMock(orgId, rows) {
  const ids = rows.map((r) => r.id);
  const identIds = rows.map((r) => r.identidad_id).filter(Boolean);
  await client.query("BEGIN");
  try {
    await client.query("delete from sesion where paciente_id = ANY($1::uuid[])", [ids]);
    await client.query("delete from pago where turno_id in (select id from turno where paciente_id = ANY($1::uuid[]))", [ids]);
    await client.query("delete from turno where paciente_id = ANY($1::uuid[])", [ids]);
    await client.query("delete from paciente where id = ANY($1::uuid[])", [ids]);
    if (identIds.length) await client.query("delete from paciente_identidad where id = ANY($1::uuid[])", [identIds]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

try {
  await main();
  process.exit(0);
} catch (e) {
  console.error("FATAL:", e.message);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
}
