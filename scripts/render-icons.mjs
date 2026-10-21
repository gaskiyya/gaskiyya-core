#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const jobs = [
  ['brand/gaskiya-app-icon-fullbleed.svg', 'mobile/assets/icon/app_icon.png'],
  ['brand/gaskiya-app-icon-foreground.svg', 'mobile/assets/icon/app_icon_foreground.png'],
  ['brand/gaskiya-logo.svg', 'mobile/assets/icon/logo.png'],
];
mkdirSync('mobile/assets/icon', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [src, out] of jobs) {
  const svg = readFileSync(src, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/width="\d+" height="\d+"/, 'width="1024" height="1024"');
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: out, omitBackground: true });
  console.log(`rendered ${out}`);
}
await browser.close();
