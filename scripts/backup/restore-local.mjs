#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { restoreDatabase } from "./restore.mjs";
import { restoreStorageLocal } from "./storage-restore.mjs";
import { safeRestoreDiagnostic, safeStorageInspectFromError, classifyPgRestoreStderr } from "./restore-diagnostics.mjs";
import { captureC01PgRestoreFailure } from "./c01-sealed-diagnostic.mjs";
let phase = "unknown";
let pgRestoreCategory = null;
try {
  const [configFile] = process.argv.slice(2);
  if (!configFile || process.argv.length !== 3) throw new Error();
  const c = JSON.parse(await readFile(configFile, "utf8"));
  if (c.phase && !["database", "storage"].includes(c.phase)) throw new Error();
  phase = c.phase === "storage" ? "storage" : "database";
  const c01Diagnostics = process.env.FOLIO_BACKUP_RESTORE_DIAGNOSTICS === "c01";
  const options = {
    ...c,
    privateKey: await readFile(c.recipientPrivateKeyFile, "utf8"),
    passphrase: process.env.FOLIO_BACKUP_RESTORE_PASSPHRASE,
    ...(c01Diagnostics && c.phase !== "storage" ? {tools:{...c.tools,diagnosticSink:async(stderr,metadata)=>{
      if(metadata.stage===null){
        pgRestoreCategory=classifyPgRestoreStderr(stderr);
        await captureC01PgRestoreFailure(stderr,metadata);
      }
    }}} : {}),
  };
  const result =
    c.phase === "storage"
      ? await restoreStorageLocal({
          ...options,
          serviceKey: process.env.FOLIO_BACKUP_RESTORE_STORAGE_SERVICE_KEY,
        })
      : await restoreDatabase({
          ...options,
          databaseUrl: process.env.FOLIO_BACKUP_RESTORE_DATABASE_URL,
        });
  console.log(JSON.stringify(result));
} catch (error) {
  if (process.env.FOLIO_BACKUP_RESTORE_DIAGNOSTICS === "c01") {
    if(phase==='database'&&pgRestoreCategory)
      console.error(`c01_pg_restore_diagnostic category=${pgRestoreCategory}`);
    if(phase==='storage'){
      const http=safeStorageInspectFromError(error);
      if(http)console.error(`c01_storage_inspect_http status=${http.status} code=${http.code}`);
    }
    // Revalidate the fixed Storage cause carried by a pending restore error.
    const diagnostic = safeRestoreDiagnostic(error, phase);
    console.error(`c01_restore_diagnostic phase=${diagnostic.phase} category=${diagnostic.category} code=${diagnostic.code}`);
  }
  console.error(
    "restore_pending: database phase is transactional; Storage can be partially restored. Keep the journal and verified files; inspect local prerequisites and resume the same phase.",
  );
  process.exitCode = 1;
}
