import { recipientFingerprint, sealArtifact } from "./envelope.mjs";
import { chown, lstat, readFile } from "node:fs/promises";
import path from "node:path";

const EXPECTED_RECIPIENT = "609ccec0c317088256a01f259c11e333823318759a0b7ca54123211c3c080230";
const MAX_STDERR_BYTES = 65536;
const PUBLIC_KEY = new URL("../recovery/c01-diagnostic-public.pem", import.meta.url);

export function c01DiagnosticContext(env) {
  if (
    env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux" ||
    env.FOLIO_C01_SEAL_PG_RESTORE_ERROR !== "1" ||
    process.platform !== "linux" ||
    !/^[a-f0-9]{40}$/.test(env.C01_CHECKED_OUT_SHA ?? "") ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !path.isAbsolute(env.RUNNER_TEMP ?? "")
  ) return null;
  return {
    checkedOutSha: env.C01_CHECKED_OUT_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    stage: "pg_restore",
  };
}

/** The diagnostic is already bounded by monitorPostgresChild. Bound it again
 * here so this contract remains safe if the caller changes. */
export async function sealBoundedDiagnostic(stderr, file, publicKeyPem, context) {
  if (!Buffer.isBuffer(stderr) || stderr.length === 0 ||
      !path.isAbsolute(file) || context?.stage !== "pg_restore")
    throw new Error("c01_diagnostic_contract_invalid");
  return sealArtifact([stderr.subarray(0, MAX_STDERR_BYTES)], file, publicKeyPem, context);
}

/** Called only by the C01 pg_restore sink. No diagnostic bytes enter an error. */
export async function captureC01PgRestoreFailure(stderr, metadata, env = process.env) {
  if (metadata?.stage !== null || metadata?.exitCode === 0 && !metadata?.stderrBytes)
    return false;
  if (!Buffer.isBuffer(stderr) || stderr.length === 0) return false;
  const context = c01DiagnosticContext(env);
  if (!context) return false;
  const file = path.join(env.RUNNER_TEMP, "c01-pg-restore-error.sealed");
  const owner = await lstat(env.RUNNER_TEMP);
  if (!owner.isDirectory() || owner.uid < 1 || owner.gid < 1)
    throw new Error("c01_diagnostic_owner_invalid");
  const publicKeyPem = await readFile(PUBLIC_KEY, "utf8");
  if (recipientFingerprint(publicKeyPem) !== EXPECTED_RECIPIENT)
    throw new Error("c01_diagnostic_recipient_invalid");
  try {
    await lstat(file);
    throw new Error("c01_diagnostic_file_exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await sealBoundedDiagnostic(stderr, file, publicKeyPem, context);
    await chown(file, owner.uid, owner.gid);
    return true;
  } catch {
    throw new Error("c01_diagnostic_capture_failed");
  }
}
