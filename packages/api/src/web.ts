import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminToken, type AdminAuth } from './admin/session.ts';

export const WEB_DIST = fileURLToPath(new URL('../../../dist', import.meta.url));

export interface WebOptions {
  dir?: string;
  console: boolean;
  admin: AdminAuth | null;
}

const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

function cacheHeaders(reply: FastifyReply, path: string) {
  if (HASHED.test(path)) reply.header('cache-control', 'public, max-age=31536000, immutable');
  else if (path.endsWith('.html')) reply.header('cache-control', 'no-cache');
  else reply.header('cache-control', 'public, max-age=3600');
}

const base = { cacheControl: false, setHeaders: cacheHeaders, index: ['index.html'], wildcard: true };

export async function registerWeb(app: FastifyInstance, o: WebOptions) {
  const dir = o.dir ?? WEB_DIST;
  const has = (name: string) => existsSync(join(dir, name, 'index.html'));
  const served = { site: has('site'), console: o.console && has('console'), admin: Boolean(o.admin?.enabled) && has('admin') && has('admin-login') };

  if (served.site) {
    await app.register(async (scope) => {
      await scope.register(fastifyStatic, { ...base, root: join(dir, 'site'), prefix: '/' });
    });
  }

  if (served.console) {
    await app.register(async (scope) => {
      await scope.register(fastifyStatic, { ...base, root: join(dir, 'console'), prefix: '/console/' });
    });
  }
  if (served.console || (served.site && has('site/console'))) app.get('/console', (_req, reply) => reply.redirect('/console/'));

  if (served.admin && o.admin) {
    const auth = o.admin;
    await app.register(async (scope) => {
      await scope.register(fastifyStatic, { ...base, root: join(dir, 'admin-login'), prefix: '/admin/login/' });
      scope.get('/admin/login', (_req, reply) => reply.sendFile('index.html'));
    });
    await app.register(async (scope) => {
      scope.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        const t = adminToken(req.headers);
        try {
          if (t && (await auth.checkToken(t.token))) return;
        } catch (err) {
          req.log.warn({ err: { message: (err as Error).message } }, 'admin page: store unreachable');
          return reply.code(503).send({ code: 'unavailable', message: 'The registry store is unreachable' });
        }
        const path = req.url.split('?')[0] ?? '';
        if (path === '/admin' || path.endsWith('/') || path.endsWith('.html')) return reply.redirect('/admin/login');
        return reply.code(401).send({ code: 'unauthorized', message: 'Admin sign-in required' });
      });
      await scope.register(fastifyStatic, { ...base, root: join(dir, 'admin'), prefix: '/admin/' });
      scope.get('/admin', (_req, reply) => reply.redirect('/admin/'));
    });
  }

  return served;
}
