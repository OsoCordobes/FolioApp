import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { proofConfiguration } from "../../scripts/testing/caller-proof/run.mjs";

test("joined selector is exclusive and retains the accepted mail selector", () => {
  const selected = proofConfiguration(["--public-booking-joined"]);
  assert.equal(selected.mode, "public-booking-joined");
  assert.equal(selected.project, "folio_public_booking_joined_proof");
  assert.equal(selected.clinical, "1");
  assert.equal(selected.fixtureName, "folio-public-booking-joined-fixture.json");
  assert.deepEqual(selected.specs, []);
  for (const args of [["--public-booking-joined", "--mail-internal"], ["--public-booking-joined", "--google-internal"],
    ["--public-booking-joined", "--public-booking-joined"], ["--public-booking-joined", "extra"], ["--public-booking-joined-extra"]]) {
    assert.throws(() => proofConfiguration(args));
  }
  assert.deepEqual(proofConfiguration(["--mail-internal"]), { mode: "mail-internal", project: "folio_mail_internal_proof",
    prefix: "mail_internal_proof", fixtureName: "folio-mail-internal-fixture.json", specs: [], clinical: "0", bucket: "mail-internal-synthetic" });
});

test("joined workflow selects a single proof and preserves only its finite receipt", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/folio-google-internal-proof.yml", import.meta.url), "utf8");
  assert.match(workflow, /- public-booking-joined/);
  assert.match(workflow, /public-booking-joined\) node --conditions=react-server --import tsx scripts\/testing\/caller-proof\/run\.mjs --public-booking-joined ;;/);
  assert.match(workflow, /if: inputs\.proof_mode == 'public-booking-joined'\s+run: pnpm exec playwright install --with-deps chromium/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/folio-public-booking-joined-proof\.json/);
  assert.doesNotMatch(workflow, /secrets\.|\.env\.local|browserCookies|continue-on-error:\s*true/);
});
