#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/.." && pwd)
source_root=${1:-"${repo_root}/context"}
production_root=${2:-${GIG_FINDER_PRODUCTION_ROOT:-}}

if [ -z "${production_root}" ]; then
  echo "Usage: bin/bootstrap-production.sh [source-context-root] <production-context-root>" >&2
  echo "Or set GIG_FINDER_PRODUCTION_ROOT." >&2
  exit 2
fi
[ -d "${source_root}" ] || {
  echo "Source context root does not exist: ${source_root}" >&2
  exit 2
}
source_root=$(CDPATH= cd -- "${source_root}" && pwd -P)

exec bun run "${repo_root}/src/entrypoints/bootstrap-production.ts" \
  "${source_root}" "${production_root}"
