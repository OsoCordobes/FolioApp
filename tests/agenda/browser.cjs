/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser harness. */
// Run: node --import ./scripts/testing/unit-bootstrap.mjs tests/agenda/browser.cjs
// Real hook/notice/React; controlled HTTP responses, no Supabase or patients.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const http = require('node:http'), assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { chromium } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-agenda-revision-'));
const entry = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{useAgendaAutoRefresh}from'@/lib/use-agenda-refresh';
import{AgendaSyncNotice}from'@/components/agenda/agenda-sync-notice';
window.qa={calls:[],refreshes:0,revision:'1:2026-09-08',status:200,org:'org-a',pending:false,jobs:[],applyRender:true,
 show(v){Object.defineProperty(document,'visibilityState',{configurable:true,value:v?'visible':'hidden'});document.dispatchEvent(new Event('visibilitychange'))},
 check(){window.dispatchEvent(new Event('online'))},
 settle(){for(const j of this.jobs.splice(0))j()},
};
window.fetch=(url,options)=>{const record={url,aborted:false};qa.calls.push(record);
 options.signal.addEventListener('abort',()=>record.aborted=true);
 const reply=()=>new Response(JSON.stringify({organizationId:qa.org,revision:qa.revision}),{status:qa.status});
 return qa.pending?new Promise(resolve=>qa.jobs.push(()=>resolve(reply()))):Promise.resolve(reply());
};
function App(){const[org,setOrg]=useState('org-a');const[revision,setRevision]=useState(null);qa.ack=setRevision;qa.changeOrg=v=>{setOrg(v);setRevision(null)};const sync=useAgendaAutoRefresh(org,revision);return <><p>Turnos conservados</p><output>{sync.status}</output><AgendaSyncNotice sync={sync}/></>}
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
`;
const stubs = {
  'next/navigation': 'const router={refresh(){window.qa.refreshes++;if(window.qa.applyRender)window.qa.ack(window.qa.revision)}};export function useRouter(){return router}',
  '@/lib/db/realtime': 'export function useRealtimeTable(){}',
};
(async () => {
  for (const mode of ['development', 'production']) await esbuild.build({
    stdin: { contents: entry, resolveDir: cwd, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, mode + '.js'), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode), 'process.env.NEXT_PUBLIC_AGENDA_REALTIME': '"0"' },
    tsconfig: path.join(cwd, 'tsconfig.json'), plugins: [{ name: 'isolated-agenda', setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'stub' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: cwd }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/production.js' || req.url === '/development.js') {
      res.setHeader('Content-Type', 'text/javascript');res.end(fs.readFileSync(path.join(dir, req.url.slice(1))));
    } else res.end(`<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/${req.url === '/production' ? 'production' : 'development'}.js"></script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mode of ['development', 'production']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.routeWebSocket(/.*/, route => route.close());
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/${mode}`);
      await page.waitForFunction(() => document.querySelector('output')?.textContent === 'active');
      const initial = await page.evaluate(() => qa.refreshes);
      assert.equal(initial, 1, 'StrictMode abandoned request cannot refresh');
      for (let n = 0; n < 3; n++) { await page.evaluate(() => qa.check()); await page.waitForTimeout(50); }
      assert.equal(await page.evaluate(() => qa.refreshes), initial, 'unchanged marker avoids full refresh');
      await page.evaluate(() => { qa.revision = '2:2026-09-08'; qa.check(); });
      await page.waitForFunction(() => qa.refreshes === 2);
      await page.evaluate(() => { qa.show(false); });
      const hiddenCount = await page.evaluate(() => qa.calls.length);
      await page.evaluate(() => { qa.check(); qa.check(); }); await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => qa.calls.length), hiddenCount, 'hidden tab ignores network/realtime nudges');
      await page.evaluate(() => { qa.pending = true; qa.show(true); });
      await page.waitForFunction(() => qa.jobs.length === 1);
      await page.evaluate(() => { qa.show(false); qa.revision = '3:2026-09-08'; qa.settle(); });
      assert.equal(await page.evaluate(() => qa.calls.at(-1).aborted), true);
      await page.waitForTimeout(50);assert.equal(await page.evaluate(() => qa.refreshes), 2, 'late hidden answer ignored');
      await page.evaluate(() => { qa.pending = false; qa.status = 503; qa.show(true); });
      await page.locator('.agenda-sync-notice').waitFor();
      assert.equal(await page.getByText('Turnos conservados').count(), 1);
      await page.evaluate(() => { qa.status = 200; });
      await page.getByRole('button', { name: 'Volver a comprobar' }).focus();await page.keyboard.press('Enter');
      await page.waitForFunction(() => qa.refreshes === 3 && !document.querySelector('[role=status]'));
      await page.evaluate(() => { qa.status = 403; qa.check(); });
      await page.waitForFunction(() => qa.refreshes === 4 && !!document.querySelector('[role=status]'));
      await page.evaluate(() => { qa.status = 200; qa.changeOrg('org-b'); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector('output').textContent), 'stale', 'old organization response is not applied');
      await page.evaluate(() => { qa.org = 'org-b'; qa.check(); });
      await page.waitForFunction(() => document.querySelector('output').textContent === 'active' && qa.refreshes === 5);
      await page.evaluate(() => { qa.applyRender = false; qa.revision = '4:2026-09-08'; qa.check(); });
      await page.waitForFunction(() => qa.refreshes === 6);
      await page.evaluate(() => qa.check());
      await page.waitForFunction(() => qa.refreshes === 7 && !!document.querySelector('.agenda-sync-notice'));
      await page.evaluate(() => { qa.applyRender = true; qa.check(); });
      await page.waitForFunction(() => qa.refreshes === 8 && document.querySelector('output').textContent === 'active');
      await page.evaluate(() => { qa.revision = '4:2026-09-09'; qa.check(); });
      await page.waitForFunction(() => qa.refreshes === 9 && document.querySelector('output').textContent === 'active');
      await page.evaluate(() => qa.check());await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => qa.refreshes),9,'midnight refreshes once even without a write');
      assert.deepEqual(errors, []);
      results.push({ mode, unchangedAvoidsRefresh: true, hiddenAndLateIgnored: true, failedCheckVisible: true, keyboardRetry: true, forbiddenRefreshesSession: true, organizationGuard: true, failedServerRenderRetriesUntilAcknowledged: true, midnightWithoutWrite: true });
      await context.close();
    }
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, evidenceDirectory: dir }));
})().catch(e => { console.error(e); process.exitCode = 1; });
