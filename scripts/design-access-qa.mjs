/** Access microinteraction regression checks. Synthetic actions and loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeEnvironment } from './testing/isolation-policy.mjs';
import { installIsolation } from './testing/install-isolation.mjs';

installIsolation();
const clean = safeEnvironment(process.env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);
const { build } = await import('esbuild');
const { chromium } = await import('@playwright/test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-access-qa-'));
const evidence = path.join(root, 'docs/design/evidence');
const entry = `
import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';
import{AuthForms}from'@/components/auth/login-form';
import{CheckEmailPanel}from'@/components/auth/check-email-panel';
import{PortalLoginForm}from'@/app/(portal)/portal/login/login-form';
import{StepShell}from'@/components/onboarding/step-shell';
import{StickyBookCta}from'@/components/book-landing/sticky-book-cta';
window.qa={calls:[],next:0,back:0};
const fixture=new URLSearchParams(location.search).get('fixture');
createRoot(document.getElementById('root')).render(<StrictMode>{fixture==='sticky'?<div className='bl-root'><header className='bl-hero' style={{height:1100}}>Consultorio sintético</header><StickyBookCta label='Reservar turno'/><section style={{height:1500,display:'grid',placeItems:'center'}}><h2>Sobre esta consulta</h2></section><section id='reservar' style={{minHeight:500}}><div id='bk-flow'><h2 tabIndex={-1}>Elegí el servicio</h2><button className='bk-back'>Cambiar servicio</button></div></section><footer style={{height:900}}>Pie sintético</footer></div>:fixture==='onboarding'?<div className='onb-app fx-onboarding'><label>Fuera del asistente<input/></label><StepShell stepIdx={3} headline='Consultorio sintético' next={()=>qa.next++} back={()=>qa.back++} previewData={{nombre:'Profesional sintético',consultorioNombre:'Consultorio sintético',ciudad:'Córdoba',slug:'synthetic'}} appUrl='127.0.0.1'><label>Email confirmado<input readOnly value='synthetic@example.invalid'/></label><label>No disponible<select disabled><option>Sin opciones</option></select></label><label>Ciudad<input defaultValue='Córdoba'/></label><label>Provincia<select><option>Córdoba</option><option>Mendoza</option></select></label><label>Hora<input type='time' defaultValue='09:00'/></label><label>Notas<textarea/></label><label>Control propio<input onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')e.preventDefault()}}/></label></StepShell></div>:fixture==='email'?<main className='fx-auth-main'><CheckEmailPanel email='synthetic@example.invalid'/></main>:fixture==='portal'?<main className='au-main fx-auth-main'><PortalLoginForm initialError={new URLSearchParams(location.search).get('expired')?'El enlace venció. Pedí uno nuevo.':null}/></main>:<AuthForms initialVista={fixture==='forgot'?'forgot':'login'}/>}</StrictMode>);
`;
const stubs = {
  'next/navigation': `export const useRouter=()=>({push(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();`,
  'next/link': `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  'next/script': `export default function Script(){return null}`,
  'next/image': `export default function Image({src,alt,width,height,className}){return <img src={typeof src==='string'?src:src.src} alt={alt} width={width} height={height} className={className}/>} `,
  '@/app/(public)/login/actions': `export function requestPasswordReset(email){return new Promise(resolve=>{qa.calls.push({action:'reset',email});qa.resolveReset=resolve})}export async function resendSignupConfirmation(){return {ok:true}}export async function signInWithGoogle(){throw Error('Unexpected OAuth')}export async function signInWithPassword(){throw Error('Unexpected sign-in')}`,
  '@/app/(public)/onboarding/actions': `export async function signUpAndInitOrganization(){throw Error('Unexpected signup')}`,
  './actions': `export function sendPortalMagicLink(data){return new Promise(resolve=>{qa.calls.push({action:'portal',...data});qa.resolvePortal=()=>resolve({ok:true})})}`,
};
for (const mode of ['development', 'production']) {
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(dir, `${mode}.js`), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode), 'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify('http://127.0.0.1:4410'), 'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': '""' },
    tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'synthetic-actions', setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
    } }] });
}
const styleFiles = ['public/folio.css', 'styles/experience.css', 'styles/platform.css', 'styles/auth-experience.css', 'styles/public-experience.css'];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (['/development.js', '/production.js'].includes(url.pathname)) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(dir,path.basename(url.pathname))));
  } else if (url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');res.end(`@font-face{font-family:FolioQA;src:url('/fonts/plus-jakarta-sans-latin.woff2') format('woff2');font-weight:200 800;font-display:swap}:root{--font-folio:FolioQA}`+styleFiles.map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n'));
  } else if (/^\/fonts\/[a-z0-9._-]+\.woff2$/i.test(url.pathname)) {
    const font=path.join(root,'public',url.pathname);res.statusCode=fs.existsSync(font)?200:404;res.end(fs.existsSync(font)?fs.readFileSync(font):'');
  } else {
    const mode = url.pathname.includes('production') ? 'production' : 'development';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><link rel='stylesheet' href='/fixture.css'></head><body><div id='root'></div><script src='/${mode}.js'></script></body></html>`);
  }
}).listen(0,'127.0.0.1');
await new Promise(resolve => server.on('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
const results=[];
try {
  for (const mode of ['development','production']) {
    const run=async(name,fixture,scenario,init)=>{
      const page=await context.newPage();page.setDefaultTimeout(4500);const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try {if(init)await page.addInitScript(init);await page.goto(`${origin}/${mode}?fixture=${fixture}`);await page.evaluate(()=>document.fonts.ready);await scenario(page);assert.deepEqual(errors,[]);results.push({mode,case:name,pass:true});}
      catch(error){results.push({mode,case:name,pass:false,error:error.message,pageErrors:errors});}
      finally{console.log(JSON.stringify(results.at(-1)));await page.close();}
    };
    await run('recovery validates locally, returns focus and preserves email across views','login',async page=>{
      const address='synthetic@example.invalid';await page.getByRole('textbox',{name:'Email',exact:true}).fill(address);
      await page.getByRole('button',{name:'¿La olvidaste?',exact:true}).click();const input=page.getByRole('textbox',{name:'Email de tu cuenta'});
      assert.equal(await input.inputValue(),address);await input.fill('');await page.getByRole('button',{name:'Enviar enlace de recuperación'}).click();
      assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      assert.match(await page.getByRole('alert').innerText(),/Ingresá un email válido/);assert.deepEqual(await page.evaluate(()=>qa.calls),[]);
      await input.fill('synthetic');await page.getByRole('button',{name:'Enviar enlace de recuperación'}).click();assert.equal(await input.getAttribute('aria-invalid'),'true');
      await input.fill(address);await page.getByRole('button',{name:'Volver a entrar',exact:true}).click();
      assert.equal(await page.getByRole('textbox',{name:'Email',exact:true}).inputValue(),address);
    });
    await run('recovery pending locks the submitted address and success receives focus','forgot',async page=>{
      const input=page.getByRole('textbox',{name:'Email de tu cuenta'});await input.fill('synthetic@example.invalid');
      await page.getByRole('button',{name:'Enviar enlace de recuperación'}).click();await page.getByRole('button',{name:'Enviando…'}).waitFor();
      assert.equal(await input.isDisabled(),true);assert.equal(await page.locator('form').getAttribute('aria-busy'),'true');
      if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-access-recovery-pending.png'),fullPage:false});
      assert.deepEqual(await page.evaluate(()=>qa.calls),[{action:'reset',email:'synthetic@example.invalid'}]);await page.evaluate(()=>qa.resolveReset());
      const heading=page.getByRole('heading',{name:'Revisá tu email.'});await heading.waitFor();assert.equal(await heading.evaluate(el=>el===document.activeElement),true);
      assert.match(await page.locator('.au-sent').innerText(),/Si hay una cuenta asociada/);
      if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-access-recovery-success.png'),fullPage:false});
    });
    await run('portal expired notice does not blame email; validation and success focus are explicit','portal&expired=1',async page=>{
      const input=page.getByRole('textbox',{name:'Email',exact:true});assert.equal(await input.getAttribute('aria-invalid'),'false');
      await page.getByRole('button',{name:'Enviarme el enlace'}).click();assert.equal(await input.getAttribute('aria-invalid'),'true');
      assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.deepEqual(await page.evaluate(()=>qa.calls),[]);
      await input.fill('synthetic@example.invalid');await page.getByRole('button',{name:'Enviarme el enlace'}).click();await page.getByRole('button',{name:'Enviando…'}).waitFor();
      assert.equal(await input.isDisabled(),true);await page.evaluate(()=>qa.resolvePortal());const heading=page.getByRole('heading',{name:'Revisá tu email.'});await heading.waitFor();
      assert.equal(await heading.evaluate(el=>el===document.activeElement),true);
    });
    await run('native select and time Enter/Escape do not navigate onboarding','onboarding',async page=>{
      await page.getByRole('heading',{name:'Consultorio sintético'}).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'Ciudad',exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.getByRole('combobox',{name:'Provincia'}).press('Enter');await page.keyboard.press('Escape');
      await page.getByLabel('Hora',{exact:true}).press('Enter');await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(()=>({next:qa.next,back:qa.back})),{next:0,back:0});
    });
    await run('IME, handled events, textarea and focus outside wizard do not navigate','onboarding',async page=>{
      const city=page.getByRole('textbox',{name:'Ciudad',exact:true});await city.waitFor();
      await city.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});await city.dispatchEvent('keydown',{key:'Enter',repeat:true,bubbles:true});
      await page.getByRole('textbox',{name:'Control propio'}).press('Enter');await page.keyboard.press('Escape');
      await page.getByRole('textbox',{name:'Notas'}).press('Enter');await page.getByRole('textbox',{name:'Fuera del asistente'}).press('Enter');await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(()=>({next:qa.next,back:qa.back})),{next:0,back:0});
      await city.press('Enter');await city.press('Escape');assert.deepEqual(await page.evaluate(()=>({next:qa.next,back:qa.back})),{next:1,back:1});
    });
    await run('confirmation countdown is visible but excluded from the live status','email',async page=>{
      const timer=page.getByRole('timer');await timer.waitFor();assert.equal(await timer.getAttribute('aria-live'),'off');
      assert.equal(await page.getByRole('status').innerText(),'Enlace reenviado.');assert.equal(await page.getByRole('button',{name:'Reenviar enlace'}).isDisabled(),true);
      if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-access-confirmation-timer.png'),fullPage:false});
    },()=>{sessionStorage.setItem('folio.check-email-panel.cooldown-until',String(Date.now()+120000));sessionStorage.setItem('folio.check-email-panel.resends','1')});
    await run('booking CTA appears after hero, focuses the flow and leaves its controls unobstructed','sticky',async page=>{
      const sticky=page.locator('.bl-sticky-cta');await page.getByText('Consultorio sintético',{exact:true}).waitFor();assert.equal(await sticky.isVisible(),false);
      await page.getByRole('heading',{name:'Sobre esta consulta'}).scrollIntoViewIfNeeded();await sticky.waitFor({state:'visible'});
      await page.getByRole('link',{name:'Reservar turno',exact:true}).click();await sticky.waitFor({state:'hidden'});
      assert.equal(await page.getByRole('heading',{name:'Elegí el servicio'}).evaluate(el=>el===document.activeElement),true);
      assert.ok((await page.getByRole('button',{name:'Cambiar servicio'}).boundingBox()).height>=44);
      assert.equal(await page.locator('.bl-sticky-btn').getAttribute('tabindex'),'-1');
    });
    await run('access touch targets, keyboard focus, responsive widths and reduced motion','login',async page=>{
      await page.getByRole('heading',{name:'Volvé a tu consultorio.'}).waitFor();
      for(const width of [390,1440]){
        await page.setViewportSize({width,height:width===390?844:1000});
        for(const name of ['Mostrar contraseña','¿La olvidaste?','Crear cuenta']){
          const button=page.getByRole('button',{name,exact:true});const size=await button.boundingBox();assert.ok(size.width>=44&&size.height>=44,`${name} >=44px`);
        }
        await page.getByRole('button',{name:'Mostrar contraseña',exact:true}).focus();
        assert.ok(await page.getByRole('button',{name:'Mostrar contraseña',exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>=3));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.ok(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
        assert.equal(await page.locator('.au-submit').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
        if(mode==='production')await page.screenshot({path:path.join(evidence,`polish-access-reduced-${width}.png`),fullPage:false});
      }
    });
  }
} finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(evidence,'polish-access-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
