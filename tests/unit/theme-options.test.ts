import assert from "node:assert/strict";
import test from "node:test";

import { THEME_OPTIONS, isTheme } from "../../lib/ui/theme-options";

test("THEME_OPTIONS: expone claro y oscuro en orden canónico", () => {
  assert.deepEqual(
    THEME_OPTIONS.map((o) => o.value),
    ["light", "dark"],
  );
  assert.deepEqual(
    THEME_OPTIONS.map((o) => o.label),
    ["Claro", "Oscuro"],
  );
});

test("isTheme: acepta solo los temas ofrecidos por el control", () => {
  assert.equal(isTheme("light"), true);
  assert.equal(isTheme("dark"), true);
  // Fuera del set (incluye 'system', que el plumbing no soporta) → false.
  assert.equal(isTheme("system"), false);
  assert.equal(isTheme(""), false);
  assert.equal(isTheme(null), false);
  assert.equal(isTheme(undefined), false);
  assert.equal(isTheme(42), false);
});
