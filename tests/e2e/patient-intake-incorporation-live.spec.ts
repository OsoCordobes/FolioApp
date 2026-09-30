import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { createServerClient } from "@supabase/ssr";
import { test, expect, type Browser, type BrowserContext, type Page, type Route } from "../fixtures/local-test";
import { waitForIntercept } from "../../scripts/testing/patient-intake-proof/browser-diagnostics.mjs";
import { assertFixture, ownedIdentity, restoreOwned, finiteFailure, FAILURE_PREFIX, FIXTURE, isApplyPayload,
  type IntegrationFixture, type OwnedCase } from "../../scripts/testing/patient-intake-proof/incorporation-contract";

const mark = (value: string) => console.log(value);
const actionUrl = /^http:\/\/localhost:4430\/calendario(?:\?|$)/;
const origin = "PACIENTE_APORTO_PERSONAL_INCORPORO_SIN_VERIFICAR";
type Phase = Parameters<typeof finiteFailure>[1]["phase"];

async function ledger(db: Client, fixture: IntegrationFixture, item: OwnedCase) {
  const args = [fixture.organizationId, item.turnoId, item.patientId, item.identityId, fixture.memberId];
  const operations = await db.query(`SELECT operation_id,receipt_id,actor_session_id,status,selected_keys,changed_keys,expected_admin_revision::text,
    revision_before::text,revision_after::text,terminal_reason FROM folio_intake_private.incorporation_operation
    WHERE organization_id=$1 AND turno_id=$2 AND paciente_id=$3 AND identidad_id=$4 AND actor_member_id=$5 ORDER BY created_at,operation_id`, args);
  const provenance = await db.query(`SELECT operation_id,receipt_id,actor_session_id,selected_keys,changed_keys,revision_before::text,revision_after::text,origin
    FROM folio_intake_private.incorporation_provenance WHERE organization_id=$1 AND turno_id=$2 AND paciente_id=$3
    AND identidad_id=$4 AND actor_member_id=$5 ORDER BY occurred_at,operation_id`, args);
  return { operations: operations.rows, provenance: provenance.rows };
}
async function preserved(db: Client, fixture: IntegrationFixture, item: OwnedCase) {
  await ownedIdentity(db, fixture, item);
  const result = await db.query(`SELECT encode(sha256(convert_to((to_jsonb(i)-ARRAY['nombre_cifrado','nombre_hash','admin_revision','updated_at'])::text,'UTF8')),'hex') AS digest
    FROM public.paciente_identidad i WHERE id=$1 AND organization_id=$2`, [item.identityId, fixture.organizationId]);
  assert.equal(result.rowCount, 1); return result.rows[0].digest as string;
}
async function source(db: Client, fixture: IntegrationFixture, item: OwnedCase) {
  const result = await db.query(`SELECT s.id,encode(sha256(s.answers_cifrado),'hex') AS digest,s.content_fingerprint
    FROM folio_intake_private.submission s JOIN folio_intake_private.invitation i ON i.id=s.invitation_id
    WHERE i.turno_id=$1 AND i.organization_id=$2`, [item.turnoId, fixture.organizationId]);
  assert.equal(result.rowCount, 1); return result.rows[0];
}
async function applied(db: Client, fixture: IntegrationFixture, item: OwnedCase, before: Record<string, unknown>, digest: string,
  expectedOperation?: string, operationCount = 1) {
  const after = await ownedIdentity(db, fixture, item);
  assert.equal(BigInt(String(after.admin_revision)), BigInt(String(before.admin_revision)) + BigInt(1));
  assert.equal(after.link_revision, before.link_revision);
  assert.ok(after.nombre_cifrado !== before.nombre_cifrado && after.nombre_hash !== before.nombre_hash);
  assert.equal(await preserved(db, fixture, item), digest);
  const result = await ledger(db, fixture, item);
  assert.equal(result.operations.length, operationCount); assert.equal(result.provenance.length, 1);
  const op = result.operations.find(value => value.status === "applied"); assert.ok(op);
  if (expectedOperation) assert.equal(op.operation_id, expectedOperation);
  assert.deepEqual(op.selected_keys, ["nombre"]); assert.deepEqual(op.changed_keys, ["nombre"]);
  assert.equal(op.revision_before, before.admin_revision); assert.equal(op.revision_after, after.admin_revision);
  const provenance = result.provenance[0]; assert.equal(provenance.operation_id, op.operation_id);
  assert.equal(op.receipt_id, (await source(db, fixture, item)).id);
  assert.equal(provenance.receipt_id, op.receipt_id); assert.equal(provenance.actor_session_id, op.actor_session_id);
  assert.match(op.actor_session_id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(provenance.origin, origin); assert.deepEqual(provenance.selected_keys, ["nombre"]);
  assert.deepEqual(provenance.changed_keys, ["nombre"]); assert.equal(provenance.revision_before, before.admin_revision);
  assert.equal(provenance.revision_after, after.admin_revision);
  return { after, ledger: result };
}

async function journey(page: Page, browser: Browser, kind: OwnedCase["kind"]) {
  test.setTimeout(240_000);
  let phase: Phase = "guard", fixture: IntegrationFixture | undefined, item: OwnedCase | undefined;
  let db: Client | undefined, connected = false, primary: unknown;
  const contexts: BrowserContext[] = [];
  const diagnose = (error: unknown, secondary = false) => mark(FAILURE_PREFIX + JSON.stringify(finiteFailure(error, { case: kind, phase, secondary })));
  try {
    assert.equal(process.env.CI, "true"); assert.equal(process.env.FOLIO_TEST_REAL_SUPABASE, "1");
    const config = JSON.parse(process.env.FOLIO_TEST_APP_CONFIG ?? "{}");
    assert.equal(config.appUrl, "http://localhost:4430"); assert.equal(config.supabaseUrl, "http://127.0.0.1:55421");
    assert.equal(config.clinical, false); assert.equal(config.realSupabase, true);
    fixture = JSON.parse(await readFile(path.join(tmpdir(), FIXTURE), "utf8")); assertFixture(fixture!);
    assert.equal(config.databaseUrl, fixture!.databaseUrl); item = fixture!.cases.find(value => value.kind === kind); assert.ok(item);
    phase = "auth";
    const staff = createServerClient(config.supabaseUrl, config.anonKey, { cookies: { getAll: () => fixture!.browserCookies, setAll: () => {} },
      auth: { autoRefreshToken: false, persistSession: false } });
    const user = await staff.auth.getUser(); assert.equal(user.error, null); assert.equal(user.data.user?.id, fixture!.userId);
    const mfa = await staff.rpc("mfa_access_status"); assert.equal(mfa.error, null);
    for (const field of ["required", "isStaff", "hasVerifiedFactor", "sessionValid", "allowed"]) assert.equal(mfa.data?.[field], true);
    await page.context().addCookies(fixture!.browserCookies);
    db = new Client({ connectionString: fixture!.databaseUrl, connectionTimeoutMillis: 10_000, query_timeout: 15_000, statement_timeout: 15_000 });
    await db.connect(); connected = true; phase = "setup";
    const before = await ownedIdentity(db, fixture!, item); const digest = await preserved(db, fixture!, item);
    assert.equal((await ledger(db, fixture!, item)).operations.length, 0);
    let editor: Page | undefined;
    if (kind === "conflict") {
      // Open the existing editor before comparison. No focus/visibility shortcut or frozen UI authority.
      editor = await page.context().newPage(); await editor.goto(`/pacientes/${item.patientId}`);
      await editor.getByRole("tab", { name: "Información", exact: true }).click();
      await editor.locator("section.pc-card").filter({ has: editor.getByText("Contacto", { exact: true }) }).locator("header.pc-card-head").getByRole("button", { name: "Editar", exact: true }).click();
      await expect(editor.getByRole("dialog", { name: "Editar datos de contacto" })).toBeVisible();
    }
    await page.goto("/calendario"); await page.getByRole("button", { name: new RegExp(item.label) }).first().click();
    const control = page.getByRole("region", { name: "Datos aportados por el paciente" });
    await expect(control).toBeVisible({ timeout: 30_000 });
    await control.getByRole("button", { name: "Revocar enlace", exact: true }).click();
    await control.getByRole("group", { name: "Confirmar revocación del enlace" }).getByRole("button", { name: "Confirmar revocación", exact: true }).click();
    await expect(control.getByText("Ya podés emitir un enlace nuevo de forma segura.")).toBeVisible({ timeout: 30_000 });
    await control.getByRole("button", { name: "Emitir enlace", exact: true }).click();
    await control.getByRole("group", { name: "Confirmar emisión del enlace" }).getByRole("button", { name: "Confirmar emisión", exact: true }).click();
    const link = control.getByRole("textbox", { name: "Enlace para el formulario" }); await expect(link).toBeVisible({ timeout: 30_000 });
    const url = await link.inputValue(); assert.ok(/^http:\/\/localhost:4430\/aporte#token=[a-f0-9]{64}$/.test(url));
    const publicContext = await browser.newContext(); contexts.push(publicContext); const patient = await publicContext.newPage(); await patient.goto(url);
    await expect(patient).toHaveURL("http://localhost:4430/aporte");
    const proposedName = `Aporte sintético ${kind}`;
    await patient.getByRole("textbox", { name: "Nombre", exact: true }).fill(proposedName);
    await patient.getByRole("textbox", { name: "Apellido", exact: true }).fill("Apellido sin seleccionar");
    await patient.getByRole("button", { name: "Enviar datos", exact: true }).click();
    await expect(patient.getByText("Aporte recibido")).toBeVisible({ timeout: 30_000 });
    const sourceBefore = await source(db, fixture!, item);
    phase = "compare"; await control.getByRole("button", { name: "Consultar aportes", exact: true }).click();
    await expect(control.getByText(proposedName, { exact: true })).toBeVisible();
    await control.getByRole("button", { name: "Comparar con la ficha", exact: true }).click();
    const comparison = control.getByRole("region", { name: "Comparación con la ficha" }); await expect(comparison).toBeVisible();
    await expect(comparison.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await comparison.getByRole("checkbox", { name: /^Nombre/ }).check(); await comparison.getByRole("button", { name: "Revisar selección", exact: true }).click();
    const confirm = comparison.getByRole("group", { name: "Confirmar incorporación" }).getByRole("button", { name: "Confirmar incorporación", exact: true });

    if (kind === "selection") {
      phase = "confirm"; await confirm.click(); await expect(control.getByText(/^Datos incorporados\./)).toBeVisible({ timeout: 30_000 });
      phase = "readback"; await applied(db, fixture!, item, before, digest); mark("intake_incorporation_selected_applied");
      assert.deepEqual(await source(db, fixture!, item), sourceBefore);
      await control.getByRole("button", { name: "Consultar aportes", exact: true }).click();
      await control.getByRole("button", { name: "Comparar con la ficha", exact: true }).click();
      await expect(comparison.getByRole("checkbox", { name: /^Nombre/ })).toHaveAccessibleName(new RegExp(`Actual en la ficha.*${proposedName}.*Aportado por el paciente.*${proposedName}`));
      mark("intake_incorporation_selection_preserved");
    } else if (kind === "lost") {
      phase = "lost_response"; let seen = false, operationId = "", interceptedError: unknown;
      let resolve!: (value: { status: number; rows: number; done: boolean }) => void;
      const terminal = new Promise<{ status: number; rows: number; done: boolean }>(done => { resolve = done; });
      const loseResponse = async (route: Route) => {
        const request = route.request(); if (seen || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
        let payload: unknown; try { payload = request.postDataJSON(); } catch { return route.continue(); }
        if (!isApplyPayload(payload, item!.turnoId)) return route.continue();
        seen = true; operationId = payload[0].operationId; let status = 0, rows = 0, done = false;
        try {
          const response = await route.fetch({ timeout: 30_000 }); status = response.status();
          const committed = await applied(db!, fixture!, item!, before, digest, operationId); rows = committed.ledger.operations.length;
          assert.equal(status, 200); await route.abort("failed"); done = true;
        } catch (error) { interceptedError = error; await route.abort("failed").catch(() => {}); }
        finally { resolve({ status, rows, done }); }
      };
      await page.route(actionUrl, loseResponse); await confirm.click();
      const result = await waitForIntercept(terminal, 35_000, () => ({ status: 0, rows: 0, done: false }));
      if (interceptedError) throw interceptedError;
      assert.equal(seen, true); assert.equal(result.status, 200); assert.equal(result.rows, 1); assert.equal(result.done, true);
      mark("intake_incorporation_lost_response_committed"); await page.unroute(actionUrl, loseResponse);
      await expect(control.getByRole("group", { name: "Incorporación pendiente" })).toContainText("Nombre");
      await expect(comparison.getByRole("checkbox", { name: /^Nombre/ })).toBeChecked();
      await control.getByRole("button", { name: "Comprobar incorporación", exact: true }).click();
      await expect(control.getByText(/^Datos incorporados\./)).toBeVisible({ timeout: 30_000 });
      phase = "readback"; await applied(db, fixture!, item, before, digest, operationId); assert.deepEqual(await source(db, fixture!, item), sourceBefore);
      mark("intake_incorporation_lost_response_reconciled");
    } else {
      phase = "editor"; const dialog = editor!.getByRole("dialog", { name: "Editar datos de contacto" });
      await dialog.locator('input[type="tel"]').fill("+5493510000077"); await dialog.getByRole("button", { name: "Guardar contacto", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      const edited = await ownedIdentity(db, fixture!, item); assert.equal(BigInt(String(edited.admin_revision)), BigInt(String(before.admin_revision)) + BigInt(1));
      assert.ok(edited.telefono_cifrado !== before.telefono_cifrado); const editorDigest = await preserved(db, fixture!, item);
      phase = "confirm"; await confirm.click(); const draft = control.getByRole("group", { name: "Selección pendiente de revisión" });
      await expect(draft).toContainText("Nombre", { timeout: 30_000 }); await expect(comparison).toHaveCount(0);
      phase = "readback"; const conflict = await ledger(db, fixture!, item); assert.equal(conflict.operations.length, 1); assert.equal(conflict.provenance.length, 0);
      assert.equal(conflict.operations[0].status, "conflict"); assert.equal(conflict.operations[0].terminal_reason, "snapshot_changed");
      assert.deepEqual(await ownedIdentity(db, fixture!, item), edited); assert.deepEqual(await source(db, fixture!, item), sourceBefore);
      mark("intake_incorporation_editor_conflict");
      phase = "compare"; await draft.getByRole("button", { name: "Actualizar comparación", exact: true }).click();
      await expect(comparison.getByRole("checkbox", { name: /^Nombre/ })).toBeChecked(); await expect(comparison.getByText(/Recuperamos las claves disponibles/)).toBeVisible();
      await expect(comparison.getByRole("button", { name: "Confirmar incorporación", exact: true })).toHaveCount(0);
      assert.deepEqual(await ledger(db, fixture!, item), conflict);
      await comparison.getByRole("button", { name: "Revisar selección", exact: true }).click();
      phase = "confirm"; await comparison.getByRole("button", { name: "Confirmar incorporación", exact: true }).click();
      await expect(control.getByText(/^Datos incorporados\./)).toBeVisible({ timeout: 30_000 });
      phase = "readback"; const updated = await applied(db, fixture!, item, edited, editorDigest, undefined, 2);
      assert.deepEqual(updated.ledger.operations.find(value => value.status === "conflict"), conflict.operations[0]);
      assert.ok(updated.ledger.provenance[0].operation_id !== conflict.operations[0].operation_id);
      assert.deepEqual(await source(db, fixture!, item), sourceBefore); mark("intake_incorporation_editor_draft_preserved");
      await editor!.close();
    }
  } catch (error) { primary = error; diagnose(error); throw Error("incorporation_case_failed"); }
  finally {
    let cleanupError: unknown;
    if (connected && db && fixture && item) {
      phase = "restore"; try { await restoreOwned(db, fixture, item); } catch (error) { diagnose(error, Boolean(primary)); cleanupError = error; }
    }
    phase = "cleanup";
    for (const context of contexts) try { await context.close(); } catch (error) { diagnose(error, Boolean(primary || cleanupError)); cleanupError ??= error; }
    if (db) try { await db.end(); } catch (error) { diagnose(error, Boolean(primary || cleanupError)); cleanupError ??= error; }
    if (!primary && cleanupError) throw Error("incorporation_cleanup_failed");
  }
}

test("incorporación real: sólo selección explícita, lectura posterior y procedencia", async ({ page, browser }) => journey(page, browser, "selection"));
test("incorporación real: respuesta perdida después de COMMIT y misma operación", async ({ page, browser }) => journey(page, browser, "lost"));
test("incorporación real: editor M150 concurrente, conflicto y borrador revisado", async ({ page, browser }) => journey(page, browser, "conflict"));
