import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const at = (p: string) => resolve(here, p);

const inlineDiagrams: Plugin = {
  name: 'inline-diagrams',
  transformIndexHtml(html: string) {
    return html.replace(/<!-- diagram:([a-z-]+) -->/g, (_m: string, name: string) =>
      readFileSync(at(`docs/diagrams/${name}.svg`), 'utf8').replace(/<style>[\s\S]*?<\/style>/, ''),
    );
  },
};

// One build per UI: vite build --mode site.
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
};

export default defineConfig(({ mode }) => {
  const app = apps[mode];
  if (!app) throw new Error(`Unknown mode "${mode}": use one of ${Object.keys(apps).join(', ')}`);
  return { ...app, build: { emptyOutDir: true, ...app.build } };
});
