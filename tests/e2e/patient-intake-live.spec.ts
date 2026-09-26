import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { test, expect } from "../fixtures/local-test";
import { interceptDiagnostic, interceptErrorKind, isIssueActionPayload, waitForIntercept } from "../../scripts/testing/patient-intake-proof/browser-diagnostics.mjs";
import { qrContainsExactUrl } from "./patient-intake-qr";

type Fixture = {
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[];
  databaseUrl: string;
  turnoId: string;
};
const stage = (name: string) => console.log(`intake_proof_stage:${name}`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("B09: enlace v2, formulario real, conciliación y revocación", async ({ page, browser }) => {
  test.setTimeout(540_000); // Bounded full journey, including cold pages, staff reconciliation and three real patient sessions.
  if (process.env.CI !== "true" || process.env.FOLIO_TEST_REAL_SUPABASE !== "1") throw new Error("intake_proof_requires_isolated_ci");
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), "folio-patient-intake-proof-fixture.json"), "utf8")) as Fixture;
  expect(fixture.browserCookies.length).toBeGreaterThan(0);
  await page.context().addCookies(fixture.browserCookies);
  const db = new Client({ connectionString: fixture.databaseUrl, connectionTimeoutMillis: 10000 });
  await db.connect();
  const publicContexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  try {
    const preservedRows = "SELECT encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS patient_digest,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex') AS identity_digest,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS visit_digest FROM public.turno t JOIN public.paciente p ON p.id=t.paciente_id JOIN public.paciente_identidad i ON i.id=p.identidad_id WHERE t.id=$1";
    const before = await db.query(preservedRows, [fixture.turnoId]);
    expect(before.rows).toHaveLength(1);
    await page.goto("/calendario");
    await page.getByRole("button", { name: /Paciente sintético B09/ }).first().click();
    const control = page.getByRole("region", { name: "Datos aportados por el paciente" });
    await expect(control).toBeVisible({ timeout: 30_000 });
    await expect(control.getByRole("button", { name: "Emitir enlace" })).toBeDisabled();
    await control.getByRole("button", { name: "Revocar enlace" }).click();
    await control.getByRole("group", { name: "Confirmar revocación del enlace" }).getByRole("button", { name: "Confirmar revocación" }).click();
    await expect(control.getByText("Ya podés emitir un enlace nuevo de forma segura.")).toBeVisible({ timeout: 30_000 });
    const fence = await db.query("SELECT (SELECT count(*)::int FROM folio_intake_private.invitation WHERE turno_id=$1) AS invitations,(SELECT count(*)::int FROM folio_intake_private.link_operation WHERE turno_id=$1 AND kind='REVOKE') AS revocations,(SELECT generation::text FROM folio_intake_private.link_state WHERE turno_id=$1) AS generation", [fixture.turnoId]);
    expect(fence.rows).toEqual([{ invitations: 0, revocations: 1, generation: "1" }]);
    stage("initial_fence");

    await control.getByRole("button", { name: "Emitir enlace" }).click();
    const confirmIssue = control.getByRole("group", { name: "Confirmar emisión del enlace" }).getByRole("button", { name: "Confirmar emisión" });
    await expect(confirmIssue).toBeVisible();
    const actionUrl = /^http:\/\/localhost:4430\/calendario(?:\?|$)/;
    let intercepted = false;
    let committedIssue: { responseStatus: number; rows: { invitation_id: string; token_hash: string; operation_id: string; generation: string }[] } = { responseStatus: 0, rows: [] };
    let issuePhase = "not_seen", issueStatus = 0, issueRows = 0;
    type InterceptResult = { phase: string; status: number; rows: number; kind: string };
    let resolveIssue!: (result: InterceptResult) => void;
    const issueTerminal = new Promise<InterceptResult>(resolve => { resolveIssue = resolve; });
    const loseIssueResponse = async (route: import("@playwright/test").Route) => {
      const request = route.request();
      if (intercepted || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      let payload: unknown;
      try { payload = request.postDataJSON(); }
      catch { issuePhase = "payload"; return route.continue(); }
      if (!isIssueActionPayload(payload, fixture.turnoId)) { issuePhase = "other_action_seen"; return route.continue(); }
      intercepted = true;
      let kind = "none";
      try {
        issuePhase = "fetch";
        const response = await route.fetch({ timeout: 30_000 });
        issueStatus = response.status();issuePhase = "response";
        issuePhase = "db_read";
        const committed = await db.query("SELECT i.id AS invitation_id,i.token_hash,o.operation_id,o.result_generation::text AS generation FROM folio_intake_private.invitation i JOIN folio_intake_private.link_operation o ON o.invitation_id=i.id AND o.kind='ISSUE' WHERE i.turno_id=$1", [fixture.turnoId]);
        committedIssue = { responseStatus: response.status(), rows: committed.rows };
        issueRows = committed.rows.length;issuePhase = "db_done";
      } catch (error) { kind = interceptErrorKind(error); }
      finally {
        try { await route.abort("failed"); if (kind === "none") issuePhase = "abort_done"; }
        catch { if (kind === "none") kind = "abort"; }
        resolveIssue({ phase: issuePhase, status: issueStatus, rows: issueRows, kind });
      } // The real issue committed; only its browser response is lost.
    };
    await page.route(actionUrl, loseIssueResponse);
    await confirmIssue.click();
    const issueResult = await waitForIntercept(issueTerminal, 35_000, () => ({ phase: issuePhase, status: issueStatus, rows: issueRows, kind: "terminal_timeout" }));
    console.log(`intake_proof_issue_diagnostic:${interceptDiagnostic(issueResult.phase, issueResult.status, issueResult.rows, issueResult.kind)}`);
    expect(intercepted).toBe(true);
    expect(issueResult.kind).toBe("none");
    expect(issueResult.phase).toBe("abort_done");
    expect(committedIssue.responseStatus).toBe(200);
    expect(committedIssue.rows).toHaveLength(1);
    await expect(control.getByRole("button", { name: "Comprobar resultado" })).toBeVisible({ timeout: 30_000 });
    await expect(control.getByRole("button", { name: "Reintentar sin duplicar" })).toBeVisible();
    stage("staff_issue_response_lost");
    await page.unroute(actionUrl, loseIssueResponse);
    await control.getByRole("button", { name: "Comprobar resultado" }).click();
    const link = control.getByRole("textbox", { name: "Enlace para el formulario" });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const reconciled = await db.query("SELECT i.id AS invitation_id,i.token_hash,o.operation_id,o.result_generation::text AS generation FROM folio_intake_private.invitation i JOIN folio_intake_private.link_operation o ON o.invitation_id=i.id AND o.kind='ISSUE' WHERE i.turno_id=$1", [fixture.turnoId]);
    expect(reconciled.rows).toEqual(committedIssue.rows);
    stage("staff_issue_reconciled");
    const url = await link.inputValue();
    const match = /^http:\/\/localhost:4430\/aporte#token=([0-9a-f]{64})$/.exec(url);
    expect(match).not.toBeNull();
    const token = match![1]; // Kept only in test memory; never written to output or artifacts.
    stage("issued");

    const image = control.getByRole("img", { name: "Código QR local del enlace para este turno" });
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
    // Browser Canvas and Node pngjs can encode the same QR into different PNG bytes.
    // Read pixels from the image actually shown; neither pixels nor decoded URL enter an assertion payload.
    const qr = await image.evaluate(async element => {
      const img = element as HTMLImageElement;
      await img.decode();
      const width = img.naturalWidth, height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("intake_proof_qr_canvas_unavailable");
      context.drawImage(img, 0, 0);
      return { width, height, data: Array.from(context.getImageData(0, 0, width, height).data) };
    });
    expect(qr.width).toBe(224);
    expect(qr.height).toBe(224);
    expect(qrContainsExactUrl(qr, url)).toBe(true);
    stage("qr_local");
    const invitation = await db.query("SELECT token_hash,revoked_at FROM folio_intake_private.invitation WHERE turno_id=$1", [fixture.turnoId]);
    expect(invitation.rows).toHaveLength(1);
    expect(invitation.rows[0].revoked_at).toBeNull();
    expect(invitation.rows[0].token_hash).toBe(sha(Buffer.from(token, "hex")));
    expect(invitation.rows[0].token_hash).not.toBe(sha(Buffer.from(token, "utf8")));
    stage("token_hash_bound");

    async function openPublic() {
      const context = await browser.newContext();
      publicContexts.push(context);
      const patientPage = await context.newPage();
      await patientPage.goto(url);
      await expect(patientPage).toHaveURL("http://localhost:4430/aporte");
      await expect(patientPage.getByRole("heading", { name: "Compartí tus datos con el consultorio" })).toBeVisible();
      await expect(patientPage.getByRole("button", { name: "Enviar datos" })).toBeVisible({ timeout: 30_000 });
      const cookies = await context.cookies("http://localhost:4430/api/patient-intake");
      const session = cookies.find(item => item.name === "folio.intake.session");
      expect(session).toBeDefined();expect(session?.httpOnly).toBe(true);expect(session?.sameSite).toBe("Strict");
      expect(session?.path).toBe("/api/patient-intake");
      return patientPage;
    }

    const patient = await openPublic();
    stage("exchanged");
    await patient.getByRole("textbox", { name: "Nombre", exact: true }).fill("Ana Sintética");
    await patient.getByRole("textbox", { name: "Apellido", exact: true }).fill("Prueba B09");
    await patient.getByRole("button", { name: "Enviar datos" }).click();
    await expect(patient.getByText("Aporte recibido")).toBeVisible({ timeout: 30_000 });
    let submitted = await db.query("SELECT id,operation_id FROM folio_intake_private.submission WHERE invitation_id=(SELECT id FROM folio_intake_private.invitation WHERE turno_id=$1)", [fixture.turnoId]);
    expect(submitted.rows).toHaveLength(1);
    stage("submitted");

    await control.getByRole("button", { name: "Consultar aportes" }).click();
    await expect(control.getByText("Aportes recibidos")).toBeVisible({ timeout: 30_000 });
    await expect(control.getByText("Origen: aportado por el paciente.", { exact: false })).toBeVisible();
    await expect(control.getByText("Ana Sintética")).toBeVisible();
    stage("reviewed");

    const lost = await openPublic();
    await lost.getByRole("textbox", { name: "Nombre", exact: true }).fill("Berta Sintética");
    let lostOperation: string | null = null, submitPhase = "not_seen", submitStatus = 0, submitRows = 0;
    let resolveSubmit!: (result: InterceptResult) => void;
    const submitTerminal = new Promise<InterceptResult>(resolve => { resolveSubmit = resolve; });
    await lost.route("**/api/patient-intake/submit", async route => {
      let kind = "none";
      try {
        submitPhase = "payload";
        const payload = route.request().postDataJSON();
        if (typeof payload?.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.operationId)) { kind = "payload"; return; }
        lostOperation = payload.operationId;
        submitPhase = "fetch";
        const response = await route.fetch({ timeout: 30_000 });
        submitStatus = response.status();submitPhase = "response";
        submitPhase = "db_read";
        const committed = await db.query("SELECT id FROM folio_intake_private.submission WHERE operation_id=$1", [lostOperation]);
        submitRows = committed.rows.length;submitPhase = "db_done";
      } catch (error) { kind = interceptErrorKind(error); }
      finally {
        try { await route.abort("failed"); if (kind === "none") submitPhase = "abort_done"; }
        catch { if (kind === "none") kind = "abort"; }
        resolveSubmit({ phase: submitPhase, status: submitStatus, rows: submitRows, kind });
      } // The real POST committed; only its browser response is lost.
    });
    await lost.getByRole("button", { name: "Enviar datos" }).click();
    const submitResult = await waitForIntercept(submitTerminal, 35_000, () => ({ phase: submitPhase, status: submitStatus, rows: submitRows, kind: "terminal_timeout" }));
    console.log(`intake_proof_submit_diagnostic:${interceptDiagnostic(submitResult.phase, submitResult.status, submitResult.rows, submitResult.kind)}`);
    expect(submitResult.kind).toBe("none");
    expect(submitResult.phase).toBe("abort_done");
    expect(submitResult.status).toBe(200);
    expect(submitResult.rows).toBe(1);
    await expect(lost.getByRole("button", { name: "Consultar estado de este envío" })).toBeVisible({ timeout: 30_000 });
    expect(lostOperation).toMatch(/^[0-9a-f-]{36}$/i);
    submitted = await db.query("SELECT id FROM folio_intake_private.submission WHERE operation_id=$1", [lostOperation]);
    expect(submitted.rows).toHaveLength(1);
    stage("lost_response_committed");
    await lost.unroute("**/api/patient-intake/submit");
    await lost.getByRole("button", { name: "Consultar estado de este envío" }).click();
    await expect(lost.getByText("Aporte recibido")).toBeVisible({ timeout: 30_000 });
    submitted = await db.query("SELECT id FROM folio_intake_private.submission WHERE operation_id=$1", [lostOperation]);
    expect(submitted.rows).toHaveLength(1);
    stage("lost_response_reconciled");

    const revoked = await openPublic();
    await revoked.getByRole("textbox", { name: "Nombre", exact: true }).fill("Carla Sintética");
    await control.getByRole("button", { name: "Revocar enlace" }).click();
    await control.getByRole("group", { name: "Confirmar revocación del enlace" }).getByRole("button", { name: "Confirmar revocación" }).click();
    await expect(control.getByText(/Enlace revocado/)).toBeVisible({ timeout: 30_000 });
    let sentAfterRevoke = false;
    await revoked.route("**/api/patient-intake/submit", route => { sentAfterRevoke = true; return route.continue(); });
    await revoked.getByRole("button", { name: "Enviar datos" }).click();
    await expect(revoked.getByText("No pudimos comprobar el enlace antes de enviar. Tus datos siguen en esta pantalla.")).toBeVisible({ timeout: 30_000 });
    await expect(revoked.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Carla Sintética");
    expect(sentAfterRevoke).toBe(false);
    submitted = await db.query("SELECT id FROM folio_intake_private.submission WHERE invitation_id=(SELECT id FROM folio_intake_private.invitation WHERE turno_id=$1)", [fixture.turnoId]);
    expect(submitted.rows).toHaveLength(2);
    stage("revoked");
    const oldLink = await browser.newContext();publicContexts.push(oldLink);
    const oldPage = await oldLink.newPage();await oldPage.goto(url);
    await expect(oldPage.getByText(/El enlace no está disponible o venció/)).toBeVisible({ timeout: 30_000 });
    stage("old_link_rejected");

    const after = await db.query(preservedRows, [fixture.turnoId]);
    expect(after.rows).toEqual(before.rows);
    const events = await db.query("SELECT count(*)::int AS n FROM folio_intake_private.event WHERE kind='SUBMISSION_RECEIVED' AND invitation_id=(SELECT id FROM folio_intake_private.invitation WHERE turno_id=$1)", [fixture.turnoId]);
    expect(events.rows[0].n).toBe(2);
    stage("data_preserved");

    // End with a real authority revocation, after the unchanged-data comparison.
    // Only the disposable fixture's exact staff session is expired.
    await expect(control.getByText("Ana Sintética", { exact: true })).toBeVisible();
    const expired = await db.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id=(SELECT actor_session_id FROM folio_intake_private.link_operation WHERE turno_id=$1 AND kind='ISSUE') RETURNING id", [fixture.turnoId]);
    expect(expired.rowCount).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    // Revalidation can clear the control or redirect to verify access; neither
    // outcome may retain proposals read under the previous authorization.
    await expect(page.getByText("Ana Sintética", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    stage("staff_data_cleared_after_revocation");
  } finally {
    for (const context of publicContexts) await context.close().catch(() => {});
    await db.end();
  }
});
