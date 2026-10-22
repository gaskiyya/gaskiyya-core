import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const at = (p: string) => resolve(here, p);
const API = 'http://localhost:8080';
// Where the in-browser demo sends registered banks to sign in.
const REGISTRY_CONSOLE_URL = JSON.stringify(process.env.REGISTRY_CONSOLE_URL || 'https://16-192-138-140.sslip.io/console/');

const inlineDiagrams: Plugin = {
  name: 'inline-diagrams',
  transformIndexHtml(html: string) {
    return html.replace(/<!-- diagram:([a-z-]+) -->/g, (_m: string, name: string) =>
      readFileSync(at(`docs/diagrams/${name}.svg`), 'utf8').replace(/<style>[\s\S]*?<\/style>/, ''),
    );
  },
};

// One build per UI: vite build --mode site | sandbox | console | admin | admin-login.
const apps: Record<string, UserConfig> = {
  site: {
    root: at('site'),
    base: './',
    plugins: [inlineDiagrams],
    server: { port: 5175 },
    build: {
      outDir: at('dist/site'),
      assetsInlineLimit: 0,
      rollupOptions: { input: { main: at('site/index.html'), banks: at('site/banks.html') } },
    },
  },
  sandbox: {
    root: at('console'),
    base: './',
    plugins: [react()],
    define: { __SANDBOX__: 'true', __REGISTRY_CONSOLE_URL__: REGISTRY_CONSOLE_URL },
    resolve: { alias: { 'node:crypto': at('console/src/sandbox/node-crypto.ts'), 'node:events': at('console/src/sandbox/node-events.ts') } },
    server: { port: 5173 },
    build: { outDir: at('dist/site/console') },
  },
  console: {
    root: at('console'),
    base: '/console/',
    plugins: [react()],
    define: { __SANDBOX__: 'false', __REGISTRY_CONSOLE_URL__: REGISTRY_CONSOLE_URL },
    server: { port: 5171, proxy: { '/sim': API, '/v1': API } },
    build: { outDir: at('dist/console') },
  },
  admin: {
    root: at('admin/dashboard'),
    publicDir: at('admin/public'),
    base: '/admin/',
    plugins: [react()],
    server: { port: 5172, proxy: { '/v1': API, '/admin/login': API } },
    build: { outDir: at('dist/admin') },
  },
  'admin-login': {
    root: at('admin/login'),
    publicDir: at('admin/public'),
    base: '/admin/login/',
    server: { port: 5174, proxy: { '/v1': API } },
    build: { outDir: at('dist/admin-login') },
  },
};

export default defineConfig(({ mode }) => {
  const app = apps[mode];
  if (!app) throw new Error(`Unknown mode "${mode}": use one of ${Object.keys(apps).join(', ')}`);
  return { ...app, build: { emptyOutDir: true, ...app.build } };
});
