import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveProvisionalSlug,
  slugify,
  validateSlugFormat,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
} from "../../lib/onboarding/slug";

/**
 * Folio · BL-1 regression: el slug provisional derivado del email DEBE pasar
 * el constraint de DB `slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'` (mínimo 4
 * chars, empieza/termina en alfanumérico).
 *
 * Runs con el runner nativo de Node:
 *   node --test --import tsx tests/unit/slug-provisional.test.ts
 */

// Réplica exacta del CHECK constraint de organization.slug.
const DB_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/;

test("SLUG_MIN_LENGTH refleja el mínimo real del constraint (4)", () => {
  assert.equal(SLUG_MIN_LENGTH, 4);
  assert.equal(SLUG_MAX_LENGTH, 50);
});

test("local-parts cortos producen un slug válido contra el regex de DB", () => {
  for (const input of ["jo", "dr", "ab", "a", "x1"]) {
    const slug = deriveProvisionalSlug(input);
    assert.ok(
      DB_SLUG_REGEX.test(slug),
      `slug "${slug}" derivado de "${input}" no matchea el constraint de DB`,
    );
    assert.ok(slug.length >= SLUG_MIN_LENGTH, `slug "${slug}" más corto que el mínimo`);
  }
});

test("input vacío o solo-símbolos produce un slug válido (fallback consultorio)", () => {
  for (const input of ["", "   ", "@@@", "---", "!!"]) {
    const slug = deriveProvisionalSlug(input);
    assert.ok(
      DB_SLUG_REGEX.test(slug),
      `slug "${slug}" derivado de "${input}" no matchea el constraint de DB`,
    );
    assert.ok(slug.startsWith("consultorio-"), `slug "${slug}" no usó la base segura`);
  }
});

test("inputs con unicode/diacríticos se normalizan y quedan válidos", () => {
  for (const input of ["José", "Córdoba", "Ñandú", "Renée", "müller"]) {
    const slug = deriveProvisionalSlug(input);
    assert.ok(
      DB_SLUG_REGEX.test(slug),
      `slug "${slug}" derivado de "${input}" no matchea el constraint de DB`,
    );
    assert.ok(/^[a-z0-9-]+$/.test(slug), `slug "${slug}" contiene chars fuera de [a-z0-9-]`);
  }
});

test("inputs ya válidos se preservan tal cual (idempotencia razonable)", () => {
  assert.equal(deriveProvisionalSlug("lorenzo.martinez"), "lorenzo-martinez");
  assert.equal(deriveProvisionalSlug("consultorio"), "consultorio");
  assert.equal(deriveProvisionalSlug("doctora-ana"), "doctora-ana");
});

test("el resultado nunca supera SLUG_MAX_LENGTH", () => {
  const longBase = "a".repeat(120);
  const slug = deriveProvisionalSlug(longBase);
  assert.ok(slug.length <= SLUG_MAX_LENGTH, `slug de largo ${slug.length} excede el máximo`);
  assert.ok(DB_SLUG_REGEX.test(slug), `slug largo "${slug}" no matchea el constraint`);
});

test("slugify base sigue comportándose como antes para inputs cortos", () => {
  // slugify no aplica el mínimo: deja "jo" como "jo". Es deriveProvisionalSlug
  // quien garantiza el mínimo. Verificamos que no rompimos slugify.
  assert.equal(slugify("jo"), "jo");
  assert.equal(slugify("Café Ñandú"), "cafe-nandu");
});

test("validateSlugFormat ahora rechaza < 4 chars (alineado a DB)", () => {
  assert.match(validateSlugFormat("jo") ?? "", /4 caracteres/);
  assert.equal(validateSlugFormat("juan"), null);
});
