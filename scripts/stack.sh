#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

STACKS=(openlist emby qbittorrent gateway watchtower)

run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Run: cp .env.example .env"
    exit 1
  fi
}

ensure_network() {
  local network_name
  network_name="$(awk -F= '/^ARK_NETWORK=/{print $2}' "${ENV_FILE}")"
  network_name="${network_name:-arkmedia-net}"
  if ! run_root docker network inspect "${network_name}" >/dev/null 2>&1; then
    run_root docker network create "${network_name}" >/dev/null
    echo "Created network: ${network_name}"
  fi
}

compose_cmd() {
  local stack="$1"
  shift
  local compose_file="${ROOT_DIR}/${stack}/docker-compose.yml"
  local override_file="${ROOT_DIR}/${stack}/docker-compose.override.yml"
  if [[ -f "${override_file}" ]]; then
    run_root docker compose --env-file "${ENV_FILE}" -f "${compose_file}" -f "${override_file}" "$@"
  else
    run_root docker compose --env-file "${ENV_FILE}" -f "${compose_file}" "$@"
  fi
}

cmd="${1:-}"
target="${2:-all}"

if [[ -z "${cmd}" ]]; then
  echo "Usage: $0 <up|down|restart|pull|ps|logs> [stack|all]"
  exit 1
fi

ensure_env

resolve_targets() {
  local request="$1"
  if [[ "${request}" == "all" ]]; then
    printf '%s\n' "${STACKS[@]}"
    return
  fi
  for s in "${STACKS[@]}"; do
    if [[ "${s}" == "${request}" ]]; then
      echo "${s}"
      return
    fi
  done
  echo "Invalid stack: ${request}" >&2
  exit 1
}

mapfile -t TARGETS < <(resolve_targets "${target}")

case "${cmd}" in
  up)
    ensure_network
    for s in "${TARGETS[@]}"; do
      echo "==> up ${s}"
      compose_cmd "${s}" up -d --build
    done
    ;;
  down)
    for s in "${TARGETS[@]}"; do
      echo "==> down ${s}"
      compose_cmd "${s}" down --remove-orphans
    done
    ;;
  restart)
    for s in "${TARGETS[@]}"; do
      echo "==> restart ${s}"
      compose_cmd "${s}" up -d --force-recreate
    done
    ;;
  pull)
    for s in "${TARGETS[@]}"; do
      echo "==> pull ${s}"
      compose_cmd "${s}" pull
    done
    ;;
  ps)
    for s in "${TARGETS[@]}"; do
      echo "==> ps ${s}"
      compose_cmd "${s}" ps
    done
    ;;
  logs)
    if [[ "${target}" == "all" ]]; then
      echo "logs requires a specific stack"
      echo "Usage: $0 logs <openlist|emby|qbittorrent|gateway|watchtower>"
      exit 1
    fi
    compose_cmd "${target}" logs -f
    ;;
  *)
    echo "Unknown command: ${cmd}"
    echo "Usage: $0 <up|down|restart|pull|ps|logs> [stack|all]"
    exit 1
    ;;
esac
