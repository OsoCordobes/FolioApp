import { z } from "zod";
import type { PacienteDirRow } from "@/lib/db/pacientes-dir";

export const directoryFilterSchema = z.object({
  query: z.string().trim().max(200).default(""),
  status: z.enum(["todos", "activos", "nuevos", "reactivar", "inactivos", "alta"]).default("todos"),
  coverage: z.string().max(200).default("todas"),
});
export type DirectoryFilter = z.infer<typeof directoryFilterSchema>;
export const directoryRequestSchema = directoryFilterSchema.extend({ cursor: z.string().max(2048).nullable().optional() });
export interface DirectoryPage {
  rows: PacienteDirRow[];
  total: number;
  counts: Record<string, number>;
  coberturas: string[];
  nextCursor: string | null;
  revision: string;
  cutoff: string;
}
export const DIRECTORY_EXPORT_MAX_ROWS = 10_000;
export const DIRECTORY_EXPORT_MAX_BYTES = 4 * 1024 * 1024;

/** No partial result escapes. Each fetch must reauthorize the active session. */
export async function collectDirectoryExport(fetchPage: (cursor: string | null, cutoff?: string) => Promise<DirectoryPage>): Promise<PacienteDirRow[]> {
  const rows: PacienteDirRow[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let first: DirectoryPage | undefined;
  let bytes = 0;
  do {
    const page = await fetchPage(cursor, first?.cutoff);
    first ??= page;
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > DIRECTORY_EXPORT_MAX_ROWS ||
      page.total !== first.total || page.revision !== first.revision || page.cutoff !== first.cutoff ||
      page.rows.length > 100 || (page.nextCursor && page.rows.length === 0)) throw new Error("directory_export_changed");
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error("directory_export_duplicate");
      ids.add(row.id);
      bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (bytes > DIRECTORY_EXPORT_MAX_BYTES || rows.length >= DIRECTORY_EXPORT_MAX_ROWS) throw new Error("directory_export_limit");
      rows.push(row);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("directory_export_cycle");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (rows.length !== first.total) throw new Error("directory_export_incomplete");
  // Recheck the entire authorized result after the last page, including empty exports.
  const final = await fetchPage(null, first.cutoff);
  if (final.revision !== first.revision || final.total !== first.total || final.cutoff !== first.cutoff) throw new Error("directory_export_changed");
  return rows;
}
