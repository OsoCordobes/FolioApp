import assert from "node:assert/strict";
import test from "node:test";
import { formatCents, centsToDecimal, parseAmountCents, roundedRatio } from "../../lib/format/financial-money";

test("financial amounts retain cents and integers beyond Number precision", () => {
  assert.equal(formatCents("900719925474099301"), "$ 9.007.199.254.740.993,01");
  assert.equal(centsToDecimal("29"), "0.29");
  assert.equal(formatCents("-29"), "$ -0,29");
  assert.equal(roundedRatio("101", 1, 2), "51");
  assert.equal(roundedRatio("900719925474099301", 1, 1), "900719925474099301");
});
test("explicit ARS amount filter never uses floating point or partial matches", () => {
  assert.equal(parseAmountCents("$ 1.234,56"), "123456");
  assert.equal(parseAmountCents("0,29"), "29");
  for (const input of ["1,234", "1.23", "1e3", "-1", "Pedro", "1.2.3"]) {
    assert.equal(parseAmountCents(input), null);
  }
});
