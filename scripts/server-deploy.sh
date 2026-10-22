#!/usr/bin/env bash
# Builds the checked-out commit on the registry server and swaps it in, rolling back if it does not come up healthy.
# Run from the repo checkout on the server (the CI deploy job does this through AWS SSM): scripts/server-deploy.sh <commit>
# Expects the `gaskiyya` Docker network, the Caddy container and /opt/gaskiyya/prod.env set up as in docs/DEPLOYMENT.md.
set -euo pipefail

sha=${1:?usage: scripts/server-deploy.sh <commit>}
tag="gaskiyya:${sha:0:12}"
env_file=/opt/gaskiyya/prod.env

run() {
  docker rm -f app >/dev/null 2>&1 || true
  docker run -d --name app --network gaskiyya --restart unless-stopped --env-file "$env_file" --memory 1200m "$1" >/dev/null
}

healthy() {
  for _ in $(seq 1 45); do
    sleep 2
    docker exec app node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null && return 0
  done
  return 1
}

echo "Building $tag"
docker build --quiet --tag "$tag" . >/dev/null

previous=$(docker inspect --format '{{.Config.Image}}' app 2>/dev/null || true)
echo "Starting $tag (was ${previous:-nothing})"
run "$tag"

if healthy; then
  docker tag "$tag" gaskiyya:latest
  # Keep the three newest builds for manual rollback; drop older ones and dangling layers.
  docker image ls gaskiyya --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' | grep -v ':latest$' | sort -r | tail -n +4 | cut -f2 | xargs -r docker rmi >/dev/null 2>&1 || true
  docker image prune --force >/dev/null
  echo "Deployed $tag"
else
  echo "$tag did not become healthy. Last log lines:"
  docker logs --tail 40 app 2>&1 || true
  if [ -n "$previous" ]; then
    echo "Rolling back to $previous"
    run "$previous"
    healthy && echo "Rolled back to $previous" || echo "Rollback is not healthy either"
  fi
  exit 1
fi
