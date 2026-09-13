# Local SQL regression replay

Requires Node with this repository's dependencies, PostgreSQL **16**, and `psql`.
Create a **new empty database** named `folio_test_<unique-name>` on a loopback
address. Use a dedicated test instance: the bootstrap creates the Supabase role
names `anon`, `authenticated`, and `service_role` in that instance.

PowerShell example, after creating the database and choosing local credentials:

```powershell
$env:LOCAL_SQL_TEST_URL = 'postgres://postgres:LOCAL_TEST_PASSWORD@127.0.0.1:55439/folio_test_run1'
# Only if psql lives in a WSL distribution:
$env:LOCAL_SQL_TEST_WSL = 'Ubuntu'
node scripts/testing/replay-local-sql.mjs --security-red-green
```

On Linux/macOS, export `LOCAL_SQL_TEST_URL` and omit `LOCAL_SQL_TEST_WSL`.
Omit `--security-red-green` to apply the complete migration chain and run all SQL
specs directly. With that flag, the runner first proves that the M98 test fails
on the historical OWNER billing exemption, then proves the correction passes.

The runner rejects remote hosts, database names outside `folio_test_*`, URL
options, PostgreSQL versions other than 16, and nonempty databases. It never
loads `.env.local`, drops a database, or resets a cluster. A failed replay stays
available for inspection; create another empty database for the next replay.

Every migration starts in a fresh session with `check_function_bodies=on`.
Explicit settings inside individual migrations are respected. SQL executes via
`psql -X -v ON_ERROR_STOP=1`, preserving statement transaction boundaries; do
not replace it with one `pg.query()` per file, which changes transaction-local
settings and can invalidate the isolation checks.

`supabase-stubs.sql` is shared with GitHub CI. Its Auth and Storage schemas only
provide referenced SQL symbols. These tests verify SQL behavior and role-based
permissions; they do **not** replace real Supabase Auth JWT / Storage API E2E
tests.

## Automated app tests

`pnpm test:unit` launches a pre-import synthetic environment and rejects extra
Node preload/env-file flags. It clears inherited application/provider secrets,
blocks environment file reads, and permits only loopback HTTP/TCP/TLS. It also
propagates the preload to Node child processes. Tests can install explicit mocks
and create their own synthetic localhost fixtures.

`pnpm test:recovery` uses the same guard. The optional PostgreSQL rehearsal keeps
only its explicitly selected local URL after validating it. Manual backup,
owner capture and key recovery commands retain their separate operating scopes;
they are not launched by these wrappers.

`pnpm test:build` and the Playwright commands use their own `.next-test` output.
The browser wrapper creates a dedicated app server on port 4410, refuses reuse
of the ordinary developer server and rejects hosted Supabase URLs/keys. Browser
fixtures block external HTTP and WebSockets, including server-side providers
through the Node preload. See [the E2E guide](../../tests/e2e/README.md) for local
Supabase fixtures and the explicit limitations of this test boundary.

`pnpm test:isolation:browser` proves the browser network boundary with a small
localhost fixture and installed Chromium. `tests/unit/test-isolation.test.ts`
invokes actual filesystem, Next env loading, provider SDK, HTTP redirect, TCP,
TLS and wrapper entrypoints; it does not rely on source-string checks.

These safeguards prevent accidental remote I/O by the application under test.
They are not an OS sandbox against hostile test code or local forwarding
proxies. No hosted validation or production fixture writes are authorized here.

`node scripts/testing/agenda-revision-concurrency.mjs` checks M111 on an explicit
`LOCAL_SQL_TEST_URL` loopback `folio_test_*` database with M111 already applied.
It uses two writers and an observer to verify counter serialization, commit
visibility, rollback, and exact increments. It retains synthetic fixtures and
temporarily replaces the vanilla Auth stub inside a rolled-back transaction;
it does not exercise real Supabase Auth. The reported 100-write/read timings
describe the small local fixture, not production capacity.

M111's public marker is `counter:YYYY-MM-DD`, using the database clock in the
organization's timezone. Midnight changes the token without a write. Client,
route and server pre-read share the strict validator in
`lib/agenda/revision-token.ts`; an old counter-only response is unavailable,
never a successful acknowledgement. The private SQL `revision_at` helper has
no grants to API roles and exists for deterministic clock boundary tests.
The SQL spec checks Córdoba midnight and another timezone; the browser harness
checks a day change with the same counter in development and production React.
