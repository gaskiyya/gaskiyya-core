# gaskiyya-web

Gaskiyya's web UIs: the landing page and bank guide (`site/`), the bank sandbox console and phone emulator (`console/`), the admin dashboard (`admin/`) and the docs (`docs/`). Shared code lives in `packages/`.

Needs Node 22 and pnpm.

```sh
pnpm install
pnpm dev            # site on :5175
pnpm dev:sandbox    # console running the api in the browser, on :5173
pnpm dev:console    # console against the api on :8080
pnpm dev:admin      # admin dashboard on :5172
pnpm build          # typecheck, then build every UI into dist/
```
