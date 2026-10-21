FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/agent/package.json packages/agent/

COPY packages/canonical/package.json packages/canonical/
COPY packages/licences/package.json packages/licences/
COPY packages/schemas/package.json packages/schemas/
COPY packages/test-vectors/package.json packages/test-vectors/
RUN pnpm install --frozen-lockfile
COPY . .
FROM deps AS web
RUN pnpm build:ui

FROM deps AS api
RUN pnpm --filter=@gaskiya/api deploy --prod --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=api --chown=node:node /out ./
COPY --from=web --chown=node:node /repo/dist/site ./web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]
