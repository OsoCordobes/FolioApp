import assert from "node:assert/strict";
import test from "node:test";

import { isoToLocalDatetime, localDatetimeToIso } from "../../lib/datetime-local";

// ─── Helpers de <input type="datetime-local"> (lib/datetime-local.ts) ─────
//
// Los tests trabajan SIEMPRE partiendo de strings locales ("YYYY-MM-DDTHH:mm")
// para ser independientes de la timezone del runner: localDatetimeToIso parsea
// como hora local e isoToLocalDatetime formatea de vuelta en hora local, así
// el roundtrip es estable en cualquier TZ.

test("localDatetimeToIso: representa el mismo instante que el string local", () => {
  const local = "2026-06-14T10:30";
  const iso = localDatetimeToIso(local);
  assert.equal(new Date(iso).getTime(), new Date(local).getTime());
  // ISO 8601 con offset Z — válido para z.string().datetime({ offset: true }).
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("isoToLocalDatetime: formato YYYY-MM-DDTHH:mm", () => {
  const iso = localDatetimeToIso("2026-06-14T10:30");
  assert.match(isoToLocalDatetime(iso), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("roundtrip: local → ISO → local = original + 5min (default redondeado del picker)", () => {
  // isoToLocalDatetime suma 5 min y redondea a múltiplo de 5 (default "próximo
  // slot" del picker). Con un input alineado a 5', el roundtrip es exactamente
  // el instante original corrido 5 minutos.
  const iso = localDatetimeToIso("2026-06-14T10:30");
  assert.equal(isoToLocalDatetime(iso), "2026-06-14T10:35");
});

test("isoToLocalDatetime: redondeo al múltiplo de 5 más cercano", () => {
  // 10:07 + 5min = 10:12 → round(12/5)=2 → 10:10
  assert.equal(isoToLocalDatetime(localDatetimeToIso("2026-06-14T10:07")), "2026-06-14T10:10");
  // 10:08 + 5min = 10:13 → round(13/5)=3 → 10:15
  assert.equal(isoToLocalDatetime(localDatetimeToIso("2026-06-14T10:08")), "2026-06-14T10:15");
});

test("isoToLocalDatetime: overflow de minuto 60 normaliza a la hora siguiente (bug fix)", () => {
  // 10:53 + 5min = 10:58 → round(58/5)*5 = 60 — el inline original producía
  // "T10:60" (value inválido que el input rechazaba); ahora normaliza a 11:00.
  assert.equal(isoToLocalDatetime(localDatetimeToIso("2026-06-14T10:53")), "2026-06-14T11:00");
});

test("isoToLocalDatetime: overflow cruza medianoche con cambio de fecha", () => {
  assert.equal(isoToLocalDatetime(localDatetimeToIso("2026-06-14T23:54")), "2026-06-15T00:00");
});
