#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
image_name=${GIG_FINDER_IMAGE:-ghcr.io/paulmccallick/gig-finder}
container_name=${GIG_FINDER_CONTAINER_NAME:-gig-finder}
source_root=${GIG_FINDER_SOURCE_CONTEXT_ROOT:-"${repo_root}/context"}
state_root=${GIG_FINDER_PRODUCTION_ROOT:-/var/lib/gig-finder}
log_root=${GIG_FINDER_LOG_ROOT:-/var/log/gig-finder}
backup_root=${GIG_FINDER_BACKUP_ROOT:-/var/backups/gig-finder}
config_file=${GIG_FINDER_CONFIG:-/etc/gig-finder/config.json}
codex_home=${GIG_FINDER_CODEX_HOME:-}
sync_bin=${GIG_FINDER_SYNC_BIN:-"${repo_root}/bin/sync-production-inputs"}
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
case "${state_root}" in
  /*) ;;
  *) fail "GIG_FINDER_PRODUCTION_ROOT must be an absolute path" ;;
esac
case "${log_root}" in
  /*) ;;
  *) fail "GIG_FINDER_LOG_ROOT must be an absolute path" ;;
esac
case "${backup_root}" in
  /*) ;;
  *) fail "GIG_FINDER_BACKUP_ROOT must be an absolute path" ;;
esac
case "${config_file}" in
  /*) ;;
  *) fail "GIG_FINDER_CONFIG must be an absolute path" ;;
esac
case "${codex_home}" in
  /*) ;;
  *) fail "GIG_FINDER_CODEX_HOME must be an absolute path" ;;
esac
[ -d "${source_root}" ] || fail "source context does not exist: ${source_root}"
[ -d "${state_root}" ] || fail "production state root does not exist: ${state_root}"
[ -d "${state_root}/data" ] || fail "production data root does not exist: ${state_root}/data"
[ -d "${log_root}" ] || fail "production log root does not exist: ${log_root}"
[ -d "${backup_root}" ] || fail "production backup root does not exist: ${backup_root}"
[ -d "$(dirname -- "${config_file}")" ] || fail "production configuration root does not exist"
[ -d "${codex_home}" ] || fail "Codex credential directory does not exist: ${codex_home}"
source_root=$(CDPATH= cd -- "${source_root}" && pwd -P)
state_root=$(CDPATH= cd -- "${state_root}" && pwd -P)
artifact_root="${state_root}/artifacts"
log_root=$(CDPATH= cd -- "${log_root}" && pwd -P)
backup_root=$(CDPATH= cd -- "${backup_root}" && pwd -P)
config_root=$(CDPATH= cd -- "$(dirname -- "${config_file}")" && pwd -P)
config_file="${config_root}/$(basename "${config_file}")"
codex_home=$(CDPATH= cd -- "${codex_home}" && pwd -P)

require_disjoint_from_artifacts() {
  candidate=$1
  label=$2
  [ "${candidate}" != / ] || fail "${label} must not contain the runtime artifact root"
  case "${candidate}" in
    "${artifact_root}"|"${artifact_root}"/*)
      fail "${label} must not be inside the runtime artifact root"
      ;;
  esac
  case "${artifact_root}" in
    "${candidate}"/*)
      fail "${label} must not contain the runtime artifact root"
      ;;
  esac
}

require_disjoint_from_artifacts "${source_root}" "source context root"
require_disjoint_from_artifacts "${log_root}" "production log root"
require_disjoint_from_artifacts "${backup_root}" "production backup root"
require_disjoint_from_artifacts "${config_file}" "production configuration file"
require_disjoint_from_artifacts "${codex_home}" "Codex credential directory"

[ -f "${state_root}/data/gig-finder.sqlite" ] \
  || fail "production database does not exist; run bin/bootstrap-production.sh first"
[ -x "${sync_bin}" ] || fail "production input synchronizer is unavailable: ${sync_bin}"

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
    -e GIG_FINDER_CONFIG=/etc/gig-finder/config.json \
    -e LOG_DIRECTORY=/var/log/gig-finder \
    -e GIG_FINDER_BACKUP_ROOT=/var/backups/gig-finder \
    -v "${state_root}/data:/var/lib/gig-finder/data" \
    -v "${log_root}:/var/log/gig-finder" \
    -v "${backup_root}:/var/backups/gig-finder" \
    -v "${config_file}:/etc/gig-finder/config.json:ro" \
    "${image}" bun dist/server/maintenance.js "$@"
}

if [ "${old_running}" = true ]; then
  "${docker_bin}" stop "${container_name}" >/dev/null
fi

echo "Creating verified production database backup..."
if ! maintenance validate; then
  if [ "${old_running}" = true ]; then "${docker_bin}" start "${container_name}" >/dev/null; fi
  fail "pre-deployment database validation failed"
fi
if ! backup_output=$(maintenance backup); then
  if [ "${old_running}" = true ]; then "${docker_bin}" start "${container_name}" >/dev/null; fi
  fail "production database backup failed"
fi
echo "${backup_output}"
backup_path=$(printf '%s\n' "${backup_output}" \
  | sed -n 's/.*"path":"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "${backup_path}" ] || fail "maintenance backup did not report a backup path"

echo "Synchronizing source-managed production inputs..."
input_manifest="${state_root}/data/deployment-inputs-${revision}-$$.json"
rollback_inputs() {
  [ ! -f "${input_manifest}" ] \
    || "${sync_bin}" --rollback "${input_manifest}" "${source_root}" "${state_root}" "${config_file}"
}
if ! sync_output=$("${sync_bin}" "${source_root}" "${state_root}" "${config_file}" "${input_manifest}"); then
  if ! rollback_inputs; then
    fail "source-managed input synchronization and rollback failed; prior container remains stopped: ${input_manifest}"
  fi
  if [ "${old_running}" = true ]; then "${docker_bin}" start "${container_name}" >/dev/null; fi
  fail "source-managed input synchronization failed"
fi
echo "${sync_output}"
if [ ! -f "${config_file}" ]; then
  rollback_inputs || fail "configuration validation and source-input rollback failed; prior container remains stopped: ${input_manifest}"
  if [ "${old_running}" = true ]; then "${docker_bin}" start "${container_name}" >/dev/null; fi
  fail "production configuration was not created"
fi
if ! maintenance validate; then
  rollback_inputs || fail "integrity validation and source-input rollback failed; prior container remains stopped: ${input_manifest}"
  if [ "${old_running}" = true ]; then "${docker_bin}" start "${container_name}" >/dev/null; fi
  fail "source synchronization introduced an integrity regression"
fi

if ! maintenance migrate || ! maintenance validate; then
  echo "Migration or validation failed; restoring ${backup_path}..." >&2
  if maintenance restore "${backup_path}"; then
    "${sync_bin}" --rollback "${input_manifest}" "${source_root}" "${state_root}" "${config_file}" || fail "production state restored but source-input rollback failed: ${input_manifest}"
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
  if ! "${sync_bin}" --rollback "${input_manifest}" "${source_root}" "${state_root}" "${config_file}"; then
    echo "Source-input rollback failed; recovery manifest retained: ${input_manifest}" >&2
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
  -e GIG_FINDER_CONFIG=/etc/gig-finder/config.json \
  -e LOG_DIRECTORY=/var/log/gig-finder \
  -e GIG_FINDER_BACKUP_ROOT=/var/backups/gig-finder \
  -e CODEX_HOME=/run/codex \
  -v "${state_root}:/var/lib/gig-finder" \
  --mount "type=bind,source=${artifact_root},target=/var/lib/gig-finder/artifacts" \
  -v "${log_root}:/var/log/gig-finder" \
  -v "${backup_root}:/var/backups/gig-finder" \
  -v "${config_file}:/etc/gig-finder/config.json:ro" \
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

if ! maintenance validate; then
  rollback || true
  fail "post-cutover database validation failed"
fi

"${sync_bin}" --finalize "${input_manifest}" "${source_root}" "${state_root}" "${config_file}"

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
