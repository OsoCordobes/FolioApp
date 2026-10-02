/* eslint-disable @typescript-eslint/no-require-imports -- Standalone component browser regression, like tests/agenda/browser.cjs. */
// Run: node --import ./scripts/testing/unit-bootstrap.mjs tests/e2e/booking-slots-recovery.cjs [evidence-directory]
// Real BookingWizard/React, injected read-only slot replies, all browser network blocked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const cwd = path.resolve(__dirname, '../..');
const dir = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'folio-booking-slots-'));
fs.mkdirSync(dir, { recursive: true });
const canary = 'synthetic-exception-must-not-reach-ui';
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {BookingWizard} from '@/components/booking/booking-wizard';
class Boundary extends React.Component {
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){window.qa.boundaryErrors++;}
 render(){return this.state.failed?<p data-boundary>Unexpected component failure</p>:this.props.children;}
}
window.qa={calls:[],boundaryErrors:0,writes:0};
const reply=(hour)=>({ok:true,data:[{inicio:'2026-10-05T'+hour+':00:00Z',fin:'2026-10-05T'+hour+':30:00Z'}]});
const fetchSlotsAction=async(input)=>{
 qa.calls.push(input);
 if(qa.calls.length>1)return reply('15');
 if(window.testCase==='returned-error')return {ok:false,error:{code:'network',message:'Synthetic returned slots error'}};
 if(window.testCase==='reject')throw Error('${canary}');
 return new Promise((resolve,reject)=>{qa.settleFirst=()=>window.testCase==='late-success'?resolve(reply('13')):reject(Error('${canary}'));});
};
const org={slug:'folio-test-slots',nombre:'Synthetic',ciudad:null,provincia:null,rubro:null,acentoHex:'#6255C5',logoUrl:null,cardMood:'clinico',bio:null,telefonoPublico:null,direccionCompleta:null,instagramHandle:null};
const servicios=[{id:'33333333-3333-4333-8333-333333333333',nombre:'Synthetic service',duracion_min:30,precio_cents:0,tipo_canonico:'CONSULTA',color:null}];
const profesionales=[{id:'${firstId}',displayName:'Synthetic Alpha'},{id:'${secondId}',displayName:'Synthetic Beta'}];
createRoot(document.getElementById('root')).render(<Boundary><BookingWizard org={org} servicios={servicios} profesionales={profesionales} fetchSlotsAction={fetchSlotsAction}/></Boundary>);`;
const stubs = {
  'next/script': 'export default function Script(){return null}',
  '@/app/(public)/book/[slug]/actions': 'export async function fetchSlotsPublico(){throw Error("real_read_forbidden")} export async function createPedidoPublico(){window.qa.writes++;throw Error("write_forbidden")}',
};

(async () => {
  const { LOCAL_BROWSER_ARGS } = await import('../../scripts/testing/browser-network.mjs');
  const modes = ['development', 'production'];
  for (const mode of modes) {
    await esbuild.build({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,
      outfile:path.join(dir, mode + '.js'),platform:'browser',jsx:'automatic',
      define:{'process.env.NODE_ENV':JSON.stringify(mode),'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':'""'},
      tsconfig:path.join(cwd,'tsconfig.json'),plugins:[{name:'synthetic-read-only-boundaries',setup(build){
        build.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);
        build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:cwd}));
      }}]});
  }
  const browser = await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
  const results = [];
  let blockedRequests = 0;
  try {
    const context = await browser.newContext();
    await context.route('**/*',async route=>{blockedRequests++;await route.abort();});
    await context.routeWebSocket('**/*',route=>route.close());
    for (const mode of modes) for (const testCase of ['reject','returned-error','late-success','late-reject']) {
      const page = await context.newPage();
      let pageErrors = 0;
      page.on('pageerror',()=>pageErrors++);
      try {
        await page.setContent('<html lang="es"><head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data:"></head><body><div id="root"></div></body></html>');
        await page.evaluate(value=>{window.testCase=value;},testCase);
        await page.addScriptTag({content:fs.readFileSync(path.join(dir,mode+'.js'),'utf8')});
        await page.getByRole('button',{name:'Synthetic service'}).click();
        await page.getByRole('button',{name:'Synthetic Alpha'}).click();
        await page.waitForFunction(()=>window.qa.calls.length===1);
        if (testCase==='reject'||testCase==='returned-error') {
          const message = testCase==='reject'?'No pudimos cargar los horarios. Volvé a intentarlo.':'Synthetic returned slots error';
          await expect(page.getByRole('alert')).toHaveText(message);
          await expect(page.locator('.bk-current-service')).toContainText('Synthetic service');
          await expect(page.getByRole('heading',{name:/Elegí un horario/})).toContainText('Synthetic Alpha');
          assert.equal(await page.evaluate(()=>qa.calls.length),1,'error cannot trigger an automatic retry');
          const retry = page.getByRole('button',{name:'Reintentar horarios'});
          await expect(retry).toBeEnabled();
          await expect(page.getByRole('heading',{name:/Elegí un horario/})).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(retry).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(page.locator('.bk-slot')).toHaveCount(1);
          await expect(page.getByRole('alert')).toHaveCount(0);
          await page.locator('.bk-slot').click();
          await expect(page.getByRole('heading',{name:'Tus datos'})).toBeFocused();
        } else {
          await page.getByRole('button',{name:/Cambiar profesional/}).click();
          await page.getByRole('button',{name:'Synthetic Beta'}).click();
          await page.waitForFunction(()=>window.qa.calls.length===2);
          await page.evaluate(()=>qa.settleFirst());
          await expect(page.locator('.bk-slot')).toHaveCount(1);
          await expect(page.locator('.bk-slot')).toHaveText('12:00');
          await expect(page.getByRole('heading',{name:/Elegí un horario/})).toContainText('Synthetic Beta');
          await expect(page.getByRole('alert')).toHaveCount(0);
        }
        assert.equal((await page.locator('body').innerText()).includes(canary),false,'raw exception cannot reach UI');
        const observed = await page.evaluate(()=>({calls:qa.calls,boundaryErrors:qa.boundaryErrors,writes:qa.writes}));
        assert.equal(observed.calls.length,2);
        assert.equal(observed.calls[0].profesionalId,firstId);
        assert.equal(observed.calls[1].profesionalId,testCase.startsWith('late-')?secondId:firstId);
        assert.equal(observed.calls[0].servicioId,observed.calls[1].servicioId);
        assert.equal(observed.boundaryErrors,0);
        assert.equal(observed.writes,0);
        assert.equal(pageErrors,0);
        results.push({mode,testCase,passed:true,calls:observed.calls.length,boundaryErrors:0,writes:0,pageErrors:0});
      } finally { await page.close(); }
    }
    await context.close();
    assert.equal(blockedRequests,0);
    fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({results,blockedRequests,serverStarted:false},null,2)+'\n');
    console.log(JSON.stringify({passed:results.length,skipped:0,blockedRequests,writes:0,evidence:dir}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
