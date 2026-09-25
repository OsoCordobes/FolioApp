import assert from "node:assert/strict";
import test from "node:test";
import { buildPatientExport, type BuildPatientExportInput } from "../../lib/patient/export-builder";
import { buildPortalExport, type BuildPortalExportInput } from "../../lib/patient/portal-export";
import { encryptColumn } from "../../lib/crypto";

// Isolated synthetic fixture keys; this test never reads workspace secrets.
process.env.FOLIO_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.FOLIO_ENC_HMAC_KEY = Buffer.alloc(32, 8).toString("base64");

function client(failSessionPage = false, patientFields: Record<string, unknown> = {}, perOrgPatient: Record<string, Record<string, unknown>> = {}) {
  const sessions = Array.from({ length: 1201 }, (_, i) => ({ id: `s${i}`, paciente_id: "p", organization_id: "org", turno_id: `t${i}`, created_at: "2026-09-08", locked_at: null, locked_by_id: null, eva_antes: 8, eva_despues: 2, tool_id: null, vertebras_json: [] }));
  return { rpc: async (name: string) => {
    assert.equal(name, "export_retired_document_metadata");
    return { data: { total: 0, all_total: 0, rows: [] }, error: null };
  }, from(table: string) {
    let from = 0, to = 999999, head = false, organizationId = "org", patientId = "p";
    const rows = table === "paciente_completo" ? [{ id: "p", organization_id: "org", ...patientFields }] : table === "sesion" ? sessions : [];
    const query = {
      select(_fields?: string, options?: { head?: boolean }) { head = options?.head ?? false; return query; },
      eq(key: string, value: string) { if (key === "organization_id") organizationId = value; if (key === "id" && table === "paciente_completo") patientId = value; return query; }, in() { return query; }, order() { return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      maybeSingle() { return Promise.resolve({ data: table === "paciente_completo" ? { id: patientId, organization_id: organizationId, ...(perOrgPatient[organizationId] ?? patientFields) } : rows[0] ?? null, error: null }); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: head ? null : rows.slice(from, Math.min(from + 111, to + 1)), count: rows.length, error: failSessionPage && table === "sesion" && from > 0 ? { message: "Unavailable" } : null })); },
    };
    return query;
  } } as unknown as BuildPatientExportInput["supabase"];
}

test("professional reviewed export includes every original clinical session", async () => {
  const result = await buildPatientExport({ supabase: client(), organizationId: "org", pacienteId: "p", clinicalHistory: "professional-reviewed" } as BuildPatientExportInput);
  assert.equal(result.ok, true);
  if (result.ok) {
    const history = (result.data as unknown as { historia_clinica: { sesiones: { id: string; enmiendas: unknown[] }[] } }).historia_clinica;
    assert.ok(history);
    assert.equal(result.data.format_version, "folio.patient-export.v2");
    assert.equal(result.data.manifest?.archivo_restaurable, false);
    assert.ok(result.data.manifest?.pendientes.includes("bytes_documentos_y_firmas"));
    assert.equal(history.sesiones.length, 1201);
    assert.equal(history.sesiones[1200].id, "s1200");
    assert.deepEqual(history.sesiones[0].enmiendas, []);
    assert.ok(!result.data.notas.some((n) => n.includes("es dato del profesional")));
  }
});

test("professional reviewed export refuses a failed later clinical page", async () => {
  const result = await buildPatientExport({ supabase: client(true), organizationId: "org", pacienteId: "p", clinicalHistory: "professional-reviewed" } as BuildPatientExportInput);
  assert.equal(result.ok, false);
});

test("shared portal builder does not silently broaden clinical delivery", async () => {
  const result = await buildPatientExport({ supabase: client(), organizationId: "org", pacienteId: "p" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal("historia_clinica" in result.data, false);
});

test("portal export refuses unreadable non-null patient ciphertext", async () => {
  const result = await buildPatientExport({ supabase: client(false, { nombre_cifrado: "corrupt" }), organizationId: "org", pacienteId: "p" });
  assert.equal(result.ok, false);
});

test("amendments retain decrypted text, reason, author and timestamp independently of original", async () => {
  const { readEnmiendas } = await import("../../lib/db/enmiendas");
  const correction = { id: "e1", sesion_id: "s1", autor_id: "member-1", created_at: "2026-09-08T09:00:00Z", motivo: "Corrección de lateralidad", texto_correccion_cifrado: encryptColumn("Lado izquierdo") };
  const query = { select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, range() { return Promise.resolve({ data: [correction], count: 1, error: null }); } };
  const supabase = { from() { return query; } } as unknown as BuildPatientExportInput["supabase"];
  const result = await readEnmiendas(supabase, "org", ["s1"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.get("s1"), [{ id: "e1", autorId: "member-1", createdAt: "2026-09-08T09:00:00Z", motivo: "Corrección de lateralidad", texto: "Lado izquierdo" }]);
  correction.texto_correccion_cifrado = "corrupt";
  assert.equal((await readEnmiendas(supabase, "org", ["s1"])).ok, false);
});

test("both export channels reject every unreadable non-null patient field and preserve genuine null", async () => {
  const session = { cuentaId: "account", email: "synthetic@example.test", pacientes: [
    { pacienteId: "p", organizationId: "org", organizacionNombre: "Consultorio sintético" },
  ] } as unknown as BuildPortalExportInput["session"];
  for (const field of ["motivo_consulta_cifrado", "nombre_cifrado", "apellido_cifrado", "numero_doc_cifrado", "email_cifrado", "telefono_cifrado", "domicilio_calle_cifrado", "domicilio_numero_cifrado"]) {
    for (const channel of ["portal", "professional"] as const) {
      const result = channel === "portal"
        ? await buildPortalExport({ session, supabase: client(false, { [field]: "corrupt" }) })
        : await buildPatientExport({ supabase: client(false, { [field]: "corrupt" }), organizationId: "org", pacienteId: "p", clinicalHistory: "professional-reviewed" });
      assert.equal(result.ok, false, `${field}: ${channel}`);
      assert.equal(JSON.stringify(result).includes("corrupt"), false);
      assert.equal(JSON.stringify(result).includes("historia_clinica"), false);
      const absent = channel === "portal"
        ? await buildPortalExport({ session, supabase: client(false, { [field]: null }) })
        : await buildPatientExport({ supabase: client(false, { [field]: null }), organizationId: "org", pacienteId: "p", clinicalHistory: "professional-reviewed" });
      assert.equal(absent.ok, true, `${field}: ${channel} genuine null`);
      if (absent.ok && channel === "portal") {
        assert.ok("organizaciones" in absent.data);
        assert.equal("historia_clinica" in absent.data.organizaciones[0], false);
      }
    }
  }
});

test("portal aggregation rejects all organizations when a later linked ficha is unreadable", async () => {
  const session = {
    cuentaId: "account", email: "synthetic@example.test",
    pacientes: [
      { pacienteId: "p-a", organizationId: "org-a", organizacionNombre: "Consultorio Uno" },
      { pacienteId: "p-b", organizationId: "org-b", organizacionNombre: "Consultorio Dos" },
    ],
  } as unknown as BuildPortalExportInput["session"];
  const result = await buildPortalExport({ session, supabase: client(false, {}, { "org-b": { nombre_cifrado: "corrupt" } }) });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("Consultorio Uno"), false);
  assert.equal(JSON.stringify(result).includes("corrupt"), false);
});
test("clinical delivery preserves both original pain measurements", async () => {
  const result = await buildPatientExport({ supabase: client(), organizationId: "org", pacienteId: "p", clinicalHistory: "professional-reviewed" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.historia_clinica?.sesiones[0].eva_antes, 8);
    assert.equal(result.data.historia_clinica?.sesiones[0].eva_despues, 2);
  }
});
