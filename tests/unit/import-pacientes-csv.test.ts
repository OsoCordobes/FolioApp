/**
 * Folio · unit tests del importador CSV de pacientes (lib/import/pacientes-csv.ts).
 *
 * Todo puro — sin DB ni crypto: parser (comillas, ";", BOM, saltos embebidos),
 * propuesta de mapeo, fechas DD/MM/YYYY + YYYY-MM-DD, normalización de filas y
 * decisión de dedupe.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  claveDni,
  claveTelefono,
  decidirDedupe,
  detectarSeparador,
  normalizarFila,
  normalizarFilas,
  parseCsv,
  parseFechaNacimiento,
  proponerMapeo,
  type DedupeSets,
  type MapeoColumnas,
} from "../../lib/import/pacientes-csv";

// ─── Parser: separador ──────────────────────────────────────────────────────

test("detectarSeparador: coma por default, punto y coma cuando domina (Excel AR)", () => {
  assert.equal(detectarSeparador("nombre,apellido,tel\n"), ",");
  assert.equal(detectarSeparador("nombre;apellido;tel\n"), ";");
  assert.equal(detectarSeparador("sin separadores\n"), ",");
  // El ";" dentro de comillas no cuenta: gana la coma.
  assert.equal(detectarSeparador('"a;b;c",x,y\n'), ",");
});

test("parseCsv: separador punto y coma (export Excel es-AR)", () => {
  const csv = "Nombre;Apellido;Telefono\nCarlos;Vega;3515551234\nAna;Ruiz;3515559999\n";
  const r = parseCsv(csv);
  assert.equal(r.separador, ";");
  assert.deepEqual(r.headers, ["Nombre", "Apellido", "Telefono"]);
  assert.equal(r.filas.length, 2);
  assert.deepEqual(r.filas[0], ["Carlos", "Vega", "3515551234"]);
});

// ─── Parser: comillas, BOM, saltos embebidos ────────────────────────────────

test("parseCsv: comillas con separador adentro y escape de comilla doble", () => {
  const csv = 'nombre,notas\nCarlos,"dice ""hola"", saluda"\n';
  const r = parseCsv(csv);
  assert.deepEqual(r.filas[0], ["Carlos", 'dice "hola", saluda']);
});

test("parseCsv: BOM UTF-8 inicial no ensucia el primer encabezado", () => {
  const csv = "\uFEFFnombre,apellido\nCarlos,Vega\n";
  const r = parseCsv(csv);
  assert.deepEqual(r.headers, ["nombre", "apellido"]);
});

test("parseCsv: salto de línea embebido en campo entre comillas", () => {
  const csv = 'nombre,direccion\nCarlos,"Av. Colón 123\nPiso 2"\nAna,Simple\n';
  const r = parseCsv(csv);
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0][1], "Av. Colón 123\nPiso 2");
  assert.deepEqual(r.filas[1], ["Ana", "Simple"]);
});

test("parseCsv: CRLF y líneas vacías al final se toleran", () => {
  const csv = "nombre,apellido\r\nCarlos,Vega\r\n\r\n\r\n";
  const r = parseCsv(csv);
  assert.equal(r.filas.length, 1);
  assert.deepEqual(r.filas[0], ["Carlos", "Vega"]);
});

test("parseCsv: archivo sin filas de datos devuelve filas vacías", () => {
  const r = parseCsv("nombre,apellido\n");
  assert.deepEqual(r.headers, ["nombre", "apellido"]);
  assert.equal(r.filas.length, 0);
});

// ─── Propuesta de mapeo ─────────────────────────────────────────────────────

test("proponerMapeo: headers típicos de planilla AR (tildes, mayúsculas)", () => {
  const m = proponerMapeo(["Nombre", "Apellido", "DNI", "Teléfono", "E-mail", "Fecha de Nacimiento"]);
  assert.equal(m.nombre, 0);
  assert.equal(m.apellido, 1);
  assert.equal(m.dni, 2);
  assert.equal(m.telefono, 3);
  assert.equal(m.email, 4);
  assert.equal(m.fechaNacimiento, 5);
});

test("proponerMapeo: sinónimos (celular, correo, documento, f.nac)", () => {
  const m = proponerMapeo(["nombres", "apellidos", "documento", "celular", "correo", "f.nac"]);
  assert.equal(m.nombre, 0);
  assert.equal(m.apellido, 1);
  assert.equal(m.dni, 2);
  assert.equal(m.telefono, 3);
  assert.equal(m.email, 4);
  assert.equal(m.fechaNacimiento, 5);
});

test("proponerMapeo: columnas desconocidas quedan sin mapear", () => {
  const m = proponerMapeo(["columna rara", "otra cosa"]);
  assert.equal(Object.keys(m).length, 0);
});

test("proponerMapeo: una columna no se asigna a dos campos", () => {
  const m = proponerMapeo(["nombre y apellido"]);
  // "nombre y apellido" contiene ambos sinónimos — gana uno solo (nombre).
  const asignados = Object.values(m);
  assert.equal(new Set(asignados).size, asignados.length);
});

// ─── Fechas ─────────────────────────────────────────────────────────────────

test("parseFechaNacimiento: DD/MM/YYYY y variantes", () => {
  assert.equal(parseFechaNacimiento("21/03/1985"), "1985-03-21");
  assert.equal(parseFechaNacimiento("1/9/1990"), "1990-09-01");
  assert.equal(parseFechaNacimiento("21-03-1985"), "1985-03-21");
  assert.equal(parseFechaNacimiento("21.03.1985"), "1985-03-21");
});

test("parseFechaNacimiento: YYYY-MM-DD (ISO)", () => {
  assert.equal(parseFechaNacimiento("1985-03-21"), "1985-03-21");
  assert.equal(parseFechaNacimiento("1990-9-1"), "1990-09-01");
});

test("parseFechaNacimiento: inválidas → null", () => {
  assert.equal(parseFechaNacimiento("31/02/1985"), null, "31 de febrero no existe");
  assert.equal(parseFechaNacimiento("21/13/1985"), null, "mes 13");
  assert.equal(parseFechaNacimiento("21/03/1850"), null, "antes de 1900");
  assert.equal(parseFechaNacimiento("21/03/3000"), null, "futuro");
  assert.equal(parseFechaNacimiento("hola"), null);
  assert.equal(parseFechaNacimiento(""), null);
  assert.equal(parseFechaNacimiento("21/03/85"), null, "año de 2 dígitos es ambiguo");
});

test("parseFechaNacimiento: bisiestos", () => {
  assert.equal(parseFechaNacimiento("29/02/2000"), "2000-02-29");
  assert.equal(parseFechaNacimiento("29/02/1999"), null);
});

// ─── Claves de dedupe ───────────────────────────────────────────────────────

test("claveTelefono: misma normalización que blindIndexPhone (últimos 10 dígitos)", () => {
  assert.equal(claveTelefono("+54 9 351 555 1234"), "3515551234");
  assert.equal(claveTelefono("(351) 555-1234"), "3515551234");
  assert.equal(claveTelefono("3515551234"), "3515551234");
  assert.equal(claveTelefono("123"), null, "menos de 8 dígitos");
  assert.equal(claveTelefono(""), null);
});

test("claveDni: colapsa puntos/espacios de planilla y case", () => {
  assert.equal(claveDni("12.345.678"), "12345678");
  assert.equal(claveDni("12 345 678"), "12345678");
  assert.equal(claveDni("12345678"), "12345678");
  assert.equal(claveDni("AB-123456"), "ab-123456", "doc alfanumérico se conserva (lower)");
  assert.equal(claveDni(""), null);
  assert.equal(claveDni(null), null);
});

// ─── Normalización de filas ─────────────────────────────────────────────────

const MAPEO: MapeoColumnas = { nombre: 0, apellido: 1, dni: 2, telefono: 3, email: 4, fechaNacimiento: 5 };

test("normalizarFila: fila completa válida", () => {
  const r = normalizarFila(
    ["Carlos", "Vega", "12.345.678", "+54 351 555 1234", "carlos@mail.com", "21/03/1985"],
    MAPEO,
    2,
  );
  assert.ok(r.ok);
  assert.equal(r.data.nombre, "Carlos");
  assert.equal(r.data.dni, "12345678", "DNI normalizado sin puntos");
  assert.equal(r.data.fechaNacimiento, "1985-03-21");
});

test("normalizarFila: opcionales vacíos quedan null, no error", () => {
  const r = normalizarFila(["Ana", "Ruiz", "", "3515551234", "", ""], MAPEO, 3);
  assert.ok(r.ok);
  assert.equal(r.data.dni, null);
  assert.equal(r.data.email, null);
  assert.equal(r.data.fechaNacimiento, null);
});

test("normalizarFila: errores acumulados con motivo es-AR sin PII", () => {
  const r = normalizarFila(["", "Ruiz", "", "123", "no-es-mail", "99/99/9999"], MAPEO, 5);
  assert.ok(!r.ok);
  assert.equal(r.fila, 5);
  assert.match(r.motivo, /falta el nombre/);
  assert.match(r.motivo, /teléfono inválido/);
  assert.match(r.motivo, /email inválido/);
  assert.match(r.motivo, /fecha de nacimiento inválida/);
  assert.ok(!r.motivo.includes("Ruiz"), "el motivo no filtra valores de la fila");
});

test("normalizarFila: columnas no mapeadas se ignoran", () => {
  const soloObligatorios: MapeoColumnas = { nombre: 0, apellido: 1, telefono: 2 };
  const r = normalizarFila(["Carlos", "Vega", "3515551234", "basura", "x"], soloObligatorios, 2);
  assert.ok(r.ok);
  assert.equal(r.data.dni, null);
});

test("normalizarFilas: numera desde 2 (la fila 1 es el encabezado)", () => {
  const rs = normalizarFilas(
    [
      ["Carlos", "Vega", "", "3515551234", "", ""],
      ["", "", "", "", "", ""],
    ],
    MAPEO,
  );
  assert.equal(rs[0].fila, 2);
  assert.equal(rs[1].fila, 3);
  assert.ok(rs[0].ok);
  assert.ok(!rs[1].ok);
});

// ─── Decisión de dedupe ─────────────────────────────────────────────────────

function sets(): DedupeSets {
  return { dni: new Set(), telefono: new Set() };
}

test("decidirDedupe: existente por DNI gana sobre teléfono", () => {
  const existentes: DedupeSets = { dni: new Set(["d1"]), telefono: new Set(["t1"]) };
  assert.equal(decidirDedupe({ dni: "d1", telefono: "t1" }, existentes, sets()), "duplicado_dni");
  assert.equal(decidirDedupe({ dni: "d2", telefono: "t1" }, existentes, sets()), "duplicado_telefono");
});

test("decidirDedupe: duplicado dentro del archivo (segunda aparición)", () => {
  const existentes = sets();
  const vistos = sets();
  assert.equal(decidirDedupe({ dni: "d1", telefono: "t1" }, existentes, vistos), "importar");
  assert.equal(decidirDedupe({ dni: "d1", telefono: "t9" }, existentes, vistos), "duplicado_en_archivo");
  assert.equal(decidirDedupe({ dni: null, telefono: "t1" }, existentes, vistos), "duplicado_en_archivo");
});

test("decidirDedupe: sin claves (DNI y teléfono null) siempre importa", () => {
  const existentes = sets();
  const vistos = sets();
  assert.equal(decidirDedupe({ dni: null, telefono: null }, existentes, vistos), "importar");
  assert.equal(decidirDedupe({ dni: null, telefono: null }, existentes, vistos), "importar");
});

test("decidirDedupe: importar registra las claves en vistos", () => {
  const vistos = sets();
  decidirDedupe({ dni: "d1", telefono: "t1" }, sets(), vistos);
  assert.ok(vistos.dni.has("d1"));
  assert.ok(vistos.telefono.has("t1"));
});

// ─── Integración parser → filas (caso Excel AR realista) ────────────────────

test("flujo completo: CSV Excel AR con ; BOM, tildes y fechas DD/MM/YYYY", () => {
  const csv =
    "\uFEFFNombre;Apellido;DNI;Teléfono;Email;Fecha de Nacimiento\r\n" +
    "María José;Pérez;28.123.456;+54 9 351 555 1234;mjose@mail.com;05/11/1980\r\n" +
    'Juan;"D\'Alessandro";30111222;0351 555-9999;;\r\n';
  const parseado = parseCsv(csv);
  assert.equal(parseado.separador, ";");
  const mapeo = proponerMapeo(parseado.headers);
  assert.equal(mapeo.fechaNacimiento, 5);
  const filas = normalizarFilas(parseado.filas, mapeo);
  assert.equal(filas.length, 2);
  assert.ok(filas[0].ok);
  assert.ok(filas[1].ok);
  if (filas[0].ok && filas[1].ok) {
    assert.equal(filas[0].data.nombre, "María José");
    assert.equal(filas[0].data.fechaNacimiento, "1980-11-05");
    assert.equal(filas[1].data.apellido, "D'Alessandro");
    assert.equal(claveTelefono(filas[1].data.telefono), "3515559999");
  }
});
