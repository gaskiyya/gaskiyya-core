import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerWeb } from '../packages/api/src/web.ts';
import { harness } from './helpers.ts';
const PASSWORD = 'test-admin-password-not-real';
const ASSET = 'assets/index-AbCd1234.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gk-web-'));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  put('site/index.html', '<!doctype html><title>Landing</title>');
  put('site/banks.html', '<!doctype html><title>For banks</title>');
  put(`site/${ASSET}`, 'console.log("site")');
  put('site/console/index.html', '<!doctype html><title>Sandbox console</title>');
  put('console/index.html', '<!doctype html><title>Live console</title>');
  put('admin/index.html', '<!doctype html><title>Dashboard</title>');
  put(`admin/${ASSET}`, 'console.log("dashboard")');
  put('admin-login/index.html', '<!doctype html><title>Sign in</title>');
  put(`admin-login/${ASSET}`, 'console.log("login")');
  return dir;
}

async function setup({ admin = true, console: live = false } = {}) {
  let served = { site: false, console: false, admin: false };
  const h = await harness({
    ...(admin ? { admin: { password: PASSWORD } } : {}),
    beforeReady: async (sys) => (served = await registerWeb(sys.app, { dir: fixture(), console: live, admin: sys.adminAuth ?? null })),
  });
  const get = (url: string, headers: Record<string, string> = {}) => h.sys.app.inject({ method: 'GET', url, headers });
  return { h, served, get };
}

async function signIn(h: Awaited<ReturnType<typeof setup>>['h']) {
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: PASSWORD } });
  expect(r.statusCode).toBe(200);
  const setCookie = String(r.headers['set-cookie']);
  return { setCookie, cookie: setCookie.split(';')[0]! };
}

describe('static web UIs', () => {
  it('WEB-1: the landing page and the API reference are served at / and /banks.html, with cache headers', async () => {
    const { get, served } = await setup();
    expect(served).toEqual({ site: true, console: false, admin: true });
    const home = await get('/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Landing');
    expect(home.headers['content-type']).toMatch(/text\/html/);
    expect(home.headers['cache-control']).toBe('no-cache');
    const banks = await get('/banks.html');
    expect(banks.statusCode).toBe(200);
    expect(banks.body).toContain('For banks');
    const asset = await get(`/${ASSET}`);
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await get('/nothing-here.html')).statusCode).toBe(404);
  });

  it('WEB-2: static routes never shadow the API', async () => {
    const { get, h } = await setup();
    const health = await get('/health');
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-type']).toMatch(/application\/json/);
    const unknown = await get('/v1/nope');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('not_found');
    expect((await get('/v1/banks')).statusCode).toBe(200);
    expect((await h.sys.app.inject({ method: 'POST', url: '/webhooks/ussd', payload: {} })).headers['content-type']).toMatch(/application\/json/);
    expect((await get('/v1/admin/session')).statusCode).toBe(401);
  });

  it('WEB-3: without an admin session /admin/ redirects to the sign-in page and dashboard files answer 401', async () => {
    const { get } = await setup();
    for (const url of ['/admin', '/admin/', '/admin/index.html']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location).toMatch(/^\/admin\/(login)?$/);
    }
    expect((await get('/admin/')).headers.location).toBe('/admin/login');
    const asset = await get(`/admin/${ASSET}`);
    expect(asset.statusCode).toBe(401);
    expect(asset.body).not.toContain('dashboard');
    const forged = await get(`/admin/${ASSET}`, { cookie: 'gaskiyya_admin=gsa_forged' });
    expect(forged.statusCode).toBe(401);
    const login = await get('/admin/login');
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('Sign in');
    expect(login.body).not.toContain('Dashboard');
    expect((await get(`/admin/login/${ASSET}`)).statusCode).toBe(200);
  });

  it('WEB-4: sign-in sets an HttpOnly, SameSite=Strict session cookie that opens the dashboard', async () => {
    const { h, get } = await setup();
    const { setCookie, cookie } = await signIn(h);
    expect(setCookie).toMatch(/^gaskiyya_admin=gsa_/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure');
    const page = await get('/admin/', { cookie });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Dashboard');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect((await get(`/admin/${ASSET}`, { cookie })).statusCode).toBe(200);
    const session = await get('/v1/admin/session', { cookie });
    expect(session.statusCode).toBe(200);
    expect(session.json().username).toBe('admin');
  });

  it('WEB-5: a cookie-authenticated change needs the X-Gaskiya-Admin header; logout clears the cookie', async () => {
    const { h, get } = await setup();
    const { cookie } = await signIn(h);
    const post = (headers: Record<string, string>) => h.sys.app.inject({ method: 'POST', url: '/v1/admin/session/logout', headers });
    const csrf = await post({ cookie });
    expect(csrf.statusCode).toBe(403);
    expect(csrf.json().code).toBe('csrf');
    expect((await get('/admin/', { cookie })).statusCode).toBe(200);
    const out = await post({ cookie, 'x-gaskiya-admin': '1' });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/^gaskiyya_admin=;.*Max-Age=0/);
    expect((await get('/admin/', { cookie })).statusCode).toBe(302);
    const stale = await get('/v1/admin/session', { cookie });
    expect(stale.statusCode).toBe(401);
    expect(String(stale.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('WEB-6: the session cookie is Secure in production', async () => {
    const h = await harness({ admin: { password: PASSWORD, production: true } });
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: PASSWORD } });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toContain('; Secure');
  });

  it('WEB-7: with the admin dashboard off, every /admin path is 404', async () => {
    const { get, served } = await setup({ admin: false });
    expect(served.admin).toBe(false);
    for (const url of ['/admin', '/admin/', '/admin/login', `/admin/${ASSET}`, `/admin/login/${ASSET}`]) expect((await get(url)).statusCode, url).toBe(404);
  });

  it('WEB-8: /console/ is the live console only when the simulator is on; otherwise the in-browser sandbox', async () => {
    const off = await setup();
    expect((await off.get('/console/')).body).toContain('Sandbox console');
    const on = await setup({ console: true });
    expect(on.served.console).toBe(true);
    expect((await on.get('/console/')).body).toContain('Live console');
    expect((await on.get('/console')).headers.location).toBe('/console/');
  });
});
