import "server-only";
import { z } from "zod";
import { canExportCompleteClinicalHistory, COMPLETE_HISTORY_PERMISSION_MESSAGE } from "@/lib/auth/clinical-export-scope";
import { getActiveSession, type ActiveSession } from "@/lib/db/session";
import { getPacientesDirectorio } from "@/lib/db/pacientes-dir";
import { err, ok, type Result } from "@/lib/db/errors";
import type { DirectoryPage } from "@/lib/pacientes/directory";

const requestSchema = z.object({ query: z.string().trim().max(200).default(""), cursor: z.string().max(2048).nullable().optional() }).strict();
export interface ClinicalArchivePage {
  patients: Array<{ id: string; name: string }>;
  total: number;
  nextCursor: string | null;
  scope: { userId: string; organizationId: string };
}
interface Dependencies {
  getSession: () => Promise<Result<ActiveSession>>;
  readPage: (input: unknown, cutoff?: string, context?: { organizationId: string; memberId: string }) => Promise<Result<DirectoryPage>>;
}

/** Read-only continuity after commercial suspension. No service-role client or billing exemption. */
export async function readClinicalArchive(input: unknown, dependencies: Dependencies = {
  getSession: getActiveSession, readPage: getPacientesDirectorio,
}): Promise<Result<ClinicalArchivePage>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Revisá la búsqueda y volvé a intentar.");
  try {
    const before = await dependencies.getSession();
    if (!before.ok) return before;
    const actor = before.data;
    if (!canExportCompleteClinicalHistory(actor.role, actor.esColegiado)) return err("forbidden", COMPLETE_HISTORY_PERMISSION_MESSAGE);
    const page = await dependencies.readPage({ ...parsed.data, status: "todos", coverage: "todas" }, undefined,
      { organizationId: actor.organizationId, memberId: actor.memberId });
    if (!page.ok) return page;
    // Recheck identity, membership and MFA after the read. Each download additionally
    // reauthorizes its own patient and complete clinical scope at delivery time.
    const after = await dependencies.getSession();
    if (!after.ok) return after;
    if (after.data.userId !== actor.userId || after.data.organizationId !== actor.organizationId ||
      after.data.memberId !== actor.memberId || !canExportCompleteClinicalHistory(after.data.role, after.data.esColegiado)) {
      return err("forbidden", "Tu acceso cambió. Volvé a abrir el archivo clínico.");
    }
    return ok({ patients: page.data.rows.map(row => ({ id: row.id, name: row.nombre })),
      total: page.data.total, nextCursor: page.data.nextCursor,
      scope: { userId: after.data.userId, organizationId: after.data.organizationId } });
  } catch {
    return err("network", "No pudimos consultar las historias. Volvé a intentar.");
  }
}
