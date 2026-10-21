import { createSandbox } from './backend.ts';

function shimBuffer() {
  const g = globalThis as { Buffer?: unknown };
  if (g.Buffer) return;
  g.Buffer = {
    isBuffer: (x: unknown) => x instanceof Uint8Array,
    from: (x: string | Uint8Array, enc?: string) => {
      if (typeof x !== 'string') return Uint8Array.from(x);
      if (enc === 'base64') return Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
      return new TextEncoder().encode(x);
    },
  };
}

export function installSandbox() {
  shimBuffer();
  const sandbox = createSandbox();
  const network = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/sim/')) return network(input, init);
    const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return Response.json({ code: 'invalid_request', message: 'Body must be JSON' }, { status: 400 });
    }
    const r = await sandbox.handle(req.method, url, body, req.headers.get('authorization'));
    return r.body === undefined ? new Response(null, { status: r.status }) : Response.json(r.body, { status: r.status });
  };
}
