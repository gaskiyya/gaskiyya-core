#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(here, '../assets/3d');
mkdirSync(out, { recursive: true });

const types = { '.js': 'text/javascript', '.html': 'text/html', '.mjs': 'text/javascript' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file;
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">import { render } from '/scenes.js'; window.renderScene = render; window.ready = true;</script></body></html>`);
  }
  if (url.pathname.startsWith('/three/')) file = join(root, 'node_modules', url.pathname);
  else file = join(here, url.pathname);
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.ready === true);

const all = ['logo', 'logo_dark', 'app_tile', 'shield', 'message', 'call', 'lock', 'link', 'verdict_confirmed', 'verdict_not_confirmed', 'verdict_cannot_check'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const name of names) {
  const shadow = true;
  const dataUrl = await page.evaluate(([n, s]) => window.renderScene(n, 1024, s), [name, shadow]);
  writeFileSync(join(out, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`rendered ${name}.png`);
}
await browser.close();
server.close();
