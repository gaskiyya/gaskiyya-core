import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'apps', 'web', 'docs', 'whitepaper');
const pdf = join(dir, 'gaskiyya-whitepaper.pdf');

let html = readFileSync(join(dir, 'whitepaper.html'), 'utf8');
html = html.replace(/<!-- diagram:([a-z-]+) -->/g, (_m, name) => readFileSync(join(root, 'apps', 'web', 'docs', 'diagrams', `${name}.svg`), 'utf8'));
if (/<!-- diagram:/.test(html)) throw new Error('a diagram placeholder was not replaced');
html = html.replace(/<section([^>]*)>([\s\S]*?)<\/section>/g, (_m, attrs, body) => {
  const figures = [];
  const text = body.replace(/<figure class="wide">[\s\S]*?<\/figure>/g, (f) => {
    figures.push(f);
    return '';
  });
  return `<section${attrs}>${text}${figures.join('\n')}</section>`;
});
html = html.replace('<head>', `<head>\n<base href="${pathToFileURL(dir).href}/">`);
const page = join(mkdtempSync(join(tmpdir(), 'gaskiyya-wp-')), 'whitepaper.html');
writeFileSync(page, html);

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath, proxy, args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: Boolean(proxy) });
const tab = await ctx.newPage();
await tab.goto(pathToFileURL(page).href, { waitUntil: 'networkidle' });
await tab.evaluate(() => document.fonts.ready);
const fonts = await tab.evaluate(() => document.fonts.check('600 12px Inter'));
if (!fonts) console.warn('Inter did not load; the PDF uses a fallback font.');
await tab.pdf({
  path: pdf,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();

copyFileSync(pdf, join(root, 'apps', 'web', 'site', 'public', 'gaskiyya-whitepaper.pdf'));
console.log(`wrote ${pdf.replace(root + '/', '')} and copied it to site/public/`);
