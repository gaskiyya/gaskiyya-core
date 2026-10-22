# Deployment

The registry server runs as a Docker container on one AWS EC2 instance, behind Caddy for HTTPS. Every push to `main` is checked and deployed by [.github/workflows/ci-deploy.yml](../.github/workflows/ci-deploy.yml).

## What runs where

| Piece | Where |
|---|---|
| Server | EC2 `t4g.small` (Ubuntu 24.04, Arm) in `eu-north-1`, Elastic IP `16.192.138.140` |
| Public URL | `https://16-192-138-140.sslip.io` (swap for a real domain by editing `/opt/gaskiyya/Caddyfile` and restarting `caddy`) |
| Containers | `app` (image `gaskiyya:<commit>`, built on the instance from the root `Dockerfile`) and `caddy` (ports 80 and 443), on the Docker network `gaskiyya` |
| Configuration | `/opt/gaskiyya/prod.env` on the instance (mode 600, never in git), see [CONFIGURATION.md](CONFIGURATION.md) |
| Code checkout | `/opt/gaskiyya/repo`, fetched with a read-only GitHub deploy key |
| Data | Firestore in Google Cloud project `gaskiyya-io-server`, through the `gaskiyya-server@` service account (Firestore read and write only) |

The server is a demo deployment: `SIM_ENABLED=true` and `SIM_DEMO_LOGIN=true`, so `/console/` and phone demo login work and DemoBank, Road Safety and the tax office are enrolled ([decision 0003](decisions/0003-demo-identity.md)). `NODE_ENV=demo` overrides the image's `production` so the simulated SIM swap and demo reset are allowed. A pilot needs its own instance with `NODE_ENV=production` and the simulator off.

## How a deploy works

1. **Check:** typecheck, ESLint and Vitest. The translation coverage test runs too but does not block a deploy.
2. **Deploy:** on `main` only. GitHub signs in to AWS with OIDC (no stored AWS keys) and sends an SSM command to the instance. The instance checks out the commit and runs [scripts/server-deploy.sh](../scripts/server-deploy.sh): it builds the image, swaps the container, waits for `/health`, and rolls back to the previous image if the new one does not come up.
3. **Smoke test:** [scripts/smoke.ts](../scripts/smoke.ts) exercises the live server the way the mobile app, the console and the admin dashboard do.

Run the smoke test against any server yourself with `pnpm smoke <url>` (set `SMOKE_ADMIN_USER` and `SMOKE_ADMIN_PASSWORD` to include the admin API).

## Repository settings the workflow reads

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_REGION` | `eu-north-1` |
| Variable | `AWS_INSTANCE_ID` | the EC2 instance ID |
| Variable | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account>:role/gaskiyya-github-deploy` |
| Variable | `DEPLOY_URL` | the public URL |
| Secret | `SMOKE_ADMIN_USER`, `SMOKE_ADMIN_PASSWORD` | an admin login for the smoke test |
| Secret | `AGENT_JOB_TOKEN` | the same value as in `prod.env` |

## One-time AWS setup

- The instance has the instance profile `gaskiyya-server` with the managed policy `AmazonSSMManagedInstanceCore`, so it accepts SSM commands. SSH stays limited to the owner's IP.
- IAM has the OIDC provider `token.actions.githubusercontent.com` and the role `gaskiyya-github-deploy`, which only `repo:gaskiyya/gaskiyya-core:environment:production` can assume. It may `ssm:SendCommand` with `AWS-RunShellScript` on this instance and read the command's result, nothing else.

## Manual operations

On the instance (`ssh ubuntu@16.192.138.140`):

```bash
docker logs --tail 100 app                     # server log
docker image ls gaskiyya                       # the last three builds
cd /opt/gaskiyya/repo && scripts/server-deploy.sh "$(git rev-parse HEAD)"   # redeploy the checked-out commit
```

To change a setting, edit `/opt/gaskiyya/prod.env` and redeploy (or recreate `app` with the same `docker run` as in `server-deploy.sh`).
