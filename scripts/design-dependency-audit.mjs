/** Detached dependency estimate. Does not run Next/build or alter application output. */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { safeEnvironment } from './testing/isolation-policy.mjs';
import { installIsolation } from './testing/install-isolation.mjs';
installIsolation();
const clean = safeEnvironment(process.env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);
const { build } = await import('esbuild');
const root = process.cwd();
const report = { date: new Date().toISOString(), note: 'Detached esbuild estimate with React external. Not an actual Next route bundle or claimed First Load saving.', modules: {}, styles: [] };
for (const [name, file, change] of [
  ['queryProvider', 'lib/query-client.tsx', null],
  ['motionDomAnimation', 'components/motion/motion-provider.tsx', null],
  ['motionDomMaxComparison', 'components/motion/motion-provider.tsx', true],
]) {
  let contents = fs.readFileSync(file, 'utf8');
  if (change) contents = contents.replaceAll('domAnimation', 'domMax');
  const result = await build({ stdin: { contents, resolveDir: root, sourcefile: file, loader: 'tsx' },
    bundle: true, platform: 'browser', format: 'esm', minify: true, write: false, metafile: true,
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    external: ['react', 'react-dom', 'react/jsx-runtime'], tsconfig: 'tsconfig.json' });
  const code = result.outputFiles[0].contents;
  const sources = Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs).map(([file, entry]) => ({ file, bytesInOutput: entry.bytesInOutput })));
  report.modules[name] = { bytes: code.byteLength, gzipBytes: gzipSync(code).byteLength,
    includedSourceCount: sources.length, largestSources: sources.sort((a,b) => b.bytesInOutput - a.bytesInOutput).slice(0, 8) };
}
for (const file of ['public/folio.css', 'styles/experience.css', 'styles/platform.css', 'styles/clinical-experience.css', 'styles/auth-experience.css', 'styles/public-experience.css', 'styles/specialty-showcase.css']) {
  const content = fs.readFileSync(file);
  report.styles.push({ file, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength });
}
fs.writeFileSync(path.join(root, 'docs/design/evidence/cross-dependencies.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
