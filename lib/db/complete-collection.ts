/** Read a complete, stably ordered collection. A short server page is not EOF.
 * Callers must request exact counts and order by a unique final key (usually id).
 * Concurrent inserts/deletes or repeated pages abort instead of certifying a partial export.
 */
export async function readCompleteCollection<T extends { id: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  const fail = () => ({ data: null, error: { message: "No se pudo leer la historia completa. Intentá nuevamente." } } as const);
  try {
    do {
      const result = await page(rows.length, rows.length + 499);
      if (result.error || result.data === null || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) return fail();
      if (total !== undefined && result.count !== total) return fail();
      total = result.count;
      if (result.data.length === 0 && rows.length < total) return fail();
      for (const row of result.data) {
        if (!row.id || seen.has(row.id)) return fail();
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length > total) return fail();
    } while (rows.length < total);
    return { data: rows, error: null };
  } catch {
    return fail();
  }
}
