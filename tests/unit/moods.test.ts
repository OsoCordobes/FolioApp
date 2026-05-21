import assert from "node:assert/strict";
import test from "node:test";

import {
  MOOD_IDS,
  MOOD_LABELS,
  MOOD_TAGLINES,
  applyAcentoBlend,
} from "../../components/public-card/moods";

test("MOOD_IDS lists 4 moods in canonical order", () => {
  assert.deepEqual([...MOOD_IDS], ["calido", "clinico", "editorial", "boutique"]);
});

test("every mood has a Spanish label and a tagline", () => {
  for (const id of MOOD_IDS) {
    assert.ok(MOOD_LABELS[id], `${id} has a label`);
    assert.ok(MOOD_TAGLINES[id], `${id} has a tagline`);
  }
});

test("applyAcentoBlend passes through for non-clinico moods", () => {
  assert.equal(applyAcentoBlend("calido", "#FF5500"), "#FF5500");
  assert.equal(applyAcentoBlend("editorial", "#FF5500"), "#FF5500");
  assert.equal(applyAcentoBlend("boutique", "#FF5500"), "#FF5500");
});

test("applyAcentoBlend blends 60/40 toward ink-blue (#2A4365) for clinico", () => {
  // USER #FF5500 = (255, 85, 0); INK = (42, 67, 101); 60/40 blend:
  //   R = round(255*0.6 + 42*0.4)  = round(169.8) = 170 = 0xAA
  //   G = round(85*0.6 + 67*0.4)   = round(77.8)  =  78 = 0x4E
  //   B = round(0*0.6 + 101*0.4)   = round(40.4)  =  40 = 0x28
  assert.equal(applyAcentoBlend("clinico", "#FF5500"), "#AA4E28");
});

test("applyAcentoBlend leaves malformed hex untouched", () => {
  assert.equal(applyAcentoBlend("clinico", "not-a-hex"), "not-a-hex");
  assert.equal(applyAcentoBlend("clinico", "#GGG000"), "#GGG000");
  assert.equal(applyAcentoBlend("clinico", "#123"), "#123");
});

test("applyAcentoBlend accepts hex with and without leading #", () => {
  // The helper internally strips the leading '#' so both forms blend.
  assert.equal(applyAcentoBlend("clinico", "FF5500"), "#AA4E28");
});

test("applyAcentoBlend rounds correctly at boundaries", () => {
  // Pure ink-blue stays exactly ink-blue under blend.
  assert.equal(applyAcentoBlend("clinico", "#2A4365"), "#2A4365");
  // Pure brass becomes a midpoint:
  //   R = 0x8A*.6 + 0x2A*.4 = 138*.6 + 42*.4 = 82.8 + 16.8 = 99.6 → 100 = 0x64
  //   G = 0x67*.6 + 0x43*.4 = 103*.6 + 67*.4 = 61.8 + 26.8 = 88.6 → 89 = 0x59
  //   B = 0x22*.6 + 0x65*.4 = 34*.6 + 101*.4 = 20.4 + 40.4 = 60.8 → 61 = 0x3D
  assert.equal(applyAcentoBlend("clinico", "#8A6722"), "#64593D");
});
