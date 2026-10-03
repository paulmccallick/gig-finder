#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
source_root=${1:-"${repo_root}/context"}
support_root="${HOME:?HOME must be set}/Library/Application Support/GigFinder"
state_root=${2:-${GIG_FINDER_PRODUCTION_ROOT:-"${support_root}/state"}}
backup_root=${GIG_FINDER_BACKUP_ROOT:-"${support_root}/backups"}
config_file=${GIG_FINDER_CONFIG:-"${support_root}/config.json"}
[ -d "${source_root}" ] || {
  echo "Source context root does not exist: ${source_root}" >&2
  exit 2
}
source_root=$(CDPATH= cd -- "${source_root}" && pwd -P)

exec bun run "${repo_root}/src/operations/bootstrap-context.ts" \
  "${source_root}" "${state_root}" "${backup_root}" "${config_file}"
