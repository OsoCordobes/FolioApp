// One-off read-only checkpoint for the owner's existing Folio project.
// This does not restore, deploy, schedule jobs, or certify recovery readiness.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { openEnvelope } from "../recovery/envelope.mjs";
import { createPostgresSource } from "./source.mjs";
import { createStorageReader } from "./storage.mjs";
import { createBackup } from "./core.mjs";
import { fileURLToPath } from "node:url";
import { authenticateAndRetain, runOwnedWorkflow, validateOwnedRoot, ownedFailure } from "./owned-workflow.mjs";
import { sealArtifact } from "./envelope.mjs";

const project = "grkpayhxndztlfwxobnt";
export async function captureOwned(root, { catchUp = false } = {}) {
  const passphrase = process.env.FOLIO_RECOVERY_PASSPHRASE;
  delete process.env.FOLIO_RECOVERY_PASSPHRASE;
  root = await validateOwnedRoot(root);
  return runOwnedWorkflow({ root, catchUp, capture: async () => {
  const privateKey = await readFile(
    path.join(root, "recipient-private.encrypted.pem"),
    "utf8",
  );
  const values = openEnvelope(
    JSON.parse(
      await readFile(
        path.join(root, "config-recovery/recover-verified.envelope.json"),
        "utf8",
      ),
    ),
    privateKey,
    passphrase,
    {
      operationId: "folio-config-recover-20260908-1",
      projectId: "prj_ZULHSw01qxl3yfJAqM1Zg4Q9pL0C",
      environment: "production",
    },
  );
  const url = new URL(values.POSTGRES_URL_NON_POOLING);
  if (
    url.hostname !== "aws-1-sa-east-1.pooler.supabase.com" ||
    decodeURIComponent(url.username) !== `postgres.${project}` ||
    (url.port && url.port !== "5432") ||
    url.pathname !== "/postgres"
  )
    throw new Error();
  // TLS is configured explicitly below; URL options cannot override it.
  url.search = "";
  const destination = path.join(root, "database-checkpoints");
  const observedConfig = JSON.parse(
    await readFile(path.join(root, "platform-observations.json"), "utf8"),
  );
  if (
    observedConfig.project !== project ||
    observedConfig.recoveryComplete !== false
  )
    throw new Error();
  const platformConfig = {
    ...observedConfig,
    application: { ...observedConfig.application, environment: values },
    custody: {
      keyFile: "recipient-private.encrypted.pem",
      passphraseStoredSeparately: false,
      ownerCustodyPending: true,
    },
  };
  const publicKey = await readFile(
    path.join(root, "recipient-public.pem"),
    "utf8",
  );
  const diagnosticDirectory = path.join(root, "backup-diagnostics");
  await mkdir(diagnosticDirectory, { recursive: true, mode: 0o700 });
  const result = await createBackup({
    destination,
    publicKey,
    platformConfig,
    source: createPostgresSource({
      databaseUrl: url.toString(),
      allowRemoteSource: true,
      confirmSourceHost: url.hostname,
      expectedServerMajor: 17,
      omitVerifiedEmptyPgsodiumKey: true,
      tools: {
        binDirectory: path.join(
          process.env.LOCALAPPDATA,
          "FolioTools/postgresql-17.11/pgsql/bin",
        ),
        sslRootCertFile: path.join(root, "supabase-prod-ca-2021.crt"),
        timeoutMs: 180000,
        diagnosticSink: async (body, summary) => {
          const id = `diagnostic_${randomUUID()}`;
          await sealArtifact(
            [body],
            path.join(diagnosticDirectory, `${id}.sealed`),
            publicKey,
            { backupId: id, artifact: "stderr" },
          );
          await writeFile(
            path.join(diagnosticDirectory, `${id}.json`),
            JSON.stringify({ id, ...summary }),
            { flag: "wx", mode: 0o600 },
          );
          console.log(
            JSON.stringify({
              event: "postgres_diagnostic_saved_encrypted",
              ...summary,
            }),
          );
        },
      },
    }),
    storage: createStorageReader({
      url: `https://${project}.supabase.co`,
      serviceKey: values.SUPABASE_SERVICE_ROLE_KEY,
    }),
    rotate: false,
  });
  await authenticateAndRetain({destination,result,privateKey,passphrase});
  }});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, confirmation, option, ...extra] = process.argv.slice(2);
    if (confirmation !== '--capture-owner-production-read-only' || (option !== undefined && option !== '--catch-up') || extra.length) throw Error('owned_path_invalid');
    console.log(JSON.stringify(await captureOwned(root,{catchUp:option === '--catch-up'})));
  } catch (error) {
    const failure = ownedFailure(error);
    console.error(JSON.stringify({status:failure.status,productionWrites:0}));
    process.exitCode = failure.exitCode;
  } finally { delete process.env.FOLIO_RECOVERY_PASSPHRASE; }
}
