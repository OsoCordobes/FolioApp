import assert from "node:assert/strict";
import test from "node:test";
import { collectConsistentMovements, EXPORT_MAX_BYTES, EXPORT_MAX_ROWS, type MovementPage } from "../../lib/finanzas/movements";
import type { FinanzasTransaccion } from "../../lib/db/finanzas";

const row = (id: number): FinanzasTransaccion => ({ id: String(id), fecha: "2026-09-01T03:00:00Z",
  paciente: "Synthetic", servicio: "Servicio", monto: 1.01, montoCents: "101", metodo: "efectivo", estado: "cobrado" });
const page = (rows: FinanzasTransaccion[], totalCount: number, next: string | null = null, revision = "v1"): MovementPage => ({
  rows, totalCount, nextCursor: next ? { id: next, createdAt: "2026-09-01T03:00:00Z" } : null, revision,
});

test("export collects 1501 rows in bounded pages, preserving cents", async () => {
  let offset = 0;
  const result = await collectConsistentMovements(async () => {
    const rows = Array.from({ length: Math.min(100, 1501 - offset) }, (_, n) => row(offset + n));
    offset += rows.length;
    return page(rows, 1501, offset < 1501 ? String(offset) : null);
  });
  assert.equal(result.length, 1501);
  assert.equal(result.at(-1)?.montoCents, "101");
});
test("export never returns partial content after a changed snapshot, network error or repeated row", async () => {
  for (const second of [page([row(2)], 2, null, "v2"), page([row(1)], 2), page([], 2), new Error("synthetic network")]) {
    let reads = 0;
    await assert.rejects(collectConsistentMovements(async () => {
      if (reads++ === 0) return page([row(1)], 2, "next");
      if (second instanceof Error) throw second;
      return second;
    }));
  }
});
test("row/byte limits and a stalled cursor reject the whole export", async () => {
  await assert.rejects(collectConsistentMovements(async () => page([], EXPORT_MAX_ROWS + 1)), /limit/);
  await assert.rejects(collectConsistentMovements(async () => page([{ ...row(1), servicio: "x".repeat(EXPORT_MAX_BYTES) }], 1)), /limit/);
  let id = 0;
  await assert.rejects(collectConsistentMovements(async () => page([row(++id)], 5, "unchanged")), /repeated/);
});
