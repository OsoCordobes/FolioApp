#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveOutsideRepository } from "./paths.mjs";
import { createBackup, readBackupStatus } from "./core.mjs";
import { createPostgresSource } from "./source.mjs";
import { createStorageReader } from "./storage.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
try {
  const [command, configFile] = process.argv.slice(2);
  if (
    !["run", "status", "catch-up"].includes(command) ||
    !configFile ||
    process.argv.length !== 4
  )
    throw new Error();
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const destination = await resolveOutsideRepository(config.destination, root);
  if (command === "status") {
    console.log(JSON.stringify(await readBackupStatus(destination)));
  } else if (
    command === "catch-up" &&
    !(await readBackupStatus(destination)).catchUp
  ) {
    console.log(
      JSON.stringify({ skipped: true, reason: "recent_valid_backup" }),
    );
  } else {
    const publicKey = await readFile(config.recipientPublicKeyFile, "utf8");
    const platformConfig = JSON.parse(
      await readFile(config.platformConfigFile, "utf8"),
    );
    const source = createPostgresSource({
      ...config.source,
      databaseUrl: process.env.FOLIO_BACKUP_DATABASE_URL,
    });
    const storage = createStorageReader({
      url: config.storageUrl,
      serviceKey: process.env.FOLIO_BACKUP_STORAGE_SERVICE_KEY,
    });
    console.log(
      JSON.stringify(
        await createBackup({
          destination,
          publicKey,
          platformConfig,
          source,
          storage,
        }),
      ),
    );
  }
} catch {
  console.error(
    "backup_command_failed: check private configuration, source availability and incomplete artifact directory",
  );
  process.exitCode = 1;
}
