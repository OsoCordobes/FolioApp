import assert from "node:assert/strict";
import test from "node:test";
import { promotePedidoToTurno } from "../../lib/db/pedidos";
import { decidirDedupe, type DedupeSets } from "../../lib/import/pacientes-csv";

test("siblings sharing a contact remain separate import candidates with or without DNI", () => {
  const existing: DedupeSets = { dni: new Set(["parent-dni"]), telefono: new Set(["family-contact"]) };
  const seen: DedupeSets = { dni: new Set(), telefono: new Set() };
  for (const dni of ["child-a", "child-b", null]) {
    assert.equal(decidirDedupe({ dni, telefono: "family-contact" }, existing, seen), "importar");
  }
  assert.equal(decidirDedupe({ dni: "child-a", telefono: "other" }, existing, seen), "duplicado_en_archivo");
});

test("legacy phone uniqueness error never resolves a booking to a different family member", async () => {
  process.env.FOLIO_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.FOLIO_ENC_HMAC_KEY ??= Buffer.alloc(32, 8).toString("base64");
  const reads: string[] = [];
  const client = {
    rpc: async () => ({ data: false, error: null }),
    from(table: string) {
      let inserting = false;
      const builder = {
        insert() { inserting = true; return builder; },
        select() { if (!inserting) reads.push(table); return builder; },
        eq() { return builder; }, is() { return builder; },
        single: async () => ({ data: null, error: { code: "23505", message: "paciente_identidad_telefono_unique_active" } }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return builder;
    },
  };
  const result = await promotePedidoToTurno(client as unknown as Parameters<typeof promotePedidoToTurno>[0], {
    pedidoId: "request", organizationId: "org", profesionalId: "member", servicioId: "service",
    fechaPropuesta: "2026-10-01T13:00:00-03:00", duracionMin: 30, precioCents: 30000,
    canal: "WEB", nombre: "Synthetic Child", telefono: "+54 351 555 0100", email: null, motivo: null,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(reads, [], "contact collision must never look up and reuse a clinical identity");
});
