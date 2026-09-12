/** Focused local contrast review. Synthetic public illustrations, no submissions. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

if (process.env.FOLIO_TEST_ISOLATED !== '1' || process.env.E2E_BASE_URL !== 'http://127.0.0.1:4410') throw new Error('Use isolated app bootstrap.');
const channels = color => color.startsWith('#') ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = color => channels(color).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
const contrast = (fg, bg) => { const a = luminance(fg); const b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
const report = { checkedAt: new Date().toISOString(), method: 'sRGB relative luminance; focused pairs and keyboard states, not a complete accessibility audit', before: { foreground: '#706B84', background: '#F0EFF8', ratio: contrast('#706B84', '#F0EFF8') }, after: { foreground: '#6D687F', background: '#F0EFF8', ratio: contrast('#6D687F', '#F0EFF8') }, states: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', colorScheme: theme, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === process.env.E2E_BASE_URL && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
    await context.addInitScript(theme => { localStorage.setItem('folio.cookieConsent', 'denied'); localStorage.setItem('folio.tweaks.v1', JSON.stringify({ theme })); }, theme);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.E2E_BASE_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    const tabs = page.getByRole('tablist', { name: 'Recorrer las funciones de Folio' });
    await tabs.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    const selected = tabs.getByRole('tab', { name: 'La historia clínica', exact: true });
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'La historia clínica', exact: true }).getByRole('heading', { name: 'Martina Ríos', exact: true })).toBeVisible();
    const tour = await tabs.evaluate(el => {
      const chosen = el.querySelector('[aria-selected="true"]'); const style = getComputedStyle(chosen); const pill = getComputedStyle(el, '::before');
      const rect = chosen.getBoundingClientRect();
      return { selected: chosen.textContent, foreground: style.color, selectedBackground: pill.backgroundColor, surroundingBackground: getComputedStyle(el).backgroundColor, focusVisible: chosen.matches(':focus-visible'), outline: { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, offset: style.outlineOffset }, pillDeltaX: el.getBoundingClientRect().left + parseFloat(pill.left) + new DOMMatrixReadOnly(pill.transform).m41 - rect.left, pillDeltaWidth: parseFloat(pill.width) - rect.width };
    });
    tour.textContrast = contrast(tour.foreground, tour.selectedBackground);
    tour.focusContrast = contrast(tour.outline.color, tour.surroundingBackground);
    assert.ok(tour.focusVisible && parseFloat(tour.outline.width) >= 2 && tour.outline.style !== 'none');
    assert.ok(tour.textContrast >= 4.5 && tour.focusContrast >= 3);
    assert.ok(Math.abs(tour.pillDeltaX) < 1 && Math.abs(tour.pillDeltaWidth) < 1);
    await page.locator('#producto').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/design/evidence/contrast-focus-tour-${theme}-${width}.png` });
    const choice = width === 390 ? page.getByLabel('Explorá una especialidad') : page.getByRole('button', { name: 'Cardiología', exact: true });
    await choice.focus();
    if (width === 390) { await choice.selectOption('cardiologia'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); }
    else await page.keyboard.press('Enter');
    await expect(choice).toBeFocused();
    await expect(page.getByRole('region', { name: 'Ficha de ejemplo de Cardiología', exact: true })).toBeVisible();
    const specialty = await choice.evaluate(el => { const style = getComputedStyle(el); return { foreground: style.color, focusVisible: el.matches(':focus-visible'), outline: { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }, selected: el.tagName === 'SELECT' ? el.value : el.closest('[data-selected]').dataset.selected }; });
    assert.ok(specialty.focusVisible && parseFloat(specialty.outline.width) >= 2 && specialty.outline.style !== 'none');
    const metric = await page.locator('.fx-specialty-record-content[data-visible="true"] .fx-specialty-metric > span').first().evaluate(el => ({ label: el.textContent, foreground: getComputedStyle(el).color, background: getComputedStyle(el.parentElement).backgroundColor, fontSize: getComputedStyle(el).fontSize }));
    metric.ratio = contrast(metric.foreground, metric.background);
    assert.ok(metric.ratio >= 4.5);
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/design/evidence/contrast-focus-specialty-${theme}-${width}.png` });
    assert.deepEqual(errors, []);
    const sample = { theme, width, themeSource: 'persisted user preference restored by TweaksProvider', tour, specialty, metric, errors };
    report.states.push(sample); console.log(JSON.stringify(sample));
    await context.close();
  }
} finally { await browser.close(); fs.writeFileSync('docs/design/evidence/cross-contrast-after.json', JSON.stringify(report, null, 2) + '\n'); }
console.log(`${report.states.length} focused theme/width states passed.`);
