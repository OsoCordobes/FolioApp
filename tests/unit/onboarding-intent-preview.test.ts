import assert from "node:assert/strict";
import test from "node:test";

import { parseOnboardingIntent } from "../../lib/onboarding/intent";
import { toOnboardingLandingPreview } from "../../lib/onboarding/public-preview";
import type { OnboardingDataState } from "../../components/onboarding/steps";

const base: OnboardingDataState = {
  email: "", password: "", nombre: "", apellido: "", matricula: "", tel: "",
  consultorioNombre: "", rubro: "", especialidad: "", tipo: null, ownerTratante: null,
  direccion: "", ciudad: "", provincia: "", instagram: "", telefonoPublico: "",
  bio: "", acento: "#8A6722", logoUrl: null, cardMood: "editorial",
  diasActivos: [], franjas: [], slotMin: 45, servicios: [],
};

test("la intención sin confirmación no inventa modalidad ni titular", () => {
  for (const input of [null, "{}", "{", JSON.stringify({ tipo: "INDEPENDIENTE", ownerTratante: false }),
    JSON.stringify({ tipo: "CLINICA" }), JSON.stringify({ tipo: "OTRA", ownerTratante: true })]) {
    assert.equal(parseOnboardingIntent(input), null);
  }
  assert.deepEqual(parseOnboardingIntent('{"tipo":"CLINICA","ownerTratante":false}'),
    { tipo: "CLINICA", ownerTratante: false });
});

test("borrador de clínica no atribuye identidad profesional al titular administrativo", () => {
  const preview = toOnboardingLandingPreview({ ...base,
    tipo: "CLINICA", ownerTratante: false, nombre: "Ana", apellido: "Costa",
    matricula: "M.P. 123", consultorioNombre: "Clínica Ejemplo",
    servicios: [{ id: 1, nombre: "Evaluación", dur: 30, precio: 25000 }],
  }, "clinica-ejemplo");
  assert.equal(preview?.org.nombre, "Clínica Ejemplo");
  assert.equal(preview?.profesional, null);
  assert.deepEqual(preview?.profesionales, []);
  assert.equal(preview?.servicios[0]?.precio_cents, 2_500_000);
  assert.equal(JSON.stringify(preview).includes("M.P. 123"), false);
  assert.equal(JSON.stringify(preview).includes("Ana Costa"), false);
});

test("independiente usa el nombre y matrícula que completó en su perfil", () => {
  assert.equal(toOnboardingLandingPreview(base), undefined);
  const preview = toOnboardingLandingPreview({ ...base,
    tipo: "INDEPENDIENTE", ownerTratante: true, nombre: "Ana", apellido: "Costa", matricula: "123",
  });
  assert.equal(preview?.profesional?.displayName, "Ana Costa");
  assert.equal(preview?.profesional?.matricula, "123");
});
