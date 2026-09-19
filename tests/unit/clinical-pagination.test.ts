import assert from "node:assert/strict";
import test from "node:test";
import { readCompleteCollection } from "../../lib/db/complete-collection";

test("reads all 2501 records even when the server caps each page below requested size", async () => {
  const rows = Array.from({ length: 2501 }, (_, id) => ({ id: String(id) }));
  const result = await readCompleteCollection(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + 113)), error: null, count: rows.length }));
  assert.deepEqual(result, { data: rows, error: null });
});

test("a later page failure never returns partial clinical data", async () => {
  const result = await readCompleteCollection(async (from) => from === 0
    ? { data: [{ id: "1" }], count: 2, error: null }
    : { data: null, count: null, error: { message: "Unavailable" } });
  assert.equal(result.data, null);
  assert.ok(result.error);
});

test("missing counts, premature empty pages, changing totals and duplicate rows fail explicitly", async () => {
  for (const mode of ["missing", "empty", "changed", "duplicate"]) {
    const result = await readCompleteCollection(async (from) => ({
      data: mode === "empty" && from > 0 ? [] : [{ id: mode === "duplicate" ? "1" : String(from) }],
      count: mode === "missing" ? null : mode === "changed" && from > 0 ? 3 : 2,
      error: null,
    }));
    assert.equal(result.data, null, mode);
    assert.ok(result.error, mode);
  }
});
