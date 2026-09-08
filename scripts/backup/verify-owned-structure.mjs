// Selected schema-only rehearsal from an authenticated owner checkpoint.
// No data, role, extension, provider or configuration restore is performed.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { verifyBackup } from "./restore.mjs";
import { openArtifact } from "./envelope.mjs";
import {
  parseConnection,
  pgConnection,
  assertEmptyRestoreTarget,
  closePgClient,
  monitorPostgresChild,
} from "./postgres.mjs";

let phase = "confirm_local_target";
let client;
let archive;
let schema;
try {
  const [root, checkpoint, database, confirmation] = process.argv.slice(2);
  if (
    !path.isAbsolute(root ?? "") ||
    !/^backup_[a-zA-Z0-9_-]+$/.test(checkpoint ?? "") ||
    confirmation !== "--restore-owner-checkpoint-structure-only"
  )
    throw new Error();
  const connection = parseConnection(
    process.env.FOLIO_BACKUP_RESTORE_DATABASE_URL,
    { restore: true, confirmDatabase: database },
  );
  delete process.env.FOLIO_BACKUP_RESTORE_DATABASE_URL;
  const passphrase = process.env.FOLIO_RECOVERY_PASSPHRASE;
  delete process.env.FOLIO_RECOVERY_PASSPHRASE;
  const privateKey = await readFile(
    path.join(root, "recipient-private.encrypted.pem"),
    "utf8",
  );
  const directory = path.join(root, "database-checkpoints", checkpoint);
  phase = "authenticate_all_artifacts";
  const manifest = await verifyBackup(directory, privateKey, { passphrase });
  const artifact = manifest.artifacts.find(
    (item) => item.kind === "postgres-database",
  );
  if (!artifact || manifest.source.pgDumpMajor !== 17) throw new Error();
  archive = await openArtifact(
    path.join(directory, artifact.file),
    privateKey,
    { backupId: checkpoint, artifact: artifact.file },
    { passphrase },
  );
  phase = "extract_selected_schema_in_memory";
  const exe = path.join(
    process.env.LOCALAPPDATA,
    "FolioTools/postgresql-17.11/pgsql/bin/pg_restore.exe",
  );
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("PG")) delete env[name];
  const child = spawn(
    exe,
    [
      "--section=pre-data",
      "--schema=public",
      "--table=instrumento_respuesta",
      "--no-owner",
      "--no-privileges",
      "--file=-",
    ],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const completed = monitorPostgresChild(child, { timeoutMs: 30000 });
  child.stdin.on("error", () => undefined);
  child.stdin.end(archive);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of child.stdout) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) {
      child.kill();
      throw new Error();
    }
    chunks.push(chunk);
  }
  await completed;
  schema = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  let sql = schema.toString("utf8");
  if (
    !sql.includes("CREATE TABLE public.instrumento_respuesta") ||
    /^COPY |^INSERT INTO /m.test(sql)
  )
    throw new Error();
  // pg_restore 17 emits this session setting, unavailable on our PostgreSQL16.
  // psql-only guards have no meaning for a single protocol query without psql.
  const omittedPg17Setting = /^SET transaction_timeout = 0;$/m.test(sql);
  sql = sql
    .replace(/^SET transaction_timeout = 0;\r?\n/gm, "")
    .replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm, "");
  phase = "restore_selected_structure_to_empty_loopback";
  client = pgConnection(connection);
  await client.connect();
  await assertEmptyRestoreTarget(client);
  await client.query("BEGIN");
  await client.query(sql);
  const {
    rows: [check],
  } = await client.query(`SELECT
    (SELECT count(*)::int FROM public.instrumento_respuesta) AS data_rows,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='instrumento_respuesta') AS columns,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='instrumento_respuesta' AND column_name IN ('respuestas_cifrado','score_total','banda','paciente_id')) AS expected_columns`);
  if (
    check.data_rows !== 0 ||
    check.expected_columns !== 4 ||
    check.columns < 10
  )
    throw new Error();
  await client.query("COMMIT");
  const evidence = {
    checkpoint,
    authenticatedBeforeWrite: true,
    selectedStructureRestored: true,
    tableCount: 1,
    columnCount: check.columns,
    dataRowsRestored: 0,
    omittedPg17SessionSetting: omittedPg17Setting,
    fullStructureRestored: false,
    fullDatabaseRestored: false,
    authLoginVerified: false,
    platformConfigurationComplete: false,
    productionWrites: 0,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(
      root,
      "database-checkpoints",
      `${checkpoint}-structure-verification.json`,
    ),
    JSON.stringify(evidence, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} catch {
  console.error(
    JSON.stringify({
      status: "selected_structure_verification_incomplete",
      phase,
      productionWrites: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  archive?.fill(0);
  schema?.fill(0);
  if (client)
    await closePgClient(client, { rollback: true }).catch(() => undefined);
}
