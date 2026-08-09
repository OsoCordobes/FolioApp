import assert from "node:assert/strict";
import test from "node:test";

import {
  CAP_COBRADOS,
  fetchAllRowsPaginado,
  particionarPagosParaTabla,
  type QueryPaginable,
} from "../../lib/db/finanzas";

// Review /finanzas · H2/H7 (paginación) y H1/H4 (cap de la tabla).
//
// H2/H7 · escenario de falla: ninguna query de finanzas llevaba .range()/
// .limit() ni paginaba, y PostgREST corta en max_rows (supabase/config.toml
// = 1000, idem el proyecto hosteado) SIN avisar. Una clínica con >1000 pagos
// en el año veía totales, donut, desglose por profesional y barras mensuales
// calculados sobre un subconjunto — y el CSV, documentado "sin cap" y anunciado
// en la UI como "el período completo", bajaba 1000 filas.
//
// H1/H4 · escenario de falla: el KPI "Por cobrar" acumulaba sobre TODOS los
// pagos del período pero la tabla solo listaba los 20 más recientes, y el
// botón "Cobrar" (único caller de marcarPagoCobradoAction en el repo) se
// renderiza por fila visible. Con >20 pagos en el período una deuda vieja era
// invisible E INCOBRABLE mientras el KPI la seguía anunciando.

interface FilaFake { id: number }

/**
 * Query builder falso al estilo PostgREST: `count` es SIEMPRE el total real
 * (así lo devuelve el header Content-Range aunque la respuesta venga
 * clampeada), y `serverMax` simula el recorte por max_rows del servidor.
 */
function queryFake(total: number, serverMax = 1000) {
  const pedidos: Array<[number, number]> = [];
  const make = (): QueryPaginable<FilaFake> => ({
    range(from: number, to: number) {
      pedidos.push([from, to]);
      const pedidas = to - from + 1;
      const n = Math.max(0, Math.min(pedidas, serverMax, total - from));
      return Promise.resolve({
        data: Array.from({ length: n }, (_, i) => ({ id: from + i })),
        error: null,
        count: total,
      });
    },
  });
  return { make, pedidos };
}

// ─── fetchAllRowsPaginado ──────────────────────────────────────────────────

test("una sola página: devuelve todo y no marca truncado", async () => {
  const q = queryFake(37);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 100 });
  assert.equal(r.error, null);
  assert.equal(r.rows.length, 37);
  assert.equal(r.truncado, false);
  assert.equal(q.pedidos.length, 1);
});

test("H2 · más de max_rows: pagina hasta agotar el count (antes se perdían las filas 1001+)", async () => {
  const q = queryFake(2_500, 1_000);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 1_000 });
  assert.equal(r.truncado, false);
  assert.equal(r.rows.length, 2_500);
  // Sin solapes ni huecos: los ids van 0..2499 en orden.
  assert.deepEqual(r.rows.map((f) => f.id), Array.from({ length: 2_500 }, (_, i) => i));
  assert.deepEqual(q.pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("H2 · el corte se guía por el count, no por 'me vino una página corta'", async () => {
  // Server con max_rows 500 aunque pidamos 1000: el heurístico de página corta
  // habría cortado en la fila 500 y reportado éxito con datos incompletos.
  const q = queryFake(1_200, 500);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 1_000 });
  assert.equal(r.truncado, false);
  assert.equal(r.rows.length, 1_200);
  assert.equal(q.pedidos[1][0], 500, "la segunda página arranca donde quedó la primera");
});

test("H2 · tope de seguridad: devuelve truncado=true (nunca truncar en silencio)", async () => {
  const q = queryFake(5_000, 1_000);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 1_000, maxPaginas: 2 });
  assert.equal(r.rows.length, 2_000);
  assert.equal(r.truncado, true, "el caller tiene que poder avisarle al usuario");
});

test("tope de seguridad justo: consumir el count exacto NO marca truncado", async () => {
  const q = queryFake(2_000, 1_000);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 1_000, maxPaginas: 2 });
  assert.equal(r.rows.length, 2_000);
  assert.equal(r.truncado, false);
});

test("período vacío: cero filas, una sola request, sin truncado", async () => {
  const q = queryFake(0);
  const r = await fetchAllRowsPaginado<FilaFake>(q.make, { pageSize: 1_000 });
  assert.equal(r.rows.length, 0);
  assert.equal(r.truncado, false);
  assert.equal(q.pedidos.length, 1);
});

test("error de la primera página: se propaga y no se inventa truncado", async () => {
  const make = (): QueryPaginable<FilaFake> => ({
    range: () => Promise.resolve({ data: null, error: { message: "boom" }, count: null }),
  });
  const r = await fetchAllRowsPaginado<FilaFake>(make);
  assert.equal(r.error?.message, "boom");
  assert.equal(r.rows.length, 0);
  assert.equal(r.truncado, false);
});

test("sin count utilizable: cae al heurístico de página corta y no cicla infinito", async () => {
  let servidas = 0;
  const make = (): QueryPaginable<FilaFake> => ({
    range(from: number, to: number) {
      const pedidas = to - from + 1;
      const n = Math.max(0, Math.min(pedidas, 150 - from));
      servidas += n;
      return Promise.resolve({
        data: Array.from({ length: n }, (_, i) => ({ id: from + i })),
        error: null,
        count: null,
      });
    },
  });
  const r = await fetchAllRowsPaginado<FilaFake>(make, { pageSize: 100 });
  assert.equal(r.rows.length, 150);
  assert.equal(servidas, 150);
  assert.equal(r.truncado, false);
});

// ─── particionarPagosParaTabla (H1+H4) ─────────────────────────────────────

const cobrado = (id: string) => ({ id, estado: "PAGADO" });
const debe = (id: string) => ({ id, estado: "PENDIENTE" });

test("H1+H4 · una deuda vieja detrás de 100 cobros sigue siendo visible y cobrable", () => {
  // Listado created_at DESC: 100 cobros recientes y, al final, la deuda vieja.
  // Con el cap de 20 sobre el listado crudo, esa fila nunca se renderizaba y
  // por lo tanto no existía botón "Cobrar" para ella en ninguna pantalla.
  const pagos = [...Array.from({ length: 100 }, (_, i) => cobrado(`c${i}`)), debe("deuda-vieja")];
  const { visibles } = particionarPagosParaTabla(pagos);
  assert.ok(visibles.some((p) => p.id === "deuda-vieja"));
});

test("H1+H4 · TODOS los pendientes se listan: el KPI 'Por cobrar' cuenta exactamente esas filas", () => {
  const pendientes = Array.from({ length: 57 }, (_, i) => debe(`p${i}`));
  const cobrados = Array.from({ length: 300 }, (_, i) => cobrado(`c${i}`));
  // Intercalados, como vienen de la DB ordenados por created_at.
  const pagos = cobrados.flatMap((c, i) => (i < pendientes.length ? [c, pendientes[i]] : [c]));

  const { visibles, cobradosNoListados } = particionarPagosParaTabla(pagos);
  const visiblesPendientes = visibles.filter((p) => p.estado !== "PAGADO");
  assert.equal(visiblesPendientes.length, 57, "porCobrarCount y las filas pendientes deben coincidir");
  assert.equal(cobradosNoListados, 300 - CAP_COBRADOS);
});

test("los cobros sí conservan cap, y se informa cuántos quedaron fuera (están en el CSV)", () => {
  const pagos = [...Array.from({ length: 100 }, (_, i) => cobrado(`c${i}`)), debe("d1"), debe("d2")];
  const { visibles, cobradosNoListados } = particionarPagosParaTabla(pagos);
  assert.equal(visibles.filter((p) => p.estado === "PAGADO").length, CAP_COBRADOS);
  assert.equal(cobradosNoListados, 100 - CAP_COBRADOS);
  assert.equal(visibles.length, CAP_COBRADOS + 2);
});

test("sin cobros fuera del cap, cobradosNoListados es 0 (el pie no miente)", () => {
  const pagos = [cobrado("c1"), debe("d1"), cobrado("c2")];
  const { visibles, cobradosNoListados } = particionarPagosParaTabla(pagos);
  assert.equal(cobradosNoListados, 0);
  assert.equal(visibles.length, 3);
});

test("se preserva el orden de entrada dentro de cada grupo (created_at DESC)", () => {
  const pagos = [cobrado("c1"), debe("d1"), cobrado("c2"), debe("d2")];
  const { visibles } = particionarPagosParaTabla(pagos, 5);
  assert.deepEqual(visibles.map((p) => p.id), ["c1", "d1", "c2", "d2"]);
});
