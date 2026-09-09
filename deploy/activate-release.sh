#!/usr/bin/env bash

set -euo pipefail
umask 027

readonly EXPECTED_DEPLOY_PATH="/var/www/ww/user-dashboard"
readonly SERVICE_NAME="user-dashboard.service"
readonly ENVIRONMENT_FILE="/var/www/ww/user-dashboard/shared/app.env"

fail() {
  printf 'release activation failed: %s\n' "$*" >&2
  exit 1
}

if [[ "$#" -ne 2 ]]; then
  fail 'usage: activate-release.sh DEPLOY_PATH RELEASE_ID'
fi

deploy_path="$1"
release_id="$2"

[[ "$deploy_path" == "$EXPECTED_DEPLOY_PATH" ]] || fail 'unexpected deployment path'
[[ "$release_id" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || fail 'invalid release identifier'

release_root="$deploy_path/releases"
incoming_root="$deploy_path/incoming"
artifact="$incoming_root/user-dashboard-$release_id.tar.gz"
invoked_script="$(readlink -f "${BASH_SOURCE[0]}")"
staging_dir="$release_root/.$release_id.staging"
release_dir="$release_root/$release_id"
current_link="$deploy_path/current"
next_link="$deploy_path/.current-$release_id"

[[ -d "$release_root" && ! -L "$release_root" ]] || fail 'release directory is missing or unsafe'
[[ -d "$incoming_root" && ! -L "$incoming_root" ]] || fail 'incoming directory is missing or unsafe'
[[ -f "$artifact" && ! -L "$artifact" ]] || fail 'release artifact is missing or unsafe'
[[ "$invoked_script" == "$incoming_root/activate-$release_id.sh" ]] || fail 'activation script was invoked from an unexpected path'
[[ ! -e "$staging_dir" && ! -e "$release_dir" && ! -e "$next_link" ]] || fail 'release identifier already exists'
[[ -f "$ENVIRONMENT_FILE" && ! -L "$ENVIRONMENT_FILE" ]] || fail 'server environment file is missing or unsafe'

environment_file_metadata="$(stat -c '%U:%G:%a' "$ENVIRONMENT_FILE")"
[[ "$environment_file_metadata" == 'root:deploy:640' ]] \
  || fail 'server environment file must be owned root:deploy with mode 0640'

cleanup_staging() {
  if [[ -d "$staging_dir" && "$staging_dir" == "$release_root/."*.staging ]]; then
    rm -rf -- "$staging_dir"
  fi
  if [[ -L "$next_link" ]]; then
    rm -f -- "$next_link"
  fi
}
trap cleanup_staging EXIT

while IFS= read -r entry; do
  case "$entry" in
    /*|..|../*|*/../*|*/..)
      fail "archive contains an unsafe path: $entry"
      ;;
  esac
done < <(tar -tzf "$artifact")

install -d -m 0750 "$staging_dir"
tar -xzf "$artifact" -C "$staging_dir" --no-same-owner --no-same-permissions

[[ -d "$staging_dir/client/dist" && ! -L "$staging_dir/client/dist" ]] || fail 'client output directory is absent or unsafe'
[[ -d "$staging_dir/server/dist" && ! -L "$staging_dir/server/dist" ]] || fail 'server output directory is absent or unsafe'
[[ -f "$staging_dir/client/dist/index.html" && ! -L "$staging_dir/client/dist/index.html" ]] || fail 'web entrypoint is absent or unsafe'
[[ -f "$staging_dir/server/dist/index.js" && ! -L "$staging_dir/server/dist/index.js" ]] || fail 'server entrypoint is absent or unsafe'
[[ -f "$staging_dir/server/sql/001_init.sql" && ! -L "$staging_dir/server/sql/001_init.sql" ]] || fail 'database schema is absent or unsafe'
[[ -d "$staging_dir/shared/dist" && ! -L "$staging_dir/shared/dist" ]] || fail 'shared output directory is absent or unsafe'
[[ -d "$staging_dir/node_modules" && ! -L "$staging_dir/node_modules" ]] || fail 'production dependencies are absent or unsafe'
[[ -f "$staging_dir/package.json" && ! -L "$staging_dir/package.json" ]] || fail 'package manifest is absent or unsafe'
[[ -f "$staging_dir/package-lock.json" && ! -L "$staging_dir/package-lock.json" ]] || fail 'lockfile is absent or unsafe'

node_major="$(/usr/bin/node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == '22' ]] || fail 'Node.js 22 is required on ECS'
/usr/bin/node --check "$staging_dir/server/dist/index.js"
mv -- "$staging_dir" "$release_dir"

previous_release=''
if [[ -e "$current_link" || -L "$current_link" ]]; then
  [[ -L "$current_link" ]] || fail 'current is not a symbolic link'
  previous_release="$(readlink -f "$current_link")"
  [[ "$previous_release" == "$release_root/"* && -d "$previous_release" ]] \
    || fail 'current points outside the release root'
fi

set -a
# shellcheck disable=SC1091
source "$ENVIRONMENT_FILE"
set +a
[[ "${NODE_ENV:-}" == 'production' ]] || fail 'NODE_ENV must be production'
[[ "${PORT:-}" == '3100' ]] || fail 'PORT must be 3100'
[[ "${DB_NAME:-}" == 'user_dashboard' ]] || fail 'DB_NAME must be user_dashboard'
[[ -n "${DB_PASSWORD:-}" && "${DB_PASSWORD:-}" != 'CHANGE_ME_DB_PASSWORD' ]] \
  || fail 'DB_PASSWORD is not configured'

(
  cd "$release_dir"
  /usr/bin/node server/dist/migrate.js
)

ln -s "$release_dir" "$next_link"
mv -Tf -- "$next_link" "$current_link"

healthy=false
if sudo -n /usr/bin/systemctl restart "$SERVICE_NAME"; then
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if /usr/bin/node --input-type=module --eval '
      const response = await fetch("http://127.0.0.1:3100/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: process.env.ADMIN_INITIAL_USERNAME,
          password: process.env.ADMIN_INITIAL_PASSWORD
        })
      });
      const body = await response.json();
      if (body?.code !== 0 || typeof body?.data?.token !== "string") process.exit(1);
      await fetch("http://127.0.0.1:3100/api/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${body.data.token}` }
      });
    ' >/dev/null 2>&1; then
      healthy=true
      break
    fi
    sleep 2
  done
fi

if [[ "$healthy" != 'true' ]]; then
  printf 'new release %s did not become healthy\n' "$release_id" >&2
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -s "$previous_release" "$next_link"
    mv -Tf -- "$next_link" "$current_link"
    sudo -n /usr/bin/systemctl restart "$SERVICE_NAME" || true
  fi
  fail 'new release was not activated'
fi

for candidate in "$release_root"/*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  candidate_name="$(basename "$candidate")"
  [[ "$candidate_name" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || continue
  if [[ "$candidate" != "$release_dir" && "$candidate" != "$previous_release" ]]; then
    rm -rf -- "$candidate"
  fi
done

rm -f -- "$artifact" "$invoked_script"
trap - EXIT
printf 'release %s is active and healthy\n' "$release_id"
