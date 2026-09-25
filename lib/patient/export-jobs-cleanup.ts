import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { privateExportBucket } from "./export-jobs-storage-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^([0-9]{5})\.bin$/;

/** Explicit private maintenance call; no cron or client route is installed. */
export async function claimDueExportPackageCleanup(): Promise<Result<{
  jobId: string; token: string; revision: number;
} | null>> {
  try {
    const service = createSupabaseServiceClient();
    const expired = await service.rpc("export_package_expire_due", { p_limit: 50 });
    if (expired.error) throw new Error("expire_failed");
    const due = await service.rpc("export_package_cleanup_due", { p_limit: 1 });
    const item = Array.isArray(due.data) && due.data.length === 1 ? due.data[0] : null;
    if (due.error || !Array.isArray(due.data) || due.data.length > 1) throw new Error("due_failed");
    if (!item) return ok(null);
    if (!UUID.test(String(item.job_id)) || !Number.isSafeInteger(item.revision)) throw new Error("due_invalid");
    const claimed = await service.rpc("export_package_cleanup_claim", {
      p_id: item.job_id, p_revision: item.revision,
    });
    const lease = Array.isArray(claimed.data) && claimed.data.length === 1 ? claimed.data[0] : null;
    if (claimed.error || !lease || !UUID.test(String(lease.cleanup_token)) ||
        !Number.isSafeInteger(lease.revision) || lease.revision !== item.revision + 1) {
      throw new Error("cleanup_claim_uncertain");
    }
    return ok({ jobId: item.job_id, token: lease.cleanup_token, revision: lease.revision });
  } catch {
    return err("db_error", "No se pudo confirmar la limpieza. Consultá su estado antes de reintentar.");
  }
}

/** One bounded page, always under an expiry-only CAS. Only names within a
 * ledger-derived job/entry prefix and expected ordinal range can be removed. */
export async function cleanupExportPackageStep(
  jobId: string, token: string, revision: number,
): Promise<Result<{ complete: boolean }>> {
  if (!UUID.test(jobId) || !UUID.test(token) ||
      !Number.isSafeInteger(revision) || revision < 0) {
    return err("validation", "La limpieza solicitada es inválida.");
  }
  try {
    const service = createSupabaseServiceClient();
    const renew = async () => {
      const { data, error } = await service.rpc("export_package_cleanup_renew", {
        p_id: jobId, p_token: token, p_revision: revision,
      });
      if (error || data !== true) throw new Error("cleanup_lease_lost");
    };
    await renew();
    const { data, error } = await service.rpc("export_package_cleanup_entry_read", {
      p_id: jobId, p_token: token, p_revision: revision,
    });
    if (error || !Array.isArray(data) || data.length > 10) throw new Error("cleanup_inventory_failed");
    const bucket = privateExportBucket();
    for (const entry of data) {
      if (!UUID.test(String(entry.entry_id)) || !Number.isSafeInteger(entry.expected_fragments) ||
          entry.expected_fragments < 0 || entry.expected_fragments > 10000) {
        throw new Error("cleanup_entry_invalid");
      }
      await renew();
      const prefix = `${jobId}/${entry.entry_id}`;
      const listed = await bucket.list(prefix, { limit: 100, offset: 0 });
      if (listed.error || !listed.data || listed.data.length > 100) throw new Error("cleanup_list_failed");
      const paths = listed.data.map(file => {
        const match = FILE.exec(file.name);
        if (!match || Number(match[1]) >= entry.expected_fragments || !file.id) {
          throw new Error("unexpected_private_object");
        }
        return `${prefix}/${file.name}`;
      });
      if (paths.length) {
        const reset = await service.rpc("export_package_cleanup_entry_confirm", {
          p_id: jobId, p_token: token, p_revision: revision, p_entry: entry.entry_id,
          p_empty: false,
        });
        if (reset.error || reset.data !== false) throw new Error("cleanup_scan_reset_failed");
        const removed = await bucket.remove(paths);
        if (removed.error) throw new Error("cleanup_remove_failed");
      }
      const remaining = await bucket.list(prefix, { limit: 1, offset: 0 });
      if (remaining.error || !remaining.data) throw new Error("cleanup_readback_failed");
      if (remaining.data.length) return ok({ complete: false });
      const confirmed = await service.rpc("export_package_cleanup_entry_confirm", {
        p_id: jobId, p_token: token, p_revision: revision, p_entry: entry.entry_id,
        p_empty: true,
      });
      if (confirmed.error || typeof confirmed.data !== "boolean") throw new Error("cleanup_entry_uncertain");
    }
    await renew();
    const after = await service.rpc("export_package_cleanup_entry_read", {
      p_id: jobId, p_token: token, p_revision: revision,
    });
    if (after.error || !Array.isArray(after.data)) throw new Error("cleanup_status_failed");
    if (after.data.length) return ok({ complete: false });
    const confirmed = await service.rpc("export_package_cleanup_confirm", {
      p_id: jobId, p_token: token, p_revision: revision,
    });
    if (confirmed.error || confirmed.data !== true) throw new Error("cleanup_finish_uncertain");
    return ok({ complete: true });
  } catch {
    return err("db_error", "No se pudo confirmar la limpieza. Consultá su estado antes de reintentar.");
  }
}
