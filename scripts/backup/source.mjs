import {
  dbInventory,
  parseConnection,
  pgConnection,
  pgProcess,
  toolVersion,
  closePgClient,
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
}) {
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
      const client = pgConnection(connection);
      await client.connect();
      let closed = false;
      const close = async () => {
        if (!closed) {
          closed = true;
          await closePgClient(client, { rollback: true });
        }
      };
      try {
        const major = await toolVersion("pg_dump", tools);
        const {
          rows: [version],
        } = await client.query("show server_version_num");
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
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const {
          rows: [snapshot],
        } = await client.query("select pg_export_snapshot() as id");
        const metadata = {
          ...(await dbInventory(client)),
          serverMajor,
          pgDumpMajor: major,
          localRehearsal: local16,
          omittedEmptyExtensionData: omitVerifiedEmptyPgsodiumKey
            ? [await verifyEmptyPgsodiumKey(client)]
            : [],
        };
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
            const current = pgConnection(connection);
            await current.connect();
            try {
              const latest = await dbInventory(current);
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
            } finally {
              await closePgClient(current);
            }
          },
          close,
        };
      } catch {
        await close().catch(() => undefined);
        throw new Error("backup_database_snapshot_failed");
      }
    },
  };
}
