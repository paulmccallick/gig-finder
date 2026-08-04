#!/bin/sh
set -eu

image_name=${GIG_FINDER_IMAGE:-ghcr.io/paulmccallick/gig-finder}
container_name=${GIG_FINDER_CONTAINER_NAME:-gig-finder}
production_root=${GIG_FINDER_PRODUCTION_ROOT:-}
codex_home=${GIG_FINDER_CODEX_HOME:-}
docker_bin=${DOCKER_BIN:-docker}
curl_bin=${CURL_BIN:-curl}
sleep_bin=${SLEEP_BIN:-sleep}
tag=${1:-}

fail() {
  echo "Deployment failed: $*" >&2
  exit 1
}

if ! printf '%s\n' "${tag}" | grep -Eq '^sha-[0-9a-fA-F]{40}$'; then
  fail "provide an immutable image tag in the form sha-<40-character-commit-sha>"
fi
case "${production_root}" in
  /*) ;;
  *) fail "GIG_FINDER_PRODUCTION_ROOT must be an absolute path" ;;
esac
case "${codex_home}" in
  /*) ;;
  *) fail "GIG_FINDER_CODEX_HOME must be an absolute path" ;;
esac
[ -d "${production_root}" ] || fail "production root does not exist: ${production_root}"
[ -d "${codex_home}" ] || fail "Codex credential directory does not exist: ${codex_home}"
production_root=$(CDPATH= cd -- "${production_root}" && pwd -P)
codex_home=$(CDPATH= cd -- "${codex_home}" && pwd -P)
[ -f "${production_root}/data/gig-finder.sqlite" ] \
  || fail "production database does not exist; run bin/bootstrap-production.sh first"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
case "${production_root}/" in
  "${repo_root}/"*) fail "production root must be outside the repository" ;;
esac

"${docker_bin}" info >/dev/null 2>&1 || fail "Docker is unavailable; start OrbStack"

image="${image_name}:${tag}"
revision=${tag#sha-}
echo "Pulling ${image}..."
"${docker_bin}" pull "${image}"
image_digest=$("${docker_bin}" image inspect --format '{{index .RepoDigests 0}}' "${image}")

old_exists=false
old_running=false
old_image=""
if "${docker_bin}" container inspect "${container_name}" >/dev/null 2>&1; then
  old_exists=true
  old_image=$("${docker_bin}" container inspect --format '{{.Config.Image}}' "${container_name}")
  if [ "$("${docker_bin}" container inspect --format '{{.State.Running}}' "${container_name}")" = "true" ]; then
    old_running=true
  fi
fi

maintenance() {
  "${docker_bin}" run --rm \
    -e GIG_FINDER_CONTEXT_ROOT=/var/lib/gig-finder \
    -v "${production_root}:/var/lib/gig-finder" \
    "${image}" bun dist/server/maintenance.js "$@"
}

echo "Creating verified production backup..."
backup_output=$(maintenance backup)
echo "${backup_output}"
backup_path=$(printf '%s\n' "${backup_output}" \
  | sed -n 's/.*"path":"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "${backup_path}" ] || fail "maintenance backup did not report a backup path"

if [ "${old_running}" = true ]; then
  "${docker_bin}" stop "${container_name}" >/dev/null
fi

if ! maintenance migrate || ! maintenance validate; then
  echo "Migration or validation failed; restoring ${backup_path}..." >&2
  if maintenance restore "${backup_path}"; then
    if [ "${old_running}" = true ]; then
      "${docker_bin}" start "${container_name}" >/dev/null
    fi
    fail "migration or validation failed; database and prior container restored"
  fi
  fail "migration or validation failed and automatic database restore failed; prior container remains stopped, backup: ${backup_path}"
fi

previous_name="${container_name}-previous-$(date -u +%Y%m%dT%H%M%SZ)"
if [ "${old_exists}" = true ]; then
  "${docker_bin}" rename "${container_name}" "${previous_name}"
fi

rollback() {
  echo "New container failed health verification; restoring ${backup_path}..." >&2
  "${docker_bin}" rm -f "${container_name}" >/dev/null 2>&1 || true
  if ! maintenance restore "${backup_path}"; then
    echo "Automatic database restore failed. The prior container remains ${previous_name}." >&2
    echo "Use the retained backup before restarting it: ${backup_path}" >&2
    return 1
  fi
  if [ "${old_exists}" = true ]; then
    "${docker_bin}" rename "${previous_name}" "${container_name}"
    if [ "${old_running}" = true ]; then
      "${docker_bin}" start "${container_name}" >/dev/null
    fi
  fi
  return 0
}

if ! new_container_id=$("${docker_bin}" run --detach \
  --name "${container_name}" \
  --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -e GIG_FINDER_CONTEXT_ROOT=/var/lib/gig-finder \
  -e CODEX_HOME=/run/codex \
  -v "${production_root}:/var/lib/gig-finder" \
  -v "${codex_home}:/run/codex:ro" \
  "${image}"); then
  rollback || true
  fail "container replacement failed"
fi

healthy=false
attempt=1
while [ "${attempt}" -le 30 ]; do
  if health=$(${curl_bin} --fail --silent http://127.0.0.1:3001/healthz 2>/dev/null) \
    && printf '%s\n' "${health}" | grep -q "\"revision\":\"${revision}\""; then
    healthy=true
    break
  fi
  "${sleep_bin}" 1
  attempt=$((attempt + 1))
done

if [ "${healthy}" != true ]; then
  "${docker_bin}" logs "${container_name}" >&2 || true
  rollback || true
  fail "new container did not become healthy"
fi

if [ "${old_exists}" = true ]; then
  "${docker_bin}" rm "${previous_name}" >/dev/null
fi

echo "Deployment complete"
echo "image=${image}"
echo "digest=${image_digest}"
echo "container=${new_container_id}"
echo "backup=${backup_path}"
echo "health=${health}"
[ -z "${old_image}" ] || echo "previous_image=${old_image}"
