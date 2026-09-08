import pg from "pg";
import { spawn } from "node:child_process";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
export function parseConnection(
  value,
  {
    restore = false,
    confirmDatabase,
    allowRemoteSource = false,
    confirmSourceHost,
    certificateAuthority,
  } = {},
) {
  const u = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    u.search ||
    u.hash ||
    !u.username ||
    !u.pathname.slice(1)
  )
    throw new Error("database_url_invalid");
  if (restore) {
    if (
      !LOOPBACK.has(u.hostname) ||
      !/^folio_restore_[a-z0-9_]+$/.test(u.pathname.slice(1)) ||
      confirmDatabase !== u.pathname.slice(1)
    )
      throw new Error("restore_target_not_confirmed_local_new_database");
  } else if (
    !LOOPBACK.has(u.hostname) &&
    (!allowRemoteSource || u.hostname !== confirmSourceHost)
  )
    throw new Error("remote_backup_source_not_confirmed");
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.slice(1)),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: LOOPBACK.has(u.hostname)
      ? false
      : {
          rejectUnauthorized: true,
          ...(certificateAuthority ? { ca: certificateAuthority } : {}),
        },
  };
}
export function pgConnection(config) {
  return new pg.Client({
    ...config,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
    application_name: "folio-backup",
  });
}
export function postgresFailureCategory(stderr) {
  if (/permission denied/i.test(stderr)) return "permission_denied";
  if (/certificate|SSL error/i.test(stderr)) return "tls_certificate";
  if (/password authentication failed/i.test(stderr))
    return "authentication_failed";
  if (/snapshot/i.test(stderr)) return "snapshot_unavailable";
  if (/timeout|timed out/i.test(stderr)) return "timeout";
  if (/could not translate host|Name or service not known/i.test(stderr))
    return "dns_failed";
  if (/connection|server closed/i.test(stderr)) return "connection_failed";
  if (
    /circular foreign.key constraints|dependencias.*circular|restricciones.*circular/i.test(
      stderr,
    )
  )
    return "circular_foreign_keys";
  if (/collation version mismatch/i.test(stderr))
    return "collation_version_mismatch";
  if (/no privileges|no se.*privilegios/i.test(stderr))
    return "privilege_warning";
  return "tool_failure_or_warning";
}

export async function boundedOperation(
  operation,
  timeoutMs,
  onTimeout = () => {},
) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout();
          } catch {
            /* Timeout cleanup cannot leak an adapter error. */
          }
          const error = new Error("postgres_operation_timeout");
          error.category = "timeout";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closePgClient(
  client,
  { rollback = false, timeoutMs = 5000 } = {},
) {
  await boundedOperation(
    async () => {
      if (rollback) await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    },
    timeoutMs,
    () => client.connection?.stream?.destroy(),
  );
}

/** The callback must encrypt diagnostics; raw stderr never enters Error objects. */
export function monitorPostgresChild(
  child,
  { timeoutMs = 600000, diagnosticSink } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000)
    throw new Error("postgres_timeout_invalid");
  const chunks = [];
  let bytes = 0;
  let captured = 0;
  let settled = false;
  let timer;
  const completion = new Promise((resolve, reject) => {
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      const remaining = 65536 - captured;
      if (remaining > 0) {
        const value = Buffer.from(chunk.subarray(0, remaining));
        chunks.push(value);
        captured += value.length;
      }
    });
    const finish = async (code, forcedCategory) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const diagnostic = Buffer.concat(chunks);
      const category =
        forcedCategory ?? postgresFailureCategory(diagnostic.toString("utf8"));
      try {
        if (diagnosticSink && (bytes > 0 || forcedCategory || code !== 0)) {
          await boundedOperation(
            () =>
              diagnosticSink(diagnostic, {
                category,
                exitCode: Number.isInteger(code) ? code : null,
                stderrBytes: bytes,
                truncated: bytes > captured,
              }),
            5000,
          );
        }
        if (code === 0 && bytes === 0 && !forcedCategory) resolve();
        else {
          const failure = new Error("postgres_tool_failed_or_warned");
          failure.category = category;
          failure.exitCode = Number.isInteger(code) ? code : null;
          reject(failure);
        }
      } catch {
        const failure = new Error("postgres_diagnostic_capture_failed");
        failure.category = "diagnostic_capture_failed";
        reject(failure);
      } finally {
        diagnostic.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    };
    child.once("error", () => void finish(null, "tool_unavailable"));
    child.once("close", (code) => void finish(code));
    timer = setTimeout(() => {
      void finish(null, "timeout");
      child.kill();
      child.stdout.destroy();
      child.stdin.destroy();
      const force = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1000);
      force.unref();
    }, timeoutMs);
  });
  completion.catch(() => undefined);
  return completion;
}

export function pgProcess(
  tool,
  args,
  connection,
  { wsl, binDirectory, sslRootCertFile, timeoutMs, diagnosticSink } = {},
) {
  const base = [
    "--host",
    connection.host,
    "--port",
    String(connection.port),
    "--username",
    connection.user,
    "--no-password",
  ];
  if (tool !== "pg_dumpall") base.push("--dbname", connection.database);
  else base.push("--database", connection.database);
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("PG") || name === "WSLENV") delete env[name];
  env.PGPASSWORD = connection.password;
  env.PGSSLMODE = connection.ssl ? "verify-full" : "disable";
  if (connection.ssl && sslRootCertFile) env.PGSSLROOTCERT = sslRootCertFile;
  env.PGCONNECT_TIMEOUT = "10";
  env.LC_ALL = "C";
  env.LANG = "C";
  if (wsl)
    env.WSLENV = "PGPASSWORD:PGSSLMODE:PGCONNECT_TIMEOUT:PGSSLROOTCERT/p";
  const executable = binDirectory
    ? `${binDirectory}/${tool}${process.platform === "win32" && !wsl ? ".exe" : ""}`
    : tool;
  const child = spawn(
    wsl ? "wsl.exe" : executable,
    wsl
      ? ["--distribution", wsl, "--exec", executable, ...base, ...args]
      : [...base, ...args],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const completion = monitorPostgresChild(child, { timeoutMs, diagnosticSink });
  return { child, completion };
}
export async function toolVersion(tool, { wsl, binDirectory } = {}) {
  const executable = binDirectory
    ? `${binDirectory}/${tool}${process.platform === "win32" && !wsl ? ".exe" : ""}`
    : tool;
  const child = spawn(
    wsl ? "wsl.exe" : executable,
    wsl
      ? ["--distribution", wsl, "--exec", executable, "--version"]
      : ["--version"],
    { windowsHide: true },
  );
  let out = "";
  child.stdout.on("data", (x) => (out += x));
  await monitorPostgresChild(child, { timeoutMs: 10000 });
  const major = Number(out.match(/PostgreSQL\) (\d+)/)?.[1]);
  if (!major) throw new Error("postgres_tool_version_invalid");
  return major;
}
export async function dbInventory(client) {
  const { rows: schemas } = await client.query(
    "select nspname as name from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema' order by nspname",
  );
  const { rows: extensions } = await client.query(
    "select extname as name,extversion as version from pg_extension order by extname",
  );
  const { rows: roles } = await client.query(
    "select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig from pg_roles order by rolname",
  );
  const { rows: memberships } = await client.query(
    "select r.rolname as role,m.rolname as member,a.admin_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member order by 1,2",
  );
  const { rows: databaseConfig } = await client.query(
    "select datname,pg_get_userbyid(datdba) as owner,datacl from pg_database where datname=current_database()",
  );
  const { rows: settings } = await client.query(
    "select s.setconfig,r.rolname from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole where s.setdatabase=(select oid from pg_database where datname=current_database()) or s.setdatabase=0",
  );
  const hasStorage = schemas.some((s) => s.name === "storage");
  const buckets = hasStorage
    ? (await client.query("select * from storage.buckets order by id")).rows
    : [];
  const objects = hasStorage
    ? (
        await client.query(
          'select bucket_id as bucket,name,id,updated_at as "updatedAt",metadata from storage.objects order by bucket_id,name',
        )
      ).rows.map((x) => ({
        bucket: x.bucket,
        name: x.name,
        id: x.id,
        updatedAt: new Date(x.updatedAt).toISOString(),
        size: Number(x.metadata?.size),
        etag: x.metadata?.eTag ?? x.metadata?.etag ?? null,
        metadata: x.metadata,
      }))
    : [];
  return {
    schemas,
    extensions,
    roles,
    memberships,
    databaseConfig,
    settings,
    buckets,
    objects,
  };
}
export async function assertEmptyRestoreTarget(client) {
  const {
    rows: [state],
  } =
    await client.query(`select host(inet_server_addr()) as address,current_database() as database,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and n.nspname !~ '^pg_temp')+
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema'))+
 (select count(*) from pg_namespace where nspname not in ('public','pg_catalog','information_schema') and nspname !~ '^pg_toast' and nspname !~ '^pg_temp') as objects`);
  if (
    !["127.0.0.1", "::1"].includes(state.address) ||
    Number(state.objects) !== 0
  )
    throw new Error("restore_target_not_empty_loopback");
  return state;
}
