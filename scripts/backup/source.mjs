import {
  dbInventory,
  parseConnection,
  pgConnection,
  pgProcess,
  toolVersion,
  closePgClient,
  postgresDiagnosticFailure,
} from "./postgres.mjs";
import { requireStorageMatch } from "./storage.mjs";
import { readFileSync } from "node:fs";

/** Reviewed workaround: omit only zero rows, never the extension or its DDL. */
export async function verifyEmptyPgsodiumKey(client) {
  const {
    rows: [state],
  } = await client.query(`SELECT
    (SELECT count(*)::int FROM pgsodium.key) AS rows,
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgsodium'
      AND 'pgsodium.key'::regclass=ANY(extconfig)) AS extension_configuration_table,
    EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
      AND conrelid='pgsodium.key'::regclass AND confrelid=conrelid) AS self_foreign_key`);
  if (
    state?.rows !== 0 ||
    state.extension_configuration_table !== true ||
    state.self_foreign_key !== true
  ) {
    throw new Error("pgsodium_key_requires_managed_restore_review");
  }
  return {
    schema: "pgsodium",
    table: "key",
    rows: 0,
    reason: "empty_extension_self_foreign_key",
    checkedInExportedSnapshot: true,
  };
}

export function createPostgresSource({
  databaseUrl,
  tools = {},
  allowRemoteSource = false,
  confirmSourceHost,
  expectedServerMajor = 17,
  allowLocalPg16Rehearsal = false,
  omitVerifiedEmptyPgsodiumKey = false,
}, adapters = {}) {
  // Programmatic test seams only; the owner executable accepts no overrides.
  const connect = adapters.pgConnection ?? pgConnection;
  const versionOf = adapters.toolVersion ?? toolVersion;
  const inventory = adapters.dbInventory ?? dbInventory;
  const closeClient = adapters.closePgClient ?? closePgClient;
  const connection = parseConnection(databaseUrl, {
    allowRemoteSource,
    confirmSourceHost,
    certificateAuthority: tools.sslRootCertFile
      ? readFileSync(tools.sslRootCertFile, "utf8")
      : undefined,
  });
  return {
    compareStorage: requireStorageMatch,
    async begin() {
      const client = connect(connection);
      let closed = false;
      let transaction = false;
      let stage = "connect";
      let disconnected;
      let rejectDisconnect;
      const disconnect = new Promise((_, reject) => { rejectDisconnect = reject; });
      disconnect.catch(() => undefined);
      const onError = (error) => { disconnected = error; rejectDisconnect(error); };
      client.on("error", onError);
      const perform = (operation) => Promise.race([Promise.resolve().then(operation), disconnect]);
      const close = async () => {
        if (!closed) {
          closed = true;
          try { await closeClient(client, { rollback: transaction }); }
          catch (error) { throw await postgresDiagnosticFailure(error, { ...tools, stage: "snapshot_close" }); }
        }
      };
      try {
        await perform(() => client.connect());
        stage = "tool_version";
        const major = await perform(() => versionOf("pg_dump", tools));
        stage = "server_version";
        const {
          rows: [version],
        } = await perform(() => client.query("show server_version_num"));
        const serverMajor = Math.floor(
          Number(version.server_version_num) / 10000,
        );
        const local16 =
          allowLocalPg16Rehearsal &&
          ["127.0.0.1", "::1", "localhost"].includes(connection.host) &&
          serverMajor === 16 &&
          major === 16;
        if (
          (major < 17 && !local16) ||
          major < serverMajor ||
          serverMajor !== expectedServerMajor
        )
          throw new Error("postgres_backup_version_incompatible");
        stage = "snapshot_begin";
        await perform(() => client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
        transaction = true;
        stage = "snapshot_export";
        const {
          rows: [snapshot],
        } = await perform(() => client.query("select pg_export_snapshot() as id"));
        stage = "inventory";
        const metadata = {
          ...(await perform(() => inventory(client))),
          serverMajor,
          pgDumpMajor: major,
          localRehearsal: local16,
          omittedEmptyExtensionData: [],
        };
        if (omitVerifiedEmptyPgsodiumKey) {
          stage = "extension_review";
          metadata.omittedEmptyExtensionData = [await perform(() => verifyEmptyPgsodiumKey(client))];
        }
        const stream = (tool, args) => ({
          async *[Symbol.asyncIterator]() {
            const { child, completion } = pgProcess(
              tool,
              args,
              connection,
              tools,
            );
            child.stdin.end();
            try {
              let interrupted = false;
              try {
                for await (const chunk of child.stdout) yield chunk;
              } catch {
                interrupted = true;
              }
              await completion;
              if (interrupted) throw new Error("postgres_output_incomplete");
            } finally {
              if (child.exitCode === null) child.kill();
            }
          },
        });
        return {
          metadata,
          database: async () =>
            stream("pg_dump", [
              "--format=custom",
              "--compress=6",
              "--snapshot",
              snapshot.id,
              "--lock-wait-timeout=30000",
              ...(omitVerifiedEmptyPgsodiumKey
                ? ["--exclude-table-data=pgsodium.key"]
                : []),
            ]),
          roles: async () =>
            stream("pg_dumpall", ["--roles-only", "--no-role-passwords"]),
          async verifyUnchanged() {
            if (disconnected) throw await postgresDiagnosticFailure(disconnected, { ...tools, stage: "connection_idle" });
            const current = connect(connection);
            let verificationStage = "verify_connect";
            let currentError;
            const onCurrentError = (error) => { currentError = error; };
            current.on("error", onCurrentError);
            try {
              await current.connect();
              verificationStage = "verify_inventory";
              const latest = await inventory(current);
              if (currentError) throw currentError;
              if (disconnected) { verificationStage = "connection_idle"; throw disconnected; }
              verificationStage = "verify_configuration";
              requireStorageMatch(metadata.objects, latest.objects);
              if (
                JSON.stringify(metadata.buckets) !==
                  JSON.stringify(latest.buckets) ||
                JSON.stringify(metadata.roles) !==
                  JSON.stringify(latest.roles) ||
                JSON.stringify(metadata.memberships) !==
                  JSON.stringify(latest.memberships)
              )
                throw new Error("backup_source_configuration_changed");
            } catch (error) {
              throw await postgresDiagnosticFailure(error, { ...tools, stage: verificationStage });
            } finally { await closeClient(current).catch(() => undefined); }
          },
          close,
        };
      } catch (error) {
        const failure = await postgresDiagnosticFailure(error, { ...tools, stage });
        await close().catch(() => undefined);
        throw failure;
      }
    },
  };
}
