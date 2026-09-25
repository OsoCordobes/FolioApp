import assert from "node:assert/strict";
import { expect, test } from "../fixtures/local-test";
import { assertBrowserActor, createClinicalCaseFixture, loginClinical } from "../fixtures/clinical-local";
import { prepareSavedVisit } from "../fixtures/clinical-journey";

test.skip(process.env.FOLIO_TEST_CLINICAL !== "1", "Requires the dedicated synthetic local Supabase/Auth fixture with M133.");

for (const role of ["ASISTENTE", "COORDINADOR"] as const) {
  test(`${role} sees the scoped week and month, without clinical fields or a foreign tenant`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const fixture = await createClinicalCaseFixture({ receptionRole: role, foreignOwner: true });
    try {
      const ownerPage = await fixture.newPage(browser);
      await loginClinical(fixture, ownerPage, fixture.owner);
      const visit = await prepareSavedVisit(ownerPage, fixture, { attachment: false });
      await fixture.closeContext(ownerPage.context());
      assert.ok(fixture.reception && fixture.foreign);

      const { rows: [{ local_day: day, estado: initialState, revision: initialRevision }] } = await fixture.db.query<{ local_day: string; estado: string; revision: number }>(
        "SELECT to_char(t.inicio AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS local_day,t.estado,s.revision FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1 AND s.id=$2",
        [visit.turnoId, visit.sessionId],
      );
      const monday = new Date(`${day}T00:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      const weekStart = monday.toISOString().slice(0, 10);
      const weekEnd = sunday.toISOString().slice(0, 10);

      const receptionPage = await fixture.newPage(browser);
      await loginClinical(fixture, receptionPage, fixture.reception);
      const { client } = await assertBrowserActor(fixture, receptionPage, fixture.reception);
      const scoped = await client.rpc("agenda_recepcion_rango", {
        p_org: fixture.owner.organizationId, p_desde: weekStart, p_hasta: weekEnd, p_profesional: fixture.owner.memberId,
      });
      expect(scoped.error).toBeNull();
      expect(scoped.data?.map((row: { id: string }) => row.id)).toContain(visit.turnoId);
      expect(Object.keys(scoped.data![0]).sort()).toEqual([
        "duracion_min", "estado", "id", "inicio", "modalidad", "organization_id", "origen",
        "paciente_apellido_cifrado", "paciente_id", "paciente_nombre_cifrado", "paciente_telefono_cifrado",
        "profesional_id", "servicio_nombre",
      ]);
      const foreign = await client.rpc("agenda_recepcion_rango", {
        p_org: fixture.foreign.organizationId, p_desde: weekStart, p_hasta: weekEnd, p_profesional: null,
      });
      expect(foreign.error?.code).toBe("42501");
      expect(foreign.data).toBeNull();

      await receptionPage.goto(`/calendario?w=${weekStart}&prof=${fixture.owner.memberId}`);
      await expect(receptionPage.getByRole("heading", { name: "Calendario" })).toBeVisible();
      await expect(receptionPage.locator(".cal-turno")).toHaveCount(1);
      await expect(receptionPage.locator(".cal-turno")).toHaveAttribute("aria-label", new RegExp(`E2E ${fixture.runId}`));
      await expect(receptionPage.locator("body")).not.toContainText(visit.marker);
      await receptionPage.goto(`/calendario?vista=mes&mes=${day.slice(0, 7)}&prof=${fixture.owner.memberId}`);
      await expect(receptionPage.getByRole("group", { name: "Vista del calendario" }).getByRole("button", { name: "Mes" })).toHaveAttribute("aria-pressed", "true");
      await expect(receptionPage.locator(".cal-mes-event-btn")).toHaveCount(1);
      await receptionPage.locator(".cal-mes-event-btn").click();
      await expect(receptionPage.getByRole("dialog")).toContainText(`E2E ${fixture.runId}`);
      await expect(receptionPage.locator("body")).not.toContainText(visit.marker);

      const { rows: [after] } = await fixture.db.query<{ estado: string; revision: number; sessions: number; closes: number }>(
        "SELECT t.estado,s.revision,(SELECT count(*)::int FROM public.sesion WHERE turno_id=t.id) AS sessions,(SELECT count(*)::int FROM public.transicion WHERE turno_id=t.id AND to_estado='CERRADO') AS closes FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1 AND s.id=$2",
        [visit.turnoId, visit.sessionId],
      );
      expect(after).toEqual({ estado: initialState, revision: initialRevision, sessions: 1, closes: 0 });

      await testInfo.attach("reception-calendar.json", {
        contentType: "application/json",
        body: JSON.stringify({ role, synthetic: true, scopedWeek: weekStart, month: day.slice(0, 7), foreignTenant: "42501", clinicalMarker: "absent", receptionDidNotStartOrCloseCare: true }),
      });
    } finally {
      await fixture.close();
    }
  });
}
