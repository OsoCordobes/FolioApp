import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const realRequire = createRequire(import.meta.url);
const orgId = "12700000-0000-4000-8000-000000000010";
const memberId = "12700000-0000-4000-8000-000000000011";
const userId = "12700000-0000-4000-8000-000000000001";

test("editor fields and CAS revisions come from the same row reads, not stale context", async () => {
  const org = {
    nombre: "Nombre nuevo", bio: "Bio nueva", ciudad: "Rosario", provincia: "Santa Fe",
    acento_hex: "#123456", timezone: "America/Argentina/Buenos_Aires", especialidad: "nutricion",
    telefono_publico: "341123", direccion_completa: "Calle nueva", instagram_handle: "folio",
    updated_at: "2026-09-20T00:00:10Z", auto_confirmar_reservas: true, slot_margen_min: 0,
    logo_url: null, card_mood: "editorial",
  };
  const profile = {
    email: "nuevo@example.invalid", nombre_cifrado: "enc:Ana", apellido_cifrado: "enc:Nueva",
    matricula: "MN nueva", updated_at: "2026-09-20T00:00:11Z",
  };
  const client = {
    from: (table: string) => {
      const result = table === "organization" ? { data: org, error: null } :
        table === "profile" ? { data: profile, error: null } :
          table === "integration" ? { data: null, error: null } : { data: [], error: null };
      const query = {
        select: () => query, eq: () => query, order: () => query,
        maybeSingle: async () => result,
        then: (resolveResult: (value: unknown) => unknown) => Promise.resolve(result).then(resolveResult),
      };
      return query;
    },
    rpc: async () => ({ data: {}, error: null }),
  };
  const mocks: Record<string, unknown> = {
    "@/lib/crypto": { decryptColumn: (value: string) => value.replace(/^enc:/, "") },
    "@/lib/db/members": { listProfesionalesPublico: async () => ({ ok: true, data: [] }) },
    "@/lib/agenda/availability-snapshot": { decodeAvailabilitySnapshot: (_raw: unknown, expected: unknown) => ({
      context: { ...(expected as object), revision: 1, protectedDates: false }, dias: {},
    }) },
    "@/lib/especialidades/meta": { ESPECIALIDAD_SLUGS: ["quiropraxia", "nutricion"],
      normalizeEspecialidadSlug: (value: string) => value },
    "@/lib/google/health": { esIntegracionMuerta: () => false },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "./active-context": { getActiveContext: async () => ({ ok: true, data: {
      session: { userId, memberId },
      organization: { id: orgId, slug: "folio", tipo: "INDEPENDIENTE", rubro: "salud",
        nombre: "Nombre viejo", ciudad: "Córdoba", provincia: "Córdoba", timezone: "America/Argentina/Cordoba",
        acentoHex: "#999999", especialidad: "quiropraxia" },
      profile: { nombre: "Ana", apellido: "Vieja", matricula: "MN vieja", email: "viejo@example.invalid" },
    } }) },
    "./errors": { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }) },
  };
  const exports: Record<string, () => Promise<{ ok: boolean; data: { consultorio: Record<string, unknown> } }>> = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/db/configuracion.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] :
    realRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith("./") ? resolve("lib/db", name) : name) });
  const result = await exports.getConfiguracionData();
  assert.equal(result.ok, true);
  const c = result.data.consultorio;
  assert.equal(c.nombre, org.nombre);
  assert.equal(c.organizationUpdatedAt, org.updated_at);
  assert.equal(c.profesional, "Ana Nueva");
  assert.equal(c.matricula, profile.matricula);
  assert.equal(c.profileUpdatedAt, profile.updated_at);
  assert.equal(c.especialidad, "nutricion");
});
