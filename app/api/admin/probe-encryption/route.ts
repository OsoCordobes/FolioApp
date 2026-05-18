/**
 * Folio · /api/admin/probe-encryption
 *
 * Endpoint admin que diagnostica el round-trip de encriptación columnar:
 *   1. Genera un plaintext aleatorio.
 *   2. Lo encripta con encryptColumn() -> Buffer.
 *   3. Lo inserta via supabase-js en una columna bytea de prueba.
 *   4. Lo lee de vuelta.
 *   5. Reporta el formato wire (typeof, constructor, sample) que devuelve PostgREST.
 *   6. Intenta decrypt con cada estrategia de parsing posible.
 *
 * También lee profile.nombre_cifrado del usuario lautaro-folio-test@folio.app
 * y reporta su representación.
 *
 * Auth: Bearer ${CRON_SECRET}.
 *
 * NOTA: temporal. Una vez resuelto el bug de bytea-roundtrip se puede borrar.
 */

import { createDecipheriv } from "node:crypto";

import { NextResponse } from "next/server";

import { encryptColumn } from "@/lib/crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IV_LEN = 12;
const TAG_LEN = 16;
const ALG = "aes-256-gcm";

function describeWire(value: unknown): Record<string, unknown> {
  const desc: Record<string, unknown> = {
    typeof: typeof value,
    constructor: (value as { constructor?: { name?: string } })?.constructor?.name ?? null,
    isBuffer: Buffer.isBuffer?.(value) ?? false,
    isUint8Array: value instanceof Uint8Array,
    isNull: value === null,
    isUndefined: value === undefined,
  };
  if (typeof value === "string") {
    const s = value as string;
    desc.length = s.length;
    desc.first60 = s.slice(0, 60);
    desc.startsWith_backslashX = s.startsWith("\\x");
    desc.matchesHex = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  } else if (value instanceof Uint8Array) {
    desc.length = value.length;
    desc.first30hex = Buffer.from(value).subarray(0, 30).toString("hex");
  } else if (value && typeof value === "object") {
    const o = value as { type?: string; data?: unknown };
    desc.objectKeys = Object.keys(o as Record<string, unknown>);
    if (o.type === "Buffer" && Array.isArray(o.data)) {
      desc.jsonBufferDataLen = (o.data as number[]).length;
      desc.first30hex = Buffer.from(o.data as number[]).subarray(0, 30).toString("hex");
    }
  }
  return desc;
}

function tryAllDecodings(value: unknown, encKey: Buffer): Array<{ strategy: string; result: string; sample?: string }> {
  const candidates: Array<[string, Buffer]> = [];

  if (Buffer.isBuffer(value)) candidates.push(["Buffer-direct", value]);
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) candidates.push(["Uint8Array→Buffer", Buffer.from(value)]);
  if (typeof value === "string") {
    const s = value;
    if (s.startsWith("\\x")) candidates.push(["hex(\\x)", Buffer.from(s.slice(2), "hex")]);
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) candidates.push(["hex(plain)", Buffer.from(s, "hex")]);
    try { candidates.push(["base64", Buffer.from(s, "base64")]); } catch { /* skip */ }
  }
  if (value && typeof value === "object") {
    const o = value as { type?: string; data?: unknown };
    if (o.type === "Buffer" && Array.isArray(o.data)) {
      candidates.push(["JSON-Buffer", Buffer.from(o.data as number[])]);
    }
  }

  const out: Array<{ strategy: string; result: string; sample?: string }> = [];
  for (const [label, buf] of candidates) {
    if (buf.length < IV_LEN + TAG_LEN) {
      out.push({ strategy: label, result: `too-short(${buf.length})` });
      continue;
    }
    try {
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ct = buf.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv(ALG, encKey, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      out.push({ strategy: label, result: "ok", sample: pt.slice(0, 80) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ strategy: label, result: `fail:${msg}` });
    }
  }
  return out;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const encKeyRaw = process.env.FOLIO_ENC_KEY;
  if (!encKeyRaw) {
    return NextResponse.json({ ok: false, error: "FOLIO_ENC_KEY no definida" }, { status: 500 });
  }
  const encKey = Buffer.from(encKeyRaw, "base64");

  const probes: Record<string, unknown> = {
    envCheck: {
      encKeyLen: encKey.length,
      hmacKeyLen: Buffer.from(process.env.FOLIO_ENC_HMAC_KEY ?? "", "base64").length,
    },
  };

  // Probe 1: leer profile.nombre_cifrado del test user
  const { data: prof, error: profErr } = await supabase
    .from("profile")
    .select("id, email, nombre_cifrado, apellido_cifrado")
    .eq("email", "lautaro-folio-test@folio.app")
    .maybeSingle();

  if (profErr) {
    probes.profileQuery = { error: profErr.message };
  } else if (!prof) {
    probes.profileQuery = { error: "row not found" };
  } else {
    probes.profileQuery = {
      id: prof.id,
      email: prof.email,
      nombreCifrado: {
        wire: describeWire(prof.nombre_cifrado),
        decodings: tryAllDecodings(prof.nombre_cifrado, encKey),
      },
      apellidoCifrado: {
        wire: describeWire(prof.apellido_cifrado),
        decodings: tryAllDecodings(prof.apellido_cifrado, encKey),
      },
    };
  }

  // Probe 2: round-trip — encriptar plaintext conocido, insertar en organization.razon_social
  //    (columna text NULL-able existente, no requiere migrations). Esperamos que falle
  //    porque razon_social es text, no bytea — pero el comportamiento revela cómo
  //    supabase-js serializa el Buffer.
  // Mejor: usamos un INSERT directo a una tabla scratch via SQL si existe;
  // si no, hacemos round-trip sobre profile.matricula (text) usando un base64
  // del Buffer — eso prueba la API path sin tocar bytea.

  // Probe 3 (más útil): insertar otra fila profile (con UUID nuevo) y leer back.
  //    Pero profile.id es FK a auth.users — no podemos crear arbitrariamente.

  // En su lugar: leer ya existente y comparar con qué hubiera sido si se hubiera
  // escrito de cada forma posible.
  const samplePlain = "diagnostic-probe-2026";
  const sampleCipher = encryptColumn(samplePlain);
  probes.encryptSample = {
    plaintext: samplePlain,
    wire: sampleCipher,
    wireTypeof: typeof sampleCipher,
    wireLen: sampleCipher?.length ?? 0,
    startsWithBackslashX: sampleCipher?.startsWith("\\x") ?? false,
  };

  // Probe 3: round-trip real — upsert sobre profile.matricula (text) con un
  // ciphertext de prueba serializado a string `\x<hex>`. Verificar que al
  // leerlo de vuelta, decryptColumn lo procesa correctamente.
  if (prof?.id && sampleCipher) {
    const { error: upErr } = await supabase
      .from("profile")
      .update({ matricula: sampleCipher })
      .eq("id", prof.id);
    if (upErr) {
      probes.roundTripText = { error: upErr.message };
    } else {
      const { data: re } = await supabase
        .from("profile")
        .select("matricula")
        .eq("id", prof.id)
        .maybeSingle();
      probes.roundTripText = {
        sentWire: sampleCipher.slice(0, 80),
        readBack: re?.matricula?.slice(0, 80) ?? null,
        match: sampleCipher === re?.matricula,
      };
      // Cleanup: limpiar matricula para no dejar basura.
      await supabase.from("profile").update({ matricula: null }).eq("id", prof.id);
    }
  }

  return NextResponse.json({ ok: true, probes }, { status: 200 });
}
