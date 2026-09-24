#!/usr/bin/env bash
set -euo pipefail

# Remove leftover Bitcart Docker resources and bind-mounted data.
# Needs a terminal for the sudo password:
#   ./scripts/remove-docker-data.sh
# PROJECT keeps the old compose name so leftover containers are still found.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=n4n1-bitcart

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Re-running with sudo..."
  exec sudo -- "$0" "$@"
fi

if command -v docker >/dev/null 2>&1; then
  docker compose -p "$PROJECT" down --volumes --remove-orphans >/dev/null 2>&1 || true

  mapfile -t containers < <(
    {
      docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"
      docker ps -aq --filter "name=bitcart"
      docker ps -aq --filter "name=$PROJECT"
    } 2>/dev/null | awk 'NF && !seen[$0]++'
  )
  if ((${#containers[@]})); then
    docker rm -f "${containers[@]}"
  fi

  mapfile -t networks < <(
    {
      docker network ls -q --filter "label=com.docker.compose.project=$PROJECT"
      docker network ls --format '{{.ID}} {{.Name}}' | awk -v p="$PROJECT" '$2 ~ p || $2 ~ /bitcart/ { print $1 }'
    } 2>/dev/null | awk 'NF && !seen[$0]++'
  )
  if ((${#networks[@]})); then
    docker network rm "${networks[@]}" || true
  fi

  mapfile -t volumes < <(
    {
      docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT"
      docker volume ls --format '{{.Name}}' | grep -E "^(${PROJECT}|backup_datadir|bitcart)(_|$)" || true
    } 2>/dev/null | awk 'NF && !seen[$0]++'
  )
  if ((${#volumes[@]})); then
    docker volume rm "${volumes[@]}" || true
  fi

  mapfile -t images < <(
    docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
      | awk '/bitcart/ { print $2 }' \
      | awk 'NF && !seen[$0]++'
  )
  if ((${#images[@]})); then
    docker image rm -f "${images[@]}" || true
  fi
else
  echo "docker is not installed; removing local files only."
fi

rm -rf "$ROOT/infra"
echo "Removed Bitcart containers, volumes, images, and $ROOT/infra"
