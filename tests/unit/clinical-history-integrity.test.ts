import assert from "node:assert/strict";
import test from "node:test";
import { evolucionDesdeSesiones } from "../../lib/pdf/ficha-format";

test("full clinical PDF preserves more than ten sessions and correction provenance", () => {
  const enmiendas = [{ id: "e1", autorId: "member-1", createdAt: "2026-09-08T10:00:00Z", motivo: "Corrección de dato", texto: "Texto corregido" }];
  const sesiones = Array.from({ length: 2501 }, (_, i) => ({ fecha: String(i), servicio: "Consulta", cambio: "", soap: { s: "Original", o: "", a: "", p: "" }, enmiendas }));
  const result = evolucionDesdeSesiones(sesiones);
  assert.equal(result.length, 2501);
  assert.equal(result[2500].soap?.s, "Original");
  assert.deepEqual((result[0] as unknown as { enmiendas: unknown }).enmiendas, enmiendas);
});
