#!/usr/bin/env node
/**
 * Folio · Rehash de blind indexes con salt per-tenant (audit A2 · Sprint 1 T1.5.4).
 *
 * Pre-condiciones:
 *   - El código que escribe nuevos hashes con salt ya está deployed (T1.5.3).
 *   - El código de lectura tiene fallback legacy (T1.5.3).
 *   - Backup PITR de Supabase confirmado.
 *   - Ventana de baja actividad (madrugada típicamente).
 *
 * Uso:
 *   node --env-file=.env.local scripts/rehash-blind-indexes.mjs --dry-run
 *   node --env-file=.env.local scripts/rehash-blind-indexes.mjs --verify
 *   node --env-file=.env.local scripts/rehash-blind-indexes.mjs --live
 *
 * Modos:
 *   --dry-run : lee, desencripta, calcula los hashes nuevos, loggea cuántos
 *               cambiarían pero NO escribe a la DB. Mandatory antes de --live.
 *   --verify  : selecciona 5 pacientes aleatorios, desencripta, recalcula los
 *               3 hashes con salt esperado, compara con la DB. Si todos
 *               coinciden → el rehash ya está aplicado (idempotente).
 *   --live    : actualiza la DB. Batches de 500 dentro de transaction por org.
 *               Logging por paciente, stats finales.
 *
 * Idempotente: si todos los hashes ya están con salt, sale en O(N) lectura
 * sin escrituras.
 *
 * Rollback: restore de PITR (Supabase Pro). Las migrations son DDL puro y
 * los datos cifrados (que SÍ tienen los plaintexts originales) están intactos.
 */

import { createDecipheriv, createHmac } from "node:crypto";
import { Client } from "pg";

// ─── Args parsing ────────────────────────────────────────────────────

const MODES = ["--dry-run", "--verify", "--live"];
const mode = process.argv.find((a) => MODES.includes(a));
if (!mode) {
  console.error(`Uso: ${process.argv[1]} [${MODES.join("|")}]`);
  process.exit(1);
}

// ─── Crypto helpers (reimplementados acá para evitar import de lib/crypto.ts) ─

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncKey() {
  const raw = process.env.FOLIO_ENC_KEY;
  if (!raw) throw new Error("FOLIO_ENC_KEY no seteada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`FOLIO_ENC_KEY debe ser 32 bytes (recibido ${key.length})`);
  return key;
}

function getHmacKey() {
  const raw = process.env.FOLIO_ENC_HMAC_KEY;
  if (!raw) throw new Error("FOLIO_ENC_HMAC_KEY no seteada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`FOLIO_ENC_HMAC_KEY debe ser 32 bytes (recibido ${key.length})`);
  return key;
}

function blindIndex(plain, salt) {
  if (plain === null || plain === undefined) return null;
  const normalized = plain.trim().toLowerCase();
  if (normalized === "") return null;
  const input = salt ? `${salt}:${normalized}` : normalized;
  return createHmac("sha256", getHmacKey()).update(input, "utf8").digest("hex");
}

function blindIndexPhone(rawPhone, salt) {
  if (rawPhone === null || rawPhone === undefined) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const last10 = digits.slice(-10);
  const input = salt ? `${salt}:tel:${last10}` : `tel:${last10}`;
  return createHmac("sha256", getHmacKey()).update(input, "utf8").digest("hex");
}

// ─── DB connection ──────────────────────────────────────────────────

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

function decryptColumnSync(value) {
  if (value === null || value === undefined) return null;
  let buf;
  if (Buffer.isBuffer(value)) buf = value;
  else if (typeof value === "string" && value.startsWith("\\x")) buf = Buffer.from(value.slice(2), "hex");
  else if (typeof value === "string") buf = Buffer.from(value, "base64");
  else return null;
  if (buf.length < IV_LEN + TAG_LEN) return null;
  try {
    const iv = buf.subarray(0, IV_LEN);
    const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, getEncKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (e) {
    console.warn(`  [decrypt error]: ${e.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function listOrgs() {
  const { rows } = await client.query(
    "SELECT id, slug FROM organization WHERE deleted_at IS NULL ORDER BY created_at ASC",
  );
  return rows;
}

async function listPacientesForOrg(orgId) {
  const { rows } = await client.query(
    `SELECT id, organization_id,
            nombre_cifrado, apellido_cifrado,
            numero_doc_cifrado, telefono_cifrado,
            nombre_hash, dni_hash, telefono_hash
       FROM paciente_identidad
      WHERE organization_id = $1
      ORDER BY created_at ASC`,
    [orgId],
  );
  return rows;
}

function computeExpectedHashes(p) {
  const nombre = decryptColumnSync(p.nombre_cifrado);
  const apellido = decryptColumnSync(p.apellido_cifrado);
  const dni = decryptColumnSync(p.numero_doc_cifrado);
  const telefono = decryptColumnSync(p.telefono_cifrado);

  // Safety: si CUALQUIER decrypt esperado falla (la columna existía pero el
  // resultado es null), abortar. Significa que la FOLIO_ENC_KEY corriendo
  // no es la que cifró estos datos. Sin esto, escribiríamos hashes basados
  // en null plaintexts y corromperíamos los blind indexes.
  const expectedDecryptable = {
    nombre: p.nombre_cifrado !== null,
    apellido: p.apellido_cifrado !== null,
    dni: p.numero_doc_cifrado !== null,
    telefono: p.telefono_cifrado !== null,
  };
  const decryptedActual = { nombre, apellido, dni, telefono };
  for (const [field, expected] of Object.entries(expectedDecryptable)) {
    if (expected && decryptedActual[field] === null) {
      return { ok: false, reason: `decrypt failed for ${field} (key mismatch?)` };
    }
  }

  const fullName = nombre && apellido ? `${nombre} ${apellido}` : (nombre ?? apellido ?? null);
  return {
    ok: true,
    hashes: {
      nombre_hash: blindIndex(fullName, p.organization_id),
      dni_hash: blindIndex(dni, p.organization_id),
      telefono_hash: blindIndexPhone(telefono, p.organization_id),
    },
  };
}

async function runDryRun() {
  const orgs = await listOrgs();
  let total = 0;
  let wouldUpdate = 0;
  let alreadySalted = 0;
  let decryptFailed = 0;
  const failures = [];
  for (const org of orgs) {
    const pacientes = await listPacientesForOrg(org.id);
    for (const p of pacientes) {
      total++;
      const result = computeExpectedHashes(p);
      if (!result.ok) {
        decryptFailed++;
        failures.push({ id: p.id, org: org.slug, reason: result.reason });
        continue;
      }
      const matches =
        p.nombre_hash === result.hashes.nombre_hash &&
        p.dni_hash === result.hashes.dni_hash &&
        p.telefono_hash === result.hashes.telefono_hash;
      if (matches) {
        alreadySalted++;
      } else {
        wouldUpdate++;
      }
    }
  }
  console.log("=== DRY RUN summary ===");
  console.log(`  orgs procesadas: ${orgs.length}`);
  console.log(`  pacientes totales: ${total}`);
  console.log(`  ya tienen hashes con salt: ${alreadySalted}`);
  console.log(`  serían actualizados: ${wouldUpdate}`);
  console.log(`  decrypt FAILED (key mismatch?): ${decryptFailed}`);
  if (failures.length > 0) {
    console.log("");
    console.log("ADVERTENCIA: algunos pacientes fallaron decrypt. Causas posibles:");
    console.log("  - FOLIO_ENC_KEY del entorno actual NO coincide con la que cifró esos datos.");
    console.log("  - Datos cifrados con una versión previa del schema/formato.");
    console.log("");
    console.log("NO correr --live hasta resolver. Ejemplos:");
    for (const f of failures.slice(0, 5)) {
      console.log(`  paciente ${f.id.slice(0, 8)}… org ${f.org}: ${f.reason}`);
    }
    process.exitCode = 2;
  }
}

async function runVerify() {
  const { rows } = await client.query(
    `SELECT id, organization_id,
            nombre_cifrado, apellido_cifrado,
            numero_doc_cifrado, telefono_cifrado,
            nombre_hash, dni_hash, telefono_hash
       FROM paciente_identidad
      ORDER BY random()
      LIMIT 5`,
  );
  if (rows.length === 0) {
    console.log("=== VERIFY ===");
    console.log("  No hay pacientes en la DB. Nada que verificar.");
    return;
  }
  let allMatch = true;
  let decryptFailed = 0;
  for (const p of rows) {
    const result = computeExpectedHashes(p);
    if (!result.ok) {
      decryptFailed++;
      console.log(`  paciente ${p.id.slice(0, 8)}… org ${p.organization_id.slice(0, 8)}…: ${result.reason}`);
      continue;
    }
    const matches =
      p.nombre_hash === result.hashes.nombre_hash &&
      p.dni_hash === result.hashes.dni_hash &&
      p.telefono_hash === result.hashes.telefono_hash;
    console.log(`  paciente ${p.id.slice(0, 8)}… org ${p.organization_id.slice(0, 8)}…: ${matches ? "OK" : "MISMATCH"}`);
    if (!matches) {
      allMatch = false;
      if (p.nombre_hash !== result.hashes.nombre_hash) console.log(`    nombre_hash mismatch`);
      if (p.dni_hash !== result.hashes.dni_hash) console.log(`    dni_hash mismatch`);
      if (p.telefono_hash !== result.hashes.telefono_hash) console.log(`    telefono_hash mismatch`);
    }
  }
  console.log("=== VERIFY summary ===");
  if (decryptFailed > 0) {
    console.log(`  ${decryptFailed}/${rows.length} pacientes con decrypt failed — FOLIO_ENC_KEY mismatch?`);
    process.exitCode = 2;
  } else {
    console.log(`  ${rows.length} pacientes random verificados, ${allMatch ? "TODOS coinciden (rehash aplicado)" : "hay MISMATCHES (rehash pendiente o legacy)"}`);
    if (!allMatch) process.exitCode = 1;
  }
}

async function runLive() {
  // Pre-flight: corre dry-run logic primero para detectar decrypt failures
  // antes de tocar la DB. Si hay decrypt failures, --live aborta sin escribir
  // (safety: no podemos confiar en hashes basados en null plaintext).
  const orgs = await listOrgs();
  let preflightFailed = 0;
  for (const org of orgs) {
    const pacientes = await listPacientesForOrg(org.id);
    for (const p of pacientes) {
      const result = computeExpectedHashes(p);
      if (!result.ok) preflightFailed++;
    }
  }
  if (preflightFailed > 0) {
    console.error(`PREFLIGHT FAILED: ${preflightFailed} pacientes con decrypt error. NO se ejecuta --live.`);
    console.error("Causa probable: FOLIO_ENC_KEY del entorno actual NO coincide con la que cifró los datos.");
    console.error("Correr --dry-run para ver detalle, después correr --live con las envs correctas.");
    process.exit(2);
  }

  let total = 0;
  let updated = 0;
  let unchanged = 0;
  const BATCH = 500;
  for (const org of orgs) {
    const pacientes = await listPacientesForOrg(org.id);
    console.log(`org ${org.slug} (${org.id.slice(0, 8)}…): ${pacientes.length} pacientes`);
    for (let i = 0; i < pacientes.length; i += BATCH) {
      const batch = pacientes.slice(i, i + BATCH);
      await client.query("BEGIN");
      try {
        for (const p of batch) {
          total++;
          const result = computeExpectedHashes(p);
          // Preflight ya validó esto, pero defensa en profundidad.
          if (!result.ok) {
            throw new Error(`paciente ${p.id}: ${result.reason}`);
          }
          const matches =
            p.nombre_hash === result.hashes.nombre_hash &&
            p.dni_hash === result.hashes.dni_hash &&
            p.telefono_hash === result.hashes.telefono_hash;
          if (matches) {
            unchanged++;
            continue;
          }
          await client.query(
            `UPDATE paciente_identidad
                SET nombre_hash = $2,
                    dni_hash = $3,
                    telefono_hash = $4
              WHERE id = $1`,
            [p.id, result.hashes.nombre_hash, result.hashes.dni_hash, result.hashes.telefono_hash],
          );
          updated++;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`  batch ${i} ROLLBACK: ${e.message}`);
        throw e;
      }
    }
  }
  console.log("=== LIVE summary ===");
  console.log(`  orgs procesadas: ${orgs.length}`);
  console.log(`  pacientes totales: ${total}`);
  console.log(`  unchanged (ya con salt): ${unchanged}`);
  console.log(`  updated: ${updated}`);
}

// ─── Entry point ─────────────────────────────────────────────────────

try {
  await client.connect();
  console.log(`Folio · rehash-blind-indexes ${mode}`);
  console.log(`DB: ${cleanUrl.replace(/:[^@]+@/, ":***@")}`);
  if (mode === "--dry-run") await runDryRun();
  else if (mode === "--verify") await runVerify();
  else if (mode === "--live") await runLive();
  await client.end();
  process.exit(0);
} catch (e) {
  console.error("FATAL:", e.message);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
}
