# Deployment

The registry server runs as a Docker container on one AWS EC2 instance, behind Caddy for HTTPS. Every push to `main` is checked and deployed by [.github/workflows/ci-deploy.yml](../.github/workflows/ci-deploy.yml).

## What runs where

| Piece | Where |
|---|---|
| Server | EC2 `t4g.small` (Ubuntu 24.04, Arm) in `eu-north-1`, Elastic IP `16.192.138.140` |
| Public URL | `https://16-192-138-140.sslip.io` (swap for a real domain by editing `/opt/gaskiyya/Caddyfile` and restarting `caddy`) |
| Containers | `app` (image `gaskiyya:<commit>`, built on the instance from the root `Dockerfile`) and `caddy` (ports 80 and 443), on the Docker network `gaskiyya` |
| Configuration | `/opt/gaskiyya/prod.env` on the instance (mode 600, never in git), see [CONFIGURATION.md](CONFIGURATION.md) |
| Code checkout | `/opt/gaskiyya/repo`; each deploy fetches with the workflow's own read-only token, which expires when the job ends, so the server holds no GitHub credential |
| Data | Firestore in Google Cloud project `gaskiyya-io-server`, through the `gaskiyya-server@` service account (Firestore read and write only) |

The server is a demo deployment: `SIM_ENABLED=true` and `SIM_DEMO_LOGIN=true`, so `/console/` and phone demo login work and DemoBank, Road Safety and the tax office are enrolled ([decision 0003](decisions/0003-demo-identity.md)). `NODE_ENV=demo` overrides the image's `production` so the simulated SIM swap and demo reset are allowed. A pilot needs its own instance with `NODE_ENV=production` and the simulator off.

## How a deploy works

1. **Check:** typecheck, ESLint and Vitest. The translation coverage test runs too but does not block a deploy.
2. **Deploy:** on `main` only. GitHub signs in to AWS as the `gaskiyya-github-deploy` IAM user and sends an SSM command to the instance. The instance checks out the commit and runs [scripts/server-deploy.sh](../scripts/server-deploy.sh): it builds the image, swaps the container, waits for `/health`, and rolls back to the previous image if the new one does not come up.
3. **Smoke test:** [scripts/smoke.ts](../scripts/smoke.ts) exercises the live server the way the mobile app, the console and the admin dashboard do.

Run the smoke test against any server yourself with `pnpm smoke <url>` (set `SMOKE_ADMIN_USER` and `SMOKE_ADMIN_PASSWORD` to include the admin API).

## Repository settings the workflow reads

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_REGION` | `eu-north-1` |
| Variable | `AWS_INSTANCE_ID` | the EC2 instance ID |
| Variable | `DEPLOY_URL` | the public URL |
| Secret | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the access key of the `gaskiyya-github-deploy` IAM user |
| Secret | `SMOKE_ADMIN_USER`, `SMOKE_ADMIN_PASSWORD` | an admin login for the smoke test |
| Secret | `AGENT_JOB_TOKEN` | the same value as in `prod.env` |
| Environment secret (`production`) | `MONGODB_URI` | the database connection string; the deploy writes it and `STORE=mongo` into `prod.env` |
| Environment secret (`production`) | `FCM_SERVICE_ACCOUNT_JSON` | the Firebase service account JSON of the project the app is built with; without it the server sends no push notifications |
| Environment secret (`production`) | `APNS_KEY_P8` | the APNs `.p8` key, for iPhone call ringing (optional) |
| Environment variable (`production`) | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` | the rest of the APNs settings (optional) |

The deploy job writes each of the last four rows into `prod.env` with [scripts/server-env.sh](../scripts/server-env.sh) before the swap. One left unset keeps whatever `prod.env` already has. The smoke test reports whether push and iPhone call ringing are on, and warns when they are off.

## One-time AWS setup

- The instance has the instance profile `gaskiyya-server` with the managed policy `AmazonSSMManagedInstanceCore`, so it accepts SSM commands. SSH stays limited to the owner's IP.
- The IAM user `gaskiyya-github-deploy` may `ssm:SendCommand` with `AWS-RunShellScript` only on instances tagged `Name=gaskiyya-server`, and read the command's result; nothing else. (GitHub OIDC would avoid a stored key, but the AWS Free plan's organisation policy denies `iam:CreateOpenIDConnectProvider`. Switch to OIDC after upgrading the account.) Rotate its key in IAM and update the two repository secrets.
- The repo was first copied to `/opt/gaskiyya/repo` from a `git bundle`, with `origin` set to the GitHub URL.

## Manual operations

On the instance (`ssh ubuntu@16.192.138.140`):

```bash
docker logs --tail 100 app                     # server log
docker image ls gaskiyya                       # the last three builds
cd /opt/gaskiyya/repo && scripts/server-deploy.sh "$(git rev-parse HEAD)"   # redeploy the checked-out commit
```

To change a setting, edit `/opt/gaskiyya/prod.env` and redeploy (or recreate `app` with the same `docker run` as in `server-deploy.sh`).
