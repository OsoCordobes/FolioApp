/** Local browser stress review. No forms submitted and external network is blocked. */
import fs from 'node:fs';
import { chromium } from '@playwright/test';
if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== 'http://127.0.0.1:4410') throw new Error('Use isolated bootstrap.');
const browser = await chromium.launch({ headless: true });
const suffix = process.argv.includes('--final') ? '-final' : process.argv.includes('--after') ? '-after' : '';
const cases = process.argv.includes('--mobile-only') ? [[390,2],[320,2]] : [[1440,1],[1024,1],[768,1],[720,1],[390,1],[320,1],[1440,2],[768,2],[390,2],[320,2]];
const results = [];
try {
  for (const [width, scale] of cases) {
    const context = await browser.newContext({ viewport: {width,height:1000}, reducedMotion:'reduce', serviceWorkers:'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === process.env.E2E_BASE_URL && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
    await context.addInitScript(() => localStorage.setItem('folio.cookieConsent','denied'));
    const page = await context.newPage();
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    // Finish hydration before changing server-rendered styles for the text stress case.
    await page.goto(process.env.E2E_BASE_URL,{waitUntil:'networkidle'});
    await page.locator('#fx-hero-title').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    if(scale===2) await page.evaluate(()=>{
      // Stress test of fixed-pixel text, not a claim of native browser zoom.
      const textElements=[...document.querySelectorAll('.fx-marketing *')].filter(el=>!(el instanceof SVGElement));
      const values=textElements.map(el=>[el,parseFloat(getComputedStyle(el).fontSize),parseFloat(getComputedStyle(el).lineHeight)]);
      for(const [el,size,line]of values){el.style.setProperty('font-size',`${size*2}px`,'important');if(Number.isFinite(line))el.style.setProperty('line-height',`${line*2}px`,'important');}
    });
    const sample={width,textScale:scale,viewportsAsZoomNote:'720 CSS px approximates reflow of a 1440px window at 200%; textScale=2 is separate CSS text stress.',tour:[],specialties:[],pageErrors,consoleErrors};
    for(const label of ['La agenda','La historia clínica','Los cobros']) {
      await page.getByRole('tab',{name:label,exact:true}).click();
      sample.tour.push(await page.getByRole('tablist',{name:'Recorrer las funciones de Folio'}).evaluate(el=>{
        const chosen=el.querySelector('[aria-selected="true"]');const r=el.getBoundingClientRect();const selected=chosen.getBoundingClientRect();
        const pill=getComputedStyle(el,'::before');const transform=new DOMMatrixReadOnly(pill.transform);
        const panel=document.getElementById(chosen.getAttribute('aria-controls'));
        return {selected:chosen.textContent,selectedId:chosen.id,panelLabel:panel.getAttribute('aria-labelledby'),headings:[...panel.querySelectorAll('[data-visible="true"] h3')].map(h=>h.textContent),pillDeltaX:r.left+parseFloat(pill.left)+transform.m41-selected.left,pillWidth:parseFloat(pill.width),tabWidth:selected.width,panelHeight:panel.getBoundingClientRect().height,pageOverflow:document.documentElement.scrollWidth>innerWidth};
      }));
    }
    await page.locator('#producto').scrollIntoViewIfNeeded();
    if([320,768,1440].includes(width))await page.screenshot({path:`docs/design/evidence/cross-tour-${width}-text${scale}${suffix}.png`});
    for(const [label,id] of [['Psicología','psicologia'],['Cardiología','cardiologia'],['Kinesiología','kinesiologia'],['Nutrición','nutricion'],['Quiropraxia','quiropraxia']]) {
      if(width<=600)await page.getByLabel('Explorá una especialidad').selectOption(id);
      else await page.getByRole('button',{name:label,exact:true}).click();
      sample.specialties.push(await page.locator('#specialty-record').evaluate(el=>({label:el.getAttribute('aria-label'),height:el.getBoundingClientRect().height,pageOverflow:document.documentElement.scrollWidth>innerWidth,visibleHeadings:[...el.querySelectorAll('[data-visible="true"] h3')].map(h=>h.textContent),clipped:[...el.querySelectorAll('[data-visible="true"] *')].filter(node=>node instanceof HTMLElement && node.scrollWidth>node.clientWidth+2 && getComputedStyle(node).display!=='inline').slice(0,8).map(node=>({className:node.className,text:node.textContent.slice(0,65),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}))})));
    }
    await page.locator('#ficha').scrollIntoViewIfNeeded();
    if([320,768,1440].includes(width))await page.screenshot({path:`docs/design/evidence/cross-specialties-${width}-text${scale}${suffix}.png`});
    if (process.argv.includes('--diagnose-overflow')) {
      sample.overflowDiagnostic = await page.evaluate(() => {
        const describe = node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().replace(/\s+/g, '.')}` : ''}`;
        const root = document.querySelector('.fx-marketing');
        const offenders = [...root.querySelectorAll('*')].filter(node => {
          if (!(node instanceof HTMLElement) || !node.getClientRects().length) return false;
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return style.visibility !== 'hidden' && Math.max(bounds.right, bounds.left + node.scrollWidth) > innerWidth + 1;
        }).map(node => {
          const bounds = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const clips = [];
          for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor);
            if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestorStyle.overflowX)) {
              const rect = ancestor.getBoundingClientRect();
              clips.push({ element: describe(ancestor), overflowX: ancestorStyle.overflowX, left: rect.left, right: rect.right });
            }
          }
          return {
            element: describe(node), text: node.textContent.trim().slice(0, 90),
            left: bounds.left, right: bounds.right, width: bounds.width,
            scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
            position: style.position, fontSize: style.fontSize, whiteSpace: style.whiteSpace,
            overflowX: style.overflowX, clippedBy: clips,
          };
        });
        return {
          viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth, rootWidth: root.scrollWidth,
          scrollX, offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 50),
        };
      });
    }
    if (process.argv.includes('--diagnose-overflow') && width === 320) {
      await page.addStyleTag({ content: '.fx-header{position:static!important}' });
      await page.locator('.fx-price-card--team').screenshot({ path:'docs/design/evidence/text-stress-pricing-320.png' });
    }
    results.push(sample);console.log(JSON.stringify(sample));await context.close();
  }
}finally{await browser.close();}
fs.writeFileSync(`docs/design/evidence/cross-layout-review${suffix}.json`,JSON.stringify(results,null,2)+'\n');
if(results.some(sample=>sample.pageErrors.length || sample.consoleErrors.length || sample.tour.some(tour=>tour.pageOverflow) || sample.specialties.some(specialty=>specialty.pageOverflow || specialty.clipped.length)))throw new Error('The browser stress review found errors or overflowing content. Inspect the saved report.');
