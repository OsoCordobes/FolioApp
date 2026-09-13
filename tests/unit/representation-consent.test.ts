import assert from "node:assert/strict";
import test from "node:test";
import { validateDecision, representationAllows, signatureParticipants } from "../../lib/consentimientos/decision";

const representation = { estado: "VERIFICADA", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31", revocadoEn: null, alcances: ["CONSENTIMIENTO"], identidadVerificada: true, vinculoVerificado: true };
test("only a verified current explicitly scoped representation authorizes an action", () => {
  assert.equal(representationAllows(representation,"CONSENTIMIENTO","2026-09-08"),true);
  for(const change of [{estado:"PENDIENTE"},{revocadoEn:"2026-09-01"},{vigenciaDesde:"2027-01-01"},{vigenciaHasta:"2026-09-07"},{identidadVerificada:false},{vinculoVerificado:false},{alcances:["AGENDA"]}]) {
    assert.equal(representationAllows({...representation,...change},"CONSENTIMIENTO","2026-09-08"),false);
  }
  assert.equal(representationAllows(representation,"NARRATIVA_CLINICA","2026-09-08"),false);
});
test("an act-specific clinical assessment is required; age and template do not choose a signer", () => {
  const base={modo:"AUTONOMO",fundamento:"Evaluación profesional de comprensión y decisión sobre este acto.",participacion:"Paciente informado y escuchado.",riesgo:"EVALUADO",tutorId:null};
  assert.equal(validateDecision(base).ok,true);
  assert.equal(validateDecision({...base,fundamento:""}).ok,false);
  assert.equal(validateDecision({...base,modo:"ASISTIDO"}).ok,false);
  assert.equal(validateDecision({...base,modo:"REPRESENTADO"}).ok,false);
  assert.equal(validateDecision({...base,modo:"PENDIENTE"}).ok,true);
});
test("assisted consent retains both participants; representation never impersonates the patient", () => {
  assert.deepEqual(signatureParticipants("AUTONOMO"),["PACIENTE"]);
  assert.deepEqual(signatureParticipants("ASISTIDO"),["PACIENTE","REPRESENTANTE"]);
  assert.deepEqual(signatureParticipants("REPRESENTADO"),["REPRESENTANTE"]);
  assert.deepEqual(signatureParticipants("PENDIENTE"),[]);
});
