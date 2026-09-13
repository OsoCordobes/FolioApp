/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS renderer check */
// Run with normal React (not react-server): node tests/pdf/render-real.cjs
// Synthetic data only. No database, environment files, or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deflateSync, inflateSync } = require('node:zlib');
const { buildSync } = require('esbuild');

for (const key of Object.keys(process.env)) {
  if (!['systemroot', 'windir', 'path', 'temp', 'tmp', 'comspec', 'pathext'].includes(key.toLowerCase())) {
    delete process.env[key];
  }
}
process.env.NODE_ENV = 'production';
const deny = () => { throw new Error('PDF regression forbids network access'); };
for (const protocol of ['node:http', 'node:https']) {
  const api = require(protocol);
  api.request = deny;
  api.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
globalThis.fetch = async input => {
  const uri = String(input);
  const prefix = 'data:application/octet-stream;base64,';
  // Yoga loads its bundled WASM through a data URI, entirely in memory.
  if (uri.startsWith(prefix) && uri.length < 2_000_000) {
    return new Response(Buffer.from(uri.slice(prefix.length), 'base64'));
  }
  return deny();
};

const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.flow', 'pdf-render-regression');
fs.mkdirSync(output, { recursive: true });

// This is deliberately a fixture-specific inspector, not a general PDF parser:
// standard Helvetica renders these ASCII markers in Flate-compressed TJ arrays.
function inspect(pdf) {
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const raw = pdf.toString('latin1');
  assert.match(raw, /%%EOF\s*$/);
  let text = '';
  const streamHeaders = /\bstream\r?\n/g;
  let stream;
  while ((stream = streamHeaders.exec(raw)) !== null) {
    // PDFKit writes a direct byte Length, followed by FlateDecode. Read that
    // many bytes: compressed data may end in CR or contain endstream itself.
    const dictionary = raw.slice(raw.lastIndexOf('<<', stream.index), stream.index);
    const declaration = dictionary.match(/^<<\s*\/Length\s+(\d+)\s*\/Filter\s*\/FlateDecode\s*>>\s*$/);
    assert.ok(declaration, 'Expected a PDFKit stream with a direct Length and FlateDecode');
    const length = Number(declaration[1]);
    const start = streamHeaders.lastIndex;
    const end = start + length;
    assert.ok(Number.isSafeInteger(length) && end <= pdf.length, 'PDF stream Length exceeds its buffer');
    const trailer = raw.slice(end).match(/^\r?\nendstream\r?\nendobj\b/);
    assert.ok(trailer, 'PDF stream Length must end exactly before its delimiter');
    streamHeaders.lastIndex = end + trailer[0].length;
    const operators = inflateSync(pdf.subarray(start, end)).toString('latin1');
    for (const array of operators.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      text += [...array[1].matchAll(/<([a-f\d]+)>/gi)]
        .map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join('');
    }
  }
  return { text, pages: [...raw.matchAll(/\/Type\s*\/Page\b/g)].length };
}

function verifyStreamBoundaries() {
  const marker = 'BOUNDARY_MARKER';
  const operators = `[<${Buffer.from(marker).toString('hex')}>] TJ`;
  const synthetic = (stream, length = stream.length, eol = '\n') => Buffer.concat([
    Buffer.from(`%PDF-1.3\n1 0 obj\n<<\n/Length ${length}\n/Filter /FlateDecode\n>>\nstream\n`),
    stream,
    Buffer.from(`${eol}endstream\nendobj\n%%EOF\n`),
  ]);
  // Valid zlib bytes whose Adler-32 checksum ends in CR. The old delimiter
  // regex consumed this data byte together with PDFKit's following LF.
  const endingInCr = Buffer.from('789c8bb6313132493335354935313131343532b5344d334901b14c924c4c4d8dec621542bcb8542d2c2d2d01e3930a0d', 'hex');
  assert.equal(endingInCr.at(-1), 0x0d);
  assert.ok(inflateSync(endingInCr).toString().includes('TJ'));
  for (const eol of ['\n', '\r\n']) {
    assert.equal(inspect(synthetic(endingInCr, endingInCr.length, eol)).text, marker);
  }
  // An uncompressed DEFLATE block can contain a literal endstream delimiter.
  const embeddedDelimiter = deflateSync(Buffer.from(`%\nendstream\n${operators}`), { level: 0 });
  assert.ok(embeddedDelimiter.includes(Buffer.from('\nendstream\n')));
  assert.equal(inspect(synthetic(embeddedDelimiter)).text, marker);
  assert.throws(() => inspect(synthetic(endingInCr, endingInCr.length + 1)));
  assert.throws(() => inspect(synthetic(endingInCr.subarray(0, -1))), { code: 'Z_BUF_ERROR' });
}

function fixture(count) {
  return {
    organizacion: 'Consultorio sintetico', profesional: 'Profesional sintetico',
    matricula: null, paciente: 'Paciente de prueba sin datos reales', edad: '30',
    genero: '-', motivo: 'Ensayo sintetico', fechaSesion: null,
    soap: { s: 'Registro sintetico', o: '', a: '', p: '' },
    resumenHerramienta: null, especialidad: null, instrumentos: [],
    generadoTs: '2026-09-08T12:00:00Z', alcanceEntrega: 'Historial autorizado sin adjuntos.',
    evolucion: Array.from({ length: count }, (_, i) => ({
      fecha: '2026-09-08', servicio: `Consulta sintetica ${i + 1}`,
      resumen: `ORIGINAL_SESION_${String(i + 1).padStart(2, '0')}`,
      notas: `Nota sintetica ${i + 1}`,
      soap: { s: 'Texto original sintetico', o: 'Observacion sintetica', a: 'Registro sintetico', p: 'Plan sintetico' },
      profesionalId: `PROFESIONAL_SESION_${String(i + 1).padStart(2, '0')}`, lockedAt: '2026-09-08T12:00:00Z',
      enmiendas: [{ id: `e${i}`, autorId: `AUTOR_ENMIENDA_${String(i + 1).padStart(2, '0')}`, createdAt: '2026-09-08T12:00:00Z',
        motivo: 'Correccion que conserva el original', texto: `ENMIENDA_SESION_${String(i + 1).padStart(2, '0')}` }],
    })),
  };
}

(async () => {
  verifyStreamBoundaries();
  const bundled = path.join(output, 'renderer.cjs');
  buildSync({ entryPoints: [path.join(root, 'lib/pdf/ficha-pdf.tsx')], outfile: bundled,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
  const { buildFichaPdf } = require(bundled);
  const evidence = [];
  for (const count of [1, 10, 62]) {
    const pdf = await buildFichaPdf(fixture(count));
    const { text, pages } = inspect(pdf);
    for (let i = 1; i <= count; i++) {
      for (const kind of ['ORIGINAL', 'ENMIENDA', 'PROFESIONAL']) {
        assert.ok(text.includes(`${kind}_SESION_${String(i).padStart(2, '0')}`), `${kind} ${i} missing`);
      }
      assert.ok(text.includes(`AUTOR_ENMIENDA_${String(i).padStart(2, '0')}`), `amendment author ${i} missing`);
    }
    if (count === 62) assert.ok(pages > 10);
    fs.writeFileSync(path.join(output, `synthetic-${count}.pdf`), pdf);
    evidence.push({ case: `${count} sessions and amendments`, pages, bytes: pdf.length });
  }
  const long = fixture(1);
  const markers = [];
  const paragraphs = kind => Array.from({ length: 180 }, (_, i) => {
    const marker = `${kind}_LARGO_${String(i + 1).padStart(3, '0')}`;
    markers.push(marker);
    return `${marker} Texto sintetico para comprobar saltos de pagina sin perder contenido.`;
  }).join('\n');
  long.evolucion[0].soap.s = paragraphs('SOAP');
  long.evolucion[0].notas = paragraphs('NOTA');
  long.evolucion[0].enmiendas[0].texto = paragraphs('ENMIENDA');
  const pdf = await buildFichaPdf(long);
  const { text, pages } = inspect(pdf);
  assert.ok(pages > 5, 'Long session must cross several pages');
  for (const marker of markers) assert.ok(text.includes(marker), `${marker} missing`);
  fs.writeFileSync(path.join(output, 'synthetic-long.pdf'), pdf);
  evidence.push({ case: 'one long session', verifiedMarkers: markers.length, pages, bytes: pdf.length });
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ syntheticOnly: true, networkDisabled: true, passed: evidence }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
