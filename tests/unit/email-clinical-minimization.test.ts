import assert from "node:assert/strict";
import test from "node:test";
import { buildPostVisitaEmail } from "../../lib/email/templates/recordatorio-turno";
test("post-visit mail contains only administrative notice even when legacy caller provides clinical narrative", () => {
  const {html,subject}=buildPostVisitaEmail({pacienteNombre:"Persona",profesionalNombre:"Consultorio",memoCorto:"DIAGNOSTICO_PRIVADO: contenido clínico."});
  assert.ok(!html.includes("DIAGNOSTICO_PRIVADO"));
  assert.ok(!subject.includes("DIAGNOSTICO_PRIVADO"));
  assert.match(html,/\/portal/);
});
