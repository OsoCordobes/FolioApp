import type { FinanzasTransaccion } from "@/lib/db/finanzas";

export interface MovementCursor { createdAt: string; id: string }
export interface MovementFilter {
  status: "todos" | "cobrados" | "pendientes";
  query: string;
}
export interface MovementPage {
  rows: FinanzasTransaccion[];
  totalCount: number;
  nextCursor: MovementCursor | null;
  revision: string | null;
}

export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** No partial result escapes. Each page must describe the same database revision. */
export async function collectConsistentMovements(
  fetchPage: (cursor: MovementCursor | null) => Promise<MovementPage>,
): Promise<FinanzasTransaccion[]> {
  const rows: FinanzasTransaccion[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: MovementCursor | null = null;
  let revision: string | null = null;
  let total = -1;
  let bytes = 0;
  do {
    const page = await fetchPage(cursor);
    if (!page.revision || (revision !== null && revision !== page.revision)
      || (total !== -1 && total !== page.totalCount)) throw new Error("finance_export_changed");
    revision = page.revision;
    total = page.totalCount;
    if (!Number.isSafeInteger(total) || total < 0 || total > EXPORT_MAX_ROWS) throw new Error("finance_export_limit");
    for (const row of page.rows) {
      if (seen.has(row.id)) throw new Error("finance_export_repeated");
      seen.add(row.id);
      bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (bytes > EXPORT_MAX_BYTES || rows.length >= EXPORT_MAX_ROWS) throw new Error("finance_export_limit");
      rows.push(row);
    }
    cursor = page.nextCursor;
    if (cursor) {
      const key = `${cursor.createdAt}|${cursor.id}`;
      if (cursors.has(key) || page.rows.length === 0) throw new Error("finance_export_repeated");
      cursors.add(key);
    }
  } while (cursor);
  if (rows.length !== total) throw new Error("finance_export_incomplete");
  return rows;
}
