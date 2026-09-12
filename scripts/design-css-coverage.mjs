/** Observed local landing CSS coverage, not a safe deletion list. */
import fs from 'node:fs';
import { chromium } from '@playwright/test';
if(process.env.FOLIO_TEST_ISOLATED!=='1'||process.env.E2E_BASE_URL!=='http://127.0.0.1:4410')throw new Error('Use isolated bootstrap.');
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===process.env.E2E_BASE_URL&&route.request().method()==='GET'?route.continue():route.abort('blockedbyclient'));
  await context.addInitScript(()=>localStorage.setItem('folio.cookieConsent','denied'));
  const page=await context.newPage();await page.coverage.startCSSCoverage({resetOnNavigation:false});
  await page.goto(process.env.E2E_BASE_URL);await page.locator('#fx-hero-title').waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const label of ['La agenda','La historia clínica','Los cobros'])await page.getByRole('tab',{name:label,exact:true}).click();
    for(const [label,id]of [['Psicología','psicologia'],['Cardiología','cardiologia'],['Kinesiología','kinesiologia'],['Nutrición','nutricion'],['Quiropraxia','quiropraxia']]){
      if(width<=600)await page.getByLabel('Explorá una especialidad').selectOption(id);else await page.getByRole('button',{name:label,exact:true}).click();
    }
    const menu=page.getByRole('button',{name:'Abrir menú de navegación'});
    if(await menu.isVisible()){await menu.click();await page.keyboard.press('Escape');}
    await page.locator('#faq details').first().locator('summary').click();
    for(const section of await page.locator('[data-fl-section]').all())await section.scrollIntoViewIfNeeded();
  }
  const coverage=await page.coverage.stopCSSCoverage();
  const result={date:new Date().toISOString(),scope:'Synthetic local landing, 1440/768/390/320, three product views, five specialties, FAQ, mobile menu. Unused here does not mean safe to delete: other routes, dark mode, pointer states and print not exercised.',sheets:coverage.map(sheet=>({path:new URL(sheet.url||process.env.E2E_BASE_URL).pathname,sourceBytes:Buffer.byteLength(sheet.text),observedUsedCharacters:sheet.ranges.reduce((sum,range)=>sum+range.end-range.start,0),sourceCharacters:sheet.text.length,observedUsedPercent:Number((100*sheet.ranges.reduce((sum,range)=>sum+range.end-range.start,0)/sheet.text.length).toFixed(2))}))};
  fs.writeFileSync('docs/design/evidence/cross-css-coverage.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));await context.close();
}finally{await browser.close();}
