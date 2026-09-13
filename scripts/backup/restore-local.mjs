#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { restoreDatabase } from "./restore.mjs";
import { restoreStorageLocal } from "./storage-restore.mjs";
try {
  const [configFile] = process.argv.slice(2);
  if (!configFile || process.argv.length !== 3) throw new Error();
  const c = JSON.parse(await readFile(configFile, "utf8"));
  if (c.phase && !["database", "storage"].includes(c.phase)) throw new Error();
  const options = {
    ...c,
    privateKey: await readFile(c.recipientPrivateKeyFile, "utf8"),
    passphrase: process.env.FOLIO_BACKUP_RESTORE_PASSPHRASE,
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
} catch {
  console.error(
    "restore_pending: database phase is transactional; Storage can be partially restored. Keep the journal and verified files; inspect local prerequisites and resume the same phase.",
  );
  process.exitCode = 1;
}
