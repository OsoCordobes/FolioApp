import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "../../lib/crypto";
import * as errors from "../../lib/db/errors";
import { z } from "zod";

const actual = createRequire(import.meta.url);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1), user = id(2), member = id(3), account = id(4), patient = id(5), identity = id(6), sessionId = id(7);
const revision = "9007199254740993";
const scope = (kind: "staff" | "portal", sid = sessionId) => createHash("sha256").update(JSON.stringify([
  user, sid, ...(kind === "staff" ? ["staff", org, member, "PROFESIONAL", patient, identity] : ["portal", account, org, patient, identity]),
])).digest("hex");
type Query = { table: string; selection?: string; patch?: Record<string, unknown>; filters: Record<string, unknown> };
type Response = { data: unknown; error: { message: string; code?: string } | null };
type Options = { rpcStatus?: "applied" | "unchanged" | "conflict"; rpcError?: string; currentRevision?: unknown; lostAfterUpdate?: boolean; switchedSession?: boolean };

function fixture(options: Options = {}) {
  const calls: Query[] = [];
  let wrote = false;
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let staffActor = errors.ok({ userId: user, organizationId: org, memberId: member, role: "PROFESIONAL" });
  const token = () => `x.${Buffer.from(JSON.stringify({ sub: user, session_id: options.switchedSession ? id(8) : sessionId })).toString("base64url")}.x`;
  const row = {
    id: identity, admin_revision: revision, nombre_cifrado: crypto.encryptColumn("Actual"), apellido_cifrado: crypto.encryptColumn("Paciente"),
    telefono_cifrado: crypto.encryptColumn("3515551234"), email_cifrado: crypto.encryptColumn("actual@example.test"),
    ocupacion_cifrado: crypto.encryptColumn("Docente"), cobertura_nombre: "OSDE", cobertura_plan: "210", cobertura_nro_afiliado_cifrado: null,
    domicilio_calle_cifrado: crypto.encryptColumn("Calle actual"), domicilio_numero_cifrado: null,
    domicilio_ciudad: "Córdoba", domicilio_provincia: "Córdoba", domicilio_cp: "5000", numero_doc_cifrado: null,
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args }); wrote = true;
      if (options.lostAfterUpdate) staffActor = errors.ok({ userId: id(10), organizationId: org, memberId: member, role: "PROFESIONAL" });
      return { data: options.rpcStatus === "conflict" ? { status: "conflict" } : {
        status: options.rpcStatus ?? "applied", adminRevision: options.currentRevision ?? "9007199254740994", identityLinkRevision: revision,
      }, error: options.rpcError ? { code: options.rpcError, message: "synthetic" } : null };
    },
    auth: { getSession: async () => ({ data: { session: { access_token: token() } }, error: null }) },
    from(table: string) {
      const q: Query = { table, filters: {} }; calls.push(q);
      const response = (): Response => {
        if (q.patch) throw Error("Direct UPDATE must not be used");
        if (table === "paciente" && q.selection?.includes("paciente_identidad(")) return { data:
          q.filters.id ? { id: patient, organization_id: org, identidad_id: identity, identity_link_revision: revision, paciente_identidad: row }
            : [{ id: patient, organization_id: org, identidad_id: identity, identity_link_revision: revision, paciente_identidad: row }], error: null };
        return { data: q.selection === "admin_revision::text" ? { admin_revision: options.currentRevision ?? revision } : row, error: null };
      };
      const builder = {
        select(value: string) { q.selection = value; return builder; },
        update(value: Record<string, unknown>) { q.patch = value; return builder; },
        eq(key: string, value: unknown) { q.filters[key] = value; return builder; },
        is(key: string, value: unknown) { q.filters[key] = value; return builder; },
        maybeSingle: async () => response(),
        then(resolve: (response: Response) => unknown) { return Promise.resolve(response()).then(resolve); },
      };
      return builder;
    },
  };
  const load = (path: string, extra = "") => {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + extra;
    runInNewContext(code, { exports, Buffer, JSON, require: (name: string) => {
      if (name === "zod") return { z };
      if (name === "node:crypto") return { createHash };
      if (name === "@/lib/crypto") return crypto;
      if (name === "@/lib/especialidades/meta") return actual("../../lib/especialidades/meta");
      if (name.endsWith("/errors") || name === "./errors") return errors;
      if (name === "./session") return { getActiveSession: async () => staffActor };
      if (name === "./paciente-session") return { getPacienteSession: async () => errors.ok({ userId: user, cuentaId: account, pacientes: wrote && options.lostAfterUpdate ? [] : [{ pacienteId: patient, organizationId: org, organizacionNombre: "Sintético" }] }) };
      if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => client };
      if (name === "./pacientes") return staff;
      if (name === "@/lib/pacientes/cobertura") return actual("../../lib/pacientes/cobertura");
      return {};
    } });
    return exports;
  };
  const staff = load("lib/db/pacientes.ts") as typeof import("../../lib/db/pacientes");
  const portal = load("lib/db/portal-perfil.ts") as typeof import("../../lib/db/portal-perfil");
  const ficha = load("lib/db/paciente-ficha.ts", "\nexports.readAdministrativeEditor = readAdministrativeEditor;") as {
    readAdministrativeEditor: (...args: unknown[]) => Promise<{ adminEditor: unknown; contacto: { nombre: string } | null; coberturaLeida: boolean }>;
  };
  return { calls, rpcCalls, row, client, staff, portal, ficha, switchActor: () => { staffActor = errors.ok({ userId: id(10), organizationId: org, memberId: member, role: "PROFESIONAL" }); } };
}

const input = (kind: "staff" | "portal") => ({ pacienteId: patient, identidadId: identity, adminRevision: revision, identityLinkRevision: revision, editorScope: scope(kind) });
const save = (f: ReturnType<typeof fixture>, kind: "contacto" | "cobertura" | "portal", overrides = {}) => kind === "contacto"
  ? f.staff.updatePacienteContacto({ ...input("staff"), nombre: "Ana", apellido: "Paciente", telefono: "3515559999", ocupacion: "Docente", ...overrides })
  : kind === "cobertura" ? f.staff.updatePacienteCobertura({ ...input("staff"), coberturaNombre: "OSDE", coberturaPlan: "310", ...overrides })
  : f.portal.updatePortalContacto({ ...input("portal"), telefono: "3515559999", ...overrides });

test("real Supabase PostgREST builder requests a SQL text cast and parses >2^53 exactly", async () => {
  let url = "";
  const client = createClient("https://synthetic.example.test", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async request => {
    url = String(request); return new Response(`[{"admin_revision":"${revision}"}]`, { status: 200, headers: { "content-type": "application/json" } });
  } } });
  const result = await client.from("paciente_identidad").select("admin_revision::text").eq("admin_revision", revision);
  const params = new URL(url).searchParams;
  assert.equal(params.get("select"), "admin_revision::text");
  assert.equal(params.get("admin_revision"), `eq.${revision}`);
  assert.equal(result.data?.[0].admin_revision, revision);
});

for (const kind of ["contacto", "cobertura", "portal"] as const) {
  test(`${kind}: atomic RPC binds exact decimal content/link revisions and actor/session`, async () => {
    const f = fixture(); assert.equal((await save(f, kind)).ok, true);
    assert.equal(f.rpcCalls.length, 1);
    const rpc = f.rpcCalls[0], args = rpc.args, patch = args.p_patch as Record<string, unknown>;
    assert.equal(rpc.name, kind === "contacto" ? "patient_admin_contact_cas" : kind === "cobertura" ? "patient_admin_coverage_cas" : "patient_portal_contact_cas");
    assert.equal(args.p_admin_revision, revision); assert.equal(args.p_link_revision, revision);
    assert.equal(args.p_identity, identity); assert.equal(args.p_patient, patient); assert.equal(args.p_org, org);
    assert.equal(args.p_session, sessionId); assert.equal(args.p_actor, kind === "portal" ? account : member);
    assert.equal("admin_revision" in patch, false); assert.equal(f.calls.some(q => q.patch), false);
    if (kind === "contacto") { assert.ok(patch.ocupacion_cifrado); assert.equal("ocupacion" in patch, false); assert.equal(patch.email_hash, null); }
    if (kind === "portal") { assert.equal("nombre_cifrado" in patch, false); assert.equal("ocupacion_cifrado" in patch, false); }
  });
  for (const field of ["adminRevision", "identityLinkRevision"]) test(`${kind}: invalid/missing ${field} fails before any RPC`, async () => {
    for (const value of [undefined, 9, "01", "-1", "1e3", "9223372036854775808", "", " 9"]) {
      const f = fixture(); const result = await save(f, kind, { [field]: value });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "validation"); assert.equal(f.rpcCalls.length, 0);
    }
  });
  for (const code of ["42501", "40P01", "22023"]) test(`${kind}: SQL ${code} rejects safely without retry`, async () => {
    const f = fixture({ rpcError: code }); const result = await save(f, kind); assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, code === "42501" ? "forbidden" : code === "22023" ? "validation" : "db_error");
      if (code === "40P01") assert.equal(result.error.mutationOutcome, "rejected");
    }
    assert.equal(f.rpcCalls.length, 1);
  });
  test(`${kind}: scoped conflict preserves meaning, never returns current PII or retries`, async () => {
    const f = fixture({ rpcStatus: "conflict" }); const result = await save(f, kind);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "conflict");
    assert.equal(f.rpcCalls.length, 1); assert.ok(!JSON.stringify(result).includes("Actual"));
  });
  test(`${kind}: new auth session rejects the old draft before RPC`, async () => {
    const f = fixture({ switchedSession: true }); const result = await save(f, kind);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "forbidden"); assert.equal(f.rpcCalls.length, 0);
  });
  test(`${kind}: unsafe numeric success revision requires review instead of success`, async () => {
    const f = fixture({ currentRevision: 9007199254740992 }); const result = await save(f, kind);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.mutationOutcome, "review_required");
  });
  test(`${kind}: lost actor after RPC cannot acknowledge the old editor`, async () => {
    const f = fixture({ lostAfterUpdate: true }); const result = await save(f, kind);
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("3515559999"));
  });
}

test("staff coherent read comes from current identity, with text revision and no editor on corrupt ciphertext", async () => {
  const f = fixture(); const result = await f.ficha.readAdministrativeEditor(f.client, patient, org, identity);
  assert.equal(result.contacto?.nombre, "Actual"); assert.equal((result.adminEditor as { adminRevision: string }).adminRevision, revision);
  assert.ok(f.calls[0].selection?.includes("identity_link_revision::text"));
  assert.ok(f.calls[0].selection?.includes("admin_revision::text")); assert.ok(f.calls[0].selection?.includes("ocupacion_cifrado"));
  f.row.ocupacion_cifrado = "\\x00"; const broken = await f.ficha.readAdministrativeEditor(f.client, patient, org, identity);
  assert.equal(broken.adminEditor, null);
});
test("portal embedded read includes the SAME snapshot revision; partial decryption disables editing", async () => {
  const f = fixture(); const result = await f.portal.getPortalPerfiles(); assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.data[0].email, "actual@example.test"); assert.equal(result.data[0].adminEditor?.adminRevision, revision); }
  assert.ok(f.calls[0].selection?.includes("paciente_identidad(id, admin_revision::text"));
  assert.ok(f.calls[0].selection?.includes("identity_link_revision::text"));
  f.row.domicilio_calle_cifrado = "\\x00"; const broken = await f.portal.getPortalPerfiles();
  assert.equal(broken.ok, true); if (broken.ok) assert.equal(broken.data[0].adminEditor, null);
});


// Execute the real handlers with a small React renderer; all I/O stays synthetic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UiElement = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): UiElement[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as UiElement; return [node, ...nodes(node.props.children)];
}
function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join(" ");
  if (value && typeof value === "object" && "props" in value) return label((value as UiElement).props.children);
  return typeof value === "string" ? value : "";
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function uiFixture(kind: "contacto" | "cobertura" | "portal") {
  const slots: unknown[] = []; let cursor = 0;
  const effects: (() => void)[] = [];
  const navigation: string[] = [], clipboard: string[] = [];
  const requests: { input: Record<string, unknown>; resolve: (value: unknown) => void; reject: (reason: Error) => void }[] = [];
  let running = false;
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const i = cursor++; const old = slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
    useTransition() { return [running, (fn: () => Promise<void>) => { running = true; void fn().finally(() => { running = false; }); }]; },
  };
  const action = (input: Record<string, unknown>) => new Promise((resolve, reject) => { requests.push({ input, resolve, reject }); });
  const props = { pacienteId: patient, adminEditor: { ...input(kind === "portal" ? "portal" : "staff") },
    prefill: { nombre: "Ana", apellido: "Paciente", telefono: "3515551234", email: "old@example.test", ocupacion: "Docente", coberturaNombre: "OSDE", coberturaPlan: "210", coberturaNroAfiliado: "123" },
    onClose: () => navigation.push("close"),
    perfil: { pacienteId: patient, identidadId: identity, organizationId: org, organizacionNombre: "Sintético", nombre: "Ana", apellido: "Paciente", documento: "12345678", email: "old@example.test", telefono: "3515551234", domicilioCalle: "Calle", domicilioNumero: "123", domicilioCiudad: "Córdoba", domicilioProvincia: "Córdoba", domicilioCp: "5000", adminEditor: { ...input("portal") } },
  };
  const file = kind === "portal" ? "app/(portal)/portal/(tabs)/perfil/perfil-list.tsx" : `components/paciente/${kind}-modal.tsx`;
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText + (kind === "portal" ? "\nexports.Editor = PerfilCard;" : `\nexports.Editor = ${kind === "contacto" ? "ContactoModal" : "CoberturaModal"};`);
  const exports: { Editor?: (props: unknown) => UiElement } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(code, { exports, JSON, window: { location: { reload: () => navigation.push("reload") } }, navigator: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } }, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => navigation.push("refresh") }) };
    if (name === "@/app/(app)/pacientes/actions") return { updateContactoPacienteAction: action, savePacienteCoberturaAction: action };
    if (name === "./actions") return { actualizarContactoAction: action };
    if (name === "@/lib/use-modal-a11y") return { useModalA11y: () => {} };
    if (name === "@/lib/pacientes/cobertura") return { OBRAS_SOCIALES_AR: [] };
    return {};
  } });
  const render = () => { cursor = 0; const result = exports.Editor!(props); for (const effect of effects.splice(0)) effect(); return result; };
  const button = (name: string) => nodes(render()).find(node => node.type === "button" && label(node.props.children).trim() === name)!;
  const fields = () => nodes(render()).filter(node => node.type === "input");
  const submit = () => nodes(render()).find(node => node.type === "form")!.props.onSubmit({ preventDefault() {} });
  const unmount = () => { for (const slot of slots) if (slot && typeof slot === "object" && "cleanup" in slot) (slot as { cleanup?: () => void }).cleanup?.(); };
  render();
  return { props, render, fields, submit, button, requests, navigation, clipboard, unmount };
}
for (const kind of ["contacto", "cobertura", "portal"] as const) {
  const saveLabel = kind === "contacto" ? "Guardar contacto" : kind === "cobertura" ? "Guardar cobertura" : "Guardar cambios";
  test(`${kind} UI: conflict keeps draft/frozen versions and review reload needs preserved draft`, async () => {
    const f = uiFixture(kind); f.fields()[0].props.onChange({ target: { value: "draft preserved" } });
    f.submit(); assert.equal(f.requests[0].input.adminRevision, revision); assert.equal(f.requests[0].input.identityLinkRevision, revision);
    f.requests[0].resolve(errors.err("conflict", "Review current values")); await settle();
    assert.equal(f.fields()[0].props.value, "draft preserved"); assert.equal(f.button(saveLabel).props.disabled, true);
    f.submit(); assert.equal(f.requests.length, 1);
    assert.equal(f.button("Recargar datos para revisar").props.disabled, true);
    f.button("Copiar borrador").props.onClick(); await settle(); assert.ok(f.clipboard[0].includes("draft preserved"));
    assert.equal(f.button("Recargar datos para revisar").props.disabled, false);
    f.fields()[0].props.onChange({ target: { value: "later draft" } });
    assert.equal(f.button("Recargar datos para revisar").props.disabled, true);
  });
  test(`${kind} UI: response loss and 40P01 preserve draft without repeat mutation`, async () => {
    for (const lost of [true, false]) {
      const f = uiFixture(kind); f.fields()[0].props.onChange({ target: { value: "draft" } }); f.submit();
      if (lost) f.requests[0].reject(Error("lost transport")); else f.requests[0].resolve(errors.err("db_error", "Transaction aborted without saving"));
      await settle(); assert.equal(f.fields()[0].props.value, "draft"); assert.equal(f.button(saveLabel).props.disabled, true);
      f.submit(); assert.equal(f.requests.length, 1);
    }
  });
  test(`${kind} UI: lost access clears/hides PII and later props cannot revive it`, async () => {
    const f = uiFixture(kind); f.submit(); f.requests[0].resolve(errors.err("forbidden", "Scope lost")); await settle();
    assert.equal(f.fields().length, 0); assert.ok(!label(f.render()).includes("Ana"));
    f.props.prefill.nombre = "late Ana"; f.props.perfil.nombre = "late Ana";
    assert.equal(f.fields().length, 0); assert.ok(!label(f.render()).includes("late Ana"));
  });
  test(`${kind} UI: a refreshed revision never silently upgrades an unsaved draft`, () => {
    const f = uiFixture(kind); f.fields()[0].props.onChange({ target: { value: "original draft" } });
    f.props.adminEditor = { ...f.props.adminEditor, adminRevision: "9007199254741000", identityLinkRevision: "9007199254741001" };
    f.props.perfil = { ...f.props.perfil, adminEditor: { ...f.props.perfil.adminEditor, adminRevision: "9007199254741000", identityLinkRevision: "9007199254741001" } };
    f.submit(); assert.equal(f.requests[0].input.adminRevision, revision); assert.equal(f.requests[0].input.identityLinkRevision, revision);
  });
  for (const changed of ["scope", "unmounted"]) test(`${kind} UI: late success after ${changed} cannot navigate or restore PII`, async () => {
    const f = uiFixture(kind); f.submit();
    if (changed === "unmounted") f.unmount();
    else { f.props.adminEditor = { ...f.props.adminEditor, editorScope: "b".repeat(64) }; f.props.perfil = { ...f.props.perfil, adminEditor: { ...f.props.perfil.adminEditor, editorScope: "b".repeat(64) } }; f.render(); }
    f.requests[0].resolve(errors.ok({ identidadId: identity })); await settle(); assert.deepEqual(f.navigation, []);
    if (changed === "scope") assert.equal(f.fields().length, 0);
  });
}


test("actual Supabase RPC transport JSON keeps BOTH expected revisions and textual response exact", async () => {
  let args: Record<string, unknown> = {};
  const client = createClient("https://synthetic.example.test", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (_request, init) => {
    args = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: "applied", adminRevision: revision, identityLinkRevision: revision }), { status: 200, headers: { "content-type": "application/json" } });
  } } });
  const result = await client.rpc("patient_admin_coverage_cas", { p_admin_revision: revision, p_link_revision: revision });
  assert.equal(args.p_admin_revision, revision); assert.equal(args.p_link_revision, revision);
  assert.equal(result.data?.adminRevision, revision); assert.equal(result.data?.identityLinkRevision, revision);
});
