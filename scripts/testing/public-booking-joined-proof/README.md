# Public booking joined proof

Reusable `provePublicBookingJoined` module. Preparation only: no CLI, dispatch,
backend, browser, Next or production execution has been performed for this package.

## Adapter interface pending ownership transfer

The reviewed shared runner must provide:

- `isolation`: pre-sanitization hosted facts, fresh standalone project
  `folio_public_booking_joined_proof`, Linux and internal network. Add this project
  explicitly to `validateBridgeTarget` with a test of that actual helper before use.
- `actor`, `service`, `scope`: the existing Google fixture shape, verified AAL2
  staff actor, one independent organization/member/service/integration, one initial
  patient, no requests or turns. Fixture Google tokens are `c05-http-*` and calendar
  `c05-internal`. The reviewed dependency is R `f7e7f5fe5e308ca5ad9581a906c6d3cac0c482c2`.
- `browserCookies`: private in-memory seeded verified session cookies mapped to
  the exact loopback app hostname. Do not persist cookies, keys or actor tokens.
- `config`: validated clinical `testAppConfig`, dedicated loopback Next port,
  dedicated ephemeral database/API/legacy local JWTs.
- `withDatabase(fn)`: existing guarded PostgreSQL helper. The module reads private
  durable receipts and the database clock; it creates no schemas or migrations.
- `withNext(config, callback)`: start the existing `app-server.mjs` with isolation,
  safe environment and real Next dev; wait for readiness, call callback with
  `{kind:'next-dev',appUrl,externalIoDenied:true,turnstileSecretPresent:false}`;
  always terminate and await the owned child. No local browser/build/DB run.
- `receipt`: `{modulePassed:false,stages:{},failure:null}` plus parent SHA/tree;
  `persist()` saves a restricted receipt. Overall `passed` requires all five
  stages, `modulePassed`, `moduleCleanup` and the parent's successful backend/Next
  cleanup. `calendarHoy.hoyPatientLink` must be true: activating the Hoy row must
  navigate to `/pacientes/<conversion.paciente_id>` on the same app origin.
  Preserve failure evidence. Do not reuse the four-case Google receipt.

## Observations and limits

One miniweb submission, one manual Calendar acceptance, durable submission and
conversion, one correlated patient/turn/service/professional in Calendar and Hoy,
one Google job and one loopback event. No direct request/turn insertion, retry,
autoconfirm variant, mail dispatch, cron, charge or real Google call. Existing
Node/Chromium guards deny external network; reused Google transport stays unchanged.

The slot is today in `America/Argentina/Cordoba`, at least roughly two hours ahead;
late-day runs fail explicitly. Availability is valid only for that day. Captcha
uses the existing absent-secret development policy; this does not prove real
Turnstile or production captcha behavior. The single owner is verified by durable
IDs; its name is implicit in the current single-professional UI. Browser and DB
execution remains required before claiming that the joined flow passes.

Focal pure tests: `node --import ./scripts/testing/recovery-bootstrap.mjs --test
tests/recovery/public-booking-joined-proof.test.mjs`. No fixtures are started.
