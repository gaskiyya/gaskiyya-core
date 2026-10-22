#!/usr/bin/env bash
# Sets one variable in /opt/gaskiyya/prod.env, replacing any earlier value. The value arrives base64-encoded so it
# survives the SSM command line. Run with sudo on the server: scripts/server-env.sh NAME <base64 value>
set -euo pipefail

name=${1:?usage: scripts/server-env.sh NAME BASE64_VALUE}
value=$(printf '%s' "${2:?usage: scripts/server-env.sh NAME BASE64_VALUE}" | base64 -d)
env_file=${GASKIYA_ENV_FILE:-/opt/gaskiyya/prod.env}

[[ $name =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "bad variable name: $name" >&2; exit 1; }
[[ $value != *$'\n'* ]] || { echo "$name must be one line" >&2; exit 1; }
tmp=$(mktemp)
grep -v "^${name}=" "$env_file" > "$tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$tmp"
# cat keeps the file's owner and permissions.
cat "$tmp" > "$env_file"
rm -f "$tmp"
echo "Set $name in $env_file"
