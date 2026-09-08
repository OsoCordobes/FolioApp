import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { capabilitiesFor, type Role } from "../../lib/auth/capabilities";
import { canExportCompleteClinicalHistory, COMPLETE_HISTORY_PERMISSION_MESSAGE } from "../../lib/auth/clinical-export-scope";
import { err, ok } from "../../lib/db/errors";
import { evolucionValidada } from "../../lib/pdf/ficha-format";
import { readPdfCollection } from "../../lib/pdf/history-reader";
import type { FichaPdfData } from "../../lib/pdf/ficha-pdf";

const patient = "11600000-0000-4000-8000-000000000002", sessionId = "11600000-0000-4000-8000-000000000003";
const org = "11600000-0000-4000-8000-000000000001";
type Options = {
  failHistory?: boolean; revoked?: boolean; role?: Role; colegiado?: boolean;
  revokeSession?: boolean; revokeColegiado?: boolean; revokePatient?: boolean;
  mfaInitial?: boolean; mfaFinal?: boolean; failInstruments?: boolean; mismatch?: boolean;
  failRender?: boolean; oversize?: boolean;
};

function fixture(options: Options = {}) {
  let reads = 0, patientReads = 0, prepared = false;
  let rendered: FichaPdfData | undefined;
  const audits: Record<string, unknown>[] = [];
  const original = { role: options.role ?? "OWNER", esColegiado: options.colegiado ?? true,
    memberId: "member", userId: "user", organizationId: org };
  const historyRow = (id: string) => ({ sesionId: id, toolId: "quiropraxia.ficha.v2", fecha: "2026-09-07", servicio: "Consulta",
    resumen: `Original ${id}`, soap: { s: `SOAP ${id}`, o: "", a: "", p: "" }, notas: `Nota ${id}`,
    profesionalId: "treating-professional", lockedAt: "2026-09-08T12:00:00Z",
    enmiendas: [{ id: `e-${id}`, autorId: "original-author", createdAt: "2026-09-08T12:00:00Z", motivo: "Corrección", texto: `Enmienda ${id}` }] });
  const all = Array.from({ length: 62 }, (_, i) => historyRow(`s${i}`));
  const client = { from(table: string) {
    let ids: string[] = [];
    const q = {
      select() { return q; }, eq() { return q; }, order() { return q; },
      in(_key: string, value: string[]) { ids = value; return q; }, range() { return q; },
      maybeSingle() { return Promise.resolve({ data: prepared && (options.revokePatient || (table === "sesion" && options.revokeSession)) ? null
        : table === "sesion" ? { id: sessionId, paciente_id: patient, organization_id: org } : { id: patient, organization_id: org }, error: null }); },
      then(resolve: (result: unknown) => unknown) {
        const rows = table === "sesion" && !(prepared && options.revokeSession) ? ids.map(id => ({ id })) : [];
        return Promise.resolve(resolve({ data: rows, count: rows.length, error: null }));
      },
    };
    return q;
  } };
  class NextResponse extends Response { static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); } }
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse }, "next/headers": { headers: async () => new Headers() },
    "@/lib/auth/capabilities": { capabilitiesFor },
    "@/lib/auth/clinical-export-scope": { canExportCompleteClinicalHistory, COMPLETE_HISTORY_PERMISSION_MESSAGE },
    "@/lib/db/errors": { err, ok },
    "@/lib/db/active-context": { getActiveContext: async () => options.mfaInitial ? err("mfa_required", "MFA requerida") : ok({ session: original,
      organization: { id: org, especialidad: "quiropraxia", nombre: "Sintético", timezone: "America/Argentina/Cordoba" },
      profile: { nombre: "Test", apellido: "User", matricula: null } }) },
    "@/lib/db/session": { getActiveSession: async () => prepared && options.mfaFinal ? err("mfa_required", "MFA requerida") : ok({ ...original,
      role: prepared && options.revoked ? "ASISTENTE" : original.role, esColegiado: prepared && options.revokeColegiado ? false : original.esColegiado }) },
    "@/lib/db/audit": { writeAuditEntry: async (entry: Record<string, unknown>) => { audits.push(entry); prepared = true; } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "@/lib/db/paciente-ficha": { getPacienteFicha: async () => { patientReads++; return ok({
      paciente: { nombre: "Paciente sintético", edad: 30, fechaNacimiento: "1996-01-01", genero: "—", motivo: "" },
      plan: { sesiones: [...all.map(row => ({ ...row, cambio: "STALE" })), { sesionId: null, fecha: "2026-09-01", servicio: "Visita sin sesión", cambio: "Sin registro", soap: null }] },
      notas: [{ id: "n1", texto: "Nota clínica independiente", autorId: "note-author", createdAt: "2026-09-08T12:00:00Z" }],
    }); } },
    "@/lib/patient/export-instruments": { readExportInstruments: async (_client: unknown, _org: string, _patient: string, id: string | null) => options.failInstruments
      ? err("db_error", "No se pudo leer el instrumento") : ok([{ instrumento_id: "historico.v7", instrumento_version: 7,
        respuestas: { items: [1, 2, 3], session: id }, respuestas_estado: "registradas", score_total: 99, banda: "Banda original", created_at: "2026-09-08T02:59:59Z" }]) },
    "@/lib/patient/verified-collection": { CLINICAL_EXPORT_MAX_BYTES: 4194304 },
    "@/lib/especialidades/meta": { ESPECIALIDADES_META: { quiropraxia: { nombre: "Quiropraxia" } }, getEspecialidadMetaByToolId: () => null },
    "@/lib/instrumentos": { getInstrumento: () => null },
    "@/lib/pdf/ficha-format": { evolucionValidada },
    "@/lib/pdf/ficha-pdf": { buildFichaPdf: async (data: FichaPdfData) => {
      if (options.failRender) throw new Error("PRIVATE RENDERER DETAIL");
      rendered = data;
      return options.oversize ? Buffer.alloc(4194305) : Buffer.from("%PDF synthetic");
    } },
    "@/lib/pdf/history-reader": { readPdfCollection,
      readPdfHistory: async (_client: unknown, _org: string, _patient: string, id: string | null) => {
        reads++;
        if (options.failHistory) throw new Error("PRIVATE SYNTHETIC DETAIL");
        return id ? [historyRow(id)] : options.mismatch ? all.slice(1) : all;
      } },
  };
  function load(file: string) {
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Buffer, URL, Date, Intl, Set, Uint8Array, require: (name: string) => {
        if (!(name in imports)) throw new Error(name);
        return imports[name];
      } });
    return exports;
  }
  imports["@/lib/patient/export-authorization"] = load("lib/patient/export-authorization.ts");
  const route = load("app/api/pacientes/[id]/ficha-pdf/route.ts").GET as (request: Request, args: { params: Promise<{ id: string }> }) => Promise<Response>;
  return { run: (query = "", patientId = patient) => route(new Request(`http://127.0.0.1/api/pacientes/${patientId}/ficha-pdf${query}`), { params: Promise.resolve({ id: patientId }) }),
    rendered: () => rendered, reads: () => reads, patientReads: () => patientReads, audits };
}

for (const role of ["OWNER", "DIRECTOR"] as const) test(`${role} PDF preserves every session, unrecorded visit, original instruments and notes`, async () => {
  const f = fixture({ role }); const response = await f.run();
  assert.equal(response.status, 200); const data = f.rendered()!;
  assert.equal(data.evolucion.length, 63); assert.equal(data.evolucion[61].enmiendas?.[0].autorId, "original-author");
  assert.equal(data.evolucion[0].profesionalId, "treating-professional"); assert.equal(data.evolucion[0].lockedAt, "2026-09-08T12:00:00Z");
  assert.equal(data.evolucion[62].soap, null); assert.equal(data.notasFicha?.[0].texto, "Nota clínica independiente");
  assert.equal(data.instrumentos[0].version, 7); assert.equal(data.instrumentos[0].total, "99");
  assert.deepEqual(data.instrumentos[0].respuestas, { items: [1, 2, 3], session: null });
  assert.match(data.alcanceEntrega ?? "", /sin nueva interpretación/); assert.equal(data.soap.s, "SOAP s0");
});
test("PROFESIONAL cannot receive a partial history labeled as complete", async () => {
  const f = fixture({ role: "PROFESIONAL" }); assert.equal((await f.run()).status, 403); assert.equal(f.patientReads(), 0);
});
test("punctual PDF preserves only the requested original, tool summary, notes, amendments and instruments", async () => {
  const f = fixture({ role: "PROFESIONAL" }); assert.equal((await f.run(`?sesion=${sessionId}`)).status, 200);
  const data = f.rendered()!; assert.equal(data.evolucion.length, 0); assert.equal(data.notasFicha?.length, 0);
  assert.equal(data.soap.s, `SOAP ${sessionId}`); assert.equal(data.resumenHerramienta, `Original ${sessionId}`);
  assert.equal(data.notasSesion, `Nota ${sessionId}`); assert.equal(data.enmiendas?.[0].texto, `Enmienda ${sessionId}`);
  assert.equal(data.fechaSesion, "2026-09-07"); assert.equal((data.instrumentos[0].respuestas as { session: string }).session, sessionId);
});
test("malformed session IDs never broaden scope or read clinical history", async () => {
  for (const id of ["", "bad", "-".repeat(36), "a".repeat(36), "116000000000-4000-8000-000000000002"]) {
    const f = fixture(); assert.equal((await f.run(`?sesion=${id}`)).status, 400); assert.equal(f.patientReads(), 0); assert.equal(f.reads(), 0);
  }
});
test("malformed patient UUIDs fail before patient reads", async () => {
  for (const id of ["bad", "-".repeat(36), "a".repeat(36)]) { const f = fixture(); assert.equal((await f.run("", id)).status, 400); assert.equal(f.patientReads(), 0); }
});
for (const options of [{ failHistory: true }, { failInstruments: true }, { mismatch: true }, { failRender: true }, { oversize: true }]) test(`PDF refuses incomplete or invalid generation: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const response = await f.run();
  assert.notEqual(response.status, 200); assert.equal(response.headers.get("Content-Disposition"), null); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.text()).includes("PRIVATE"), false); assert.equal(f.audits.length, 0);
});
test("missing/unreadable requested session never falls back to another session", async () => {
  const f = fixture({ failHistory: true }); assert.equal((await f.run(`?sesion=${sessionId}`)).status, 500); assert.equal(f.rendered(), undefined);
});
for (const options of [{ revoked: true }, { revokeColegiado: true, role: "DIRECTOR" as const }, { revokePatient: true }, { revokeSession: true }, { mfaFinal: true }]) test(`prepared bytes are withheld after authority changes: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const response = await f.run(); assert.equal(response.status, 403);
  assert.equal(response.headers.get("Content-Disposition"), null); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(f.audits.length, 1); assert.equal(f.audits[0].action, "paciente_ficha.export_pdf_prepared");
  assert.equal((f.audits[0].payload as Record<string, unknown>).delivery_confirmed, false);
});
test("punctual prepared bytes are refused if the requested session becomes unreadable", async () => {
  const f = fixture({ role: "PROFESIONAL", revokeSession: true }); assert.equal((await f.run(`?sesion=${sessionId}`)).status, 403);
});
for (const options of [{ role: "DIRECTOR" as const, colegiado: false }, { mfaInitial: true }]) test(`initial clinical authority is required: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); assert.equal((await f.run()).status, 403); assert.equal(f.patientReads(), 0); assert.equal(f.rendered(), undefined);
});
