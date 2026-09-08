import assert from "node:assert/strict";
import test from "node:test";
import { collectDirectoryExport, directoryFilterSchema, type DirectoryPage } from "../../lib/pacientes/directory";
import type { PacienteDirRow } from "../../lib/db/pacientes-dir";
const row = (id: string): PacienteDirRow => ({ id, nombre: "Sintético", tel: "3515550100", email: "", tipo: "nuevo", sesiones: 0, ultima: null, proximo: null, tags: [], estado: "activo", cobertura: null, coberturaPlan: null });
const page = (rows: PacienteDirRow[], total: number, nextCursor: string | null = null): DirectoryPage => ({ rows, total, nextCursor, revision: "a".repeat(32), cutoff: "2026-09-08T00:00:00.123456+00:00", counts: { todos: total }, coberturas: [] });
test("directory exports beyond 1000 and keeps shared contacts as separate patients", async () => {
  const all = Array.from({ length: 1205 }, (_, i) => row(String(i)));
  let reads = 0;
  const result = await collectDirectoryExport(async (cursor, cutoff) => {
    reads++;
    const offset = Number(cursor ?? 0);
    if (reads > 1) assert.equal(cutoff, page([], 0).cutoff);
    return page(all.slice(offset, offset + 50), all.length, offset + 50 < all.length ? String(offset + 50) : null);
  });
  assert.equal(result.length, 1205);
  assert.equal(reads, 26); // 25 pages + final whole-set revision validation
  assert.equal(new Set(result.map(r => r.id)).size, 1205);
});
for (const scenario of ["revision", "count", "duplicate", "empty", "cycle", "limit", "truncated", "network", "final-revision"] as const) {
  test(`directory export fails closed: ${scenario}`, async () => {
    let calls = 0;
    await assert.rejects(() => collectDirectoryExport(async () => {
      calls++;
      if (scenario === "limit") return page([], 10_001);
      if (scenario === "truncated") return page([row("a")], 2);
      if (scenario === "network") throw new Error("synthetic");
      if (scenario === "final-revision") return { ...page([row("a")], 1), revision: calls > 1 ? "b".repeat(32) : "a".repeat(32) };
      if (calls === 1) return page([row("a")], 2, "next");
      if (scenario === "revision") return { ...page([row("b")], 2), revision: "b".repeat(32) };
      if (scenario === "count") return page([row("b")], 3);
      if (scenario === "duplicate") return page([row("a")], 2);
      if (scenario === "empty") return page([], 2, "other");
      return page([row("b")], 2, "next");
    }));
  });
}
test("directory filters reject unsupported values and oversized queries", () => {
  assert.equal(directoryFilterSchema.safeParse({ status: "private", query: "x" }).success, false);
  assert.equal(directoryFilterSchema.safeParse({ query: "x".repeat(201) }).success, false);
  assert.deepEqual(directoryFilterSchema.parse({}), { query: "", status: "todos", coverage: "todas" });
});
