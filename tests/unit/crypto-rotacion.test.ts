/**
 * Folio · rotación de las claves de cifrado y de blind index.
 *
 * Estos tests generan sus propias claves y no dependen de `.env.local`: son
 * los únicos del repo que necesitan CAMBIAR las claves en caliente, y una
 * clave que viene del entorno no se puede rotar dentro de un test.
 *
 * Lo que se protege:
 *   1. sin `_NEXT` seteada, el comportamiento es idéntico al de siempre;
 *   2. con `_NEXT`, se escribe con la nueva y se lee con las dos;
 *   3. una clave equivocada FALLA en vez de devolver texto corrupto — es la
 *      propiedad de la que depende toda la rotación, porque el ciphertext no
 *      lleva identificador de clave;
 *   4. los blind index, que son de una sola vía, ofrecen los dos hashes
 *      mientras dure la rotación.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const KEY_VIEJA = randomBytes(32).toString("base64");
const KEY_NUEVA = randomBytes(32).toString("base64");
const HMAC_VIEJA = randomBytes(32).toString("base64");
const HMAC_NUEVA = randomBytes(32).toString("base64");

// Antes de importar el módulo: sus getters son lazy pero cachean.
process.env.FOLIO_ENC_KEY = KEY_VIEJA;
process.env.FOLIO_ENC_HMAC_KEY = HMAC_VIEJA;
delete process.env.FOLIO_ENC_KEY_NEXT;
delete process.env.FOLIO_ENC_HMAC_KEY_NEXT;

import {
  encryptColumn,
  decryptColumn,
  tryDecrypt,
  blindIndex,
  blindIndexPhone,
  blindIndexCandidatos,
  blindIndexPhoneCandidatos,
  rotacionEnCurso,
  __cryptoTelemetryTestHooks,
} from "../../lib/crypto";

/** Aplica un estado de claves y limpia la caché del módulo. */
function conClaves(opts: { encNext?: string | null; hmacNext?: string | null }) {
  if (opts.encNext === null) delete process.env.FOLIO_ENC_KEY_NEXT;
  else if (opts.encNext) process.env.FOLIO_ENC_KEY_NEXT = opts.encNext;
  if (opts.hmacNext === null) delete process.env.FOLIO_ENC_HMAC_KEY_NEXT;
  else if (opts.hmacNext) process.env.FOLIO_ENC_HMAC_KEY_NEXT = opts.hmacNext;
  __cryptoTelemetryTestHooks.resetKeyCache();
}

const sinRotacion = () => conClaves({ encNext: null, hmacNext: null });

// ─── 1. Sin rotación, nada cambia ───────────────────────────────────────────

test("sin _NEXT el ida y vuelta es el de siempre", () => {
  sinRotacion();
  const ct = encryptColumn("Lorenzo Martínez")!;
  assert.equal(decryptColumn(ct), "Lorenzo Martínez");
  assert.deepEqual(rotacionEnCurso(), { enc: false, hmac: false });
});

test("sin _NEXT hay un solo candidato de blind index", () => {
  sinRotacion();
  const cands = blindIndexCandidatos("Lorenzo Martínez", "org-1");
  assert.equal(cands.length, 1);
  assert.equal(cands[0], blindIndex("Lorenzo Martínez", "org-1"));
});

// ─── 2. Con rotación: escribe con la nueva, lee con las dos ─────────────────

test("lo cifrado ANTES de rotar se sigue leyendo después", () => {
  // Es la propiedad que permite rotar sin cortar el servicio: la app arranca
  // con la key nueva mientras la base todavía está llena de filas viejas.
  sinRotacion();
  const viejo = encryptColumn("dato de antes")!;

  conClaves({ encNext: KEY_NUEVA });
  assert.equal(decryptColumn(viejo), "dato de antes");
});

test("lo que se cifra DURANTE la rotación usa la key nueva", () => {
  conClaves({ encNext: KEY_NUEVA });
  const nuevo = encryptColumn("dato de ahora")!;

  // Se lee con la nueva sola: o sea que nació con la nueva, no con la vieja.
  process.env.FOLIO_ENC_KEY = KEY_NUEVA;
  conClaves({ encNext: null });
  assert.equal(decryptColumn(nuevo), "dato de ahora");

  process.env.FOLIO_ENC_KEY = KEY_VIEJA;
  sinRotacion();
});

test("terminada la rotación, lo viejo YA NO se lee — y eso es lo que se busca", () => {
  // Cuando la key vieja se borra, cualquier fila que la rotación no alcanzó
  // queda ilegible. Por eso el job tiene que verificar cobertura completa
  // ANTES de que alguien borre la key vieja.
  sinRotacion();
  const viejo = encryptColumn("fila que el job no alcanzó")!;

  process.env.FOLIO_ENC_KEY = KEY_NUEVA;
  conClaves({ encNext: null });
  assert.throws(() => decryptColumn(viejo));

  process.env.FOLIO_ENC_KEY = KEY_VIEJA;
  sinRotacion();
});

// ─── 3. La propiedad de la que depende todo ────────────────────────────────

test("una key equivocada FALLA, no devuelve texto corrupto", () => {
  // El ciphertext no lleva identificador de key: probar-y-ver-si-abre sólo es
  // seguro porque el auth tag de GCM (128 bits) rechaza la key incorrecta.
  // Si esto dejara de ser cierto, la rotación podría escribir basura
  // descifrada como si fuera el plaintext original.
  sinRotacion();
  const ct = encryptColumn("historia clínica")!;

  process.env.FOLIO_ENC_KEY = randomBytes(32).toString("base64");
  __cryptoTelemetryTestHooks.resetKeyCache();
  assert.throws(() => decryptColumn(ct), /unable to authenticate|auth|bad decrypt/i);

  process.env.FOLIO_ENC_KEY = KEY_VIEJA;
  sinRotacion();
});

test("tryDecrypt devuelve null cuando ninguna de las dos keys abre", () => {
  sinRotacion();
  __cryptoTelemetryTestHooks.reset();
  const ajeno = (() => {
    process.env.FOLIO_ENC_KEY = randomBytes(32).toString("base64");
    __cryptoTelemetryTestHooks.resetKeyCache();
    const c = encryptColumn("de otra instancia")!;
    process.env.FOLIO_ENC_KEY = KEY_VIEJA;
    __cryptoTelemetryTestHooks.resetKeyCache();
    return c;
  })();

  conClaves({ encNext: KEY_NUEVA });
  assert.equal(tryDecrypt(ajeno, "test.campo"), null);
  sinRotacion();
});

// ─── 4. Blind indexes: los dos hashes mientras dure la rotación ─────────────

test("durante la rotación hay DOS candidatos, el nuevo primero", () => {
  sinRotacion();
  const hashViejo = blindIndex("Lorenzo Martínez", "org-1")!;

  conClaves({ hmacNext: HMAC_NUEVA });
  const cands = blindIndexCandidatos("Lorenzo Martínez", "org-1");
  assert.equal(cands.length, 2);
  assert.equal(cands[0], blindIndex("Lorenzo Martínez", "org-1"), "el primero es el de escritura");
  assert.equal(cands[1], hashViejo, "el segundo es el de la key vieja");
  assert.notEqual(cands[0], cands[1]);
  sinRotacion();
});

test("los teléfonos también ofrecen las dos variantes", () => {
  sinRotacion();
  const viejo = blindIndexPhone("+54 9 351 555 1234", "org-1")!;

  conClaves({ hmacNext: HMAC_NUEVA });
  const cands = blindIndexPhoneCandidatos("(351) 555-1234", "org-1");
  assert.equal(cands.length, 2);
  assert.ok(cands.includes(viejo), "el hash viejo tiene que seguir estando");
  sinRotacion();
});

test("un valor no hasheable no produce candidatos", () => {
  // `.in()` con un array vacío no matchea nada, que es lo correcto: mejor
  // cero resultados que traer toda la tabla.
  conClaves({ hmacNext: HMAC_NUEVA });
  assert.deepEqual(blindIndexCandidatos(null), []);
  assert.deepEqual(blindIndexCandidatos("   "), []);
  assert.deepEqual(blindIndexPhoneCandidatos("123"), [], "menos de 8 dígitos no es teléfono");
  sinRotacion();
});

test("si las dos keys fueran iguales no se duplica el candidato", () => {
  conClaves({ hmacNext: HMAC_VIEJA });
  assert.equal(blindIndexCandidatos("Lorenzo", "org-1").length, 1);
  sinRotacion();
});

// ─── 5. Configuración inválida ─────────────────────────────────────────────

test("una _NEXT mal formada rompe fuerte, no se ignora en silencio", () => {
  // Ignorar una key inválida sería peor: la app seguiría escribiendo con la
  // vieja mientras el operador cree que ya está rotando.
  process.env.FOLIO_ENC_KEY_NEXT = "esto-no-es-base64-de-32-bytes";
  __cryptoTelemetryTestHooks.resetKeyCache();
  assert.throws(() => encryptColumn("x"), /FOLIO_ENC_KEY_NEXT.*32 bytes/);
  sinRotacion();
});

test("una _NEXT vacía se trata como ausente", () => {
  // `vercel env pull` materializa las variables borradas como "": eso tiene
  // que significar "no hay rotación", no "rotación con key vacía".
  process.env.FOLIO_ENC_KEY_NEXT = "";
  __cryptoTelemetryTestHooks.resetKeyCache();
  assert.equal(rotacionEnCurso().enc, false);
  const ct = encryptColumn("x")!;
  assert.equal(decryptColumn(ct), "x");
  sinRotacion();
});
