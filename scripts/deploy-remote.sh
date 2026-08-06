#!/usr/bin/env bash
# deploy-remote.sh — chạy TRÊN server prod, do CI gọi qua SSH:
#   printf '%s\n' "$TOKEN" | GHCR_USER=<user> bash scripts/deploy-remote.sh <image@sha256:...>
#
# Thứ tự cố ý: pull trước (fail sớm, chưa đụng gì đang chạy) → hạ tầng lên → migrate →
# mới thay agent. Agent mới không bao giờ khởi động trên schema cũ.
set -Eeuo pipefail

IMAGE_REF="${1:?thiếu image ref}"
CONTAINER="dilim-agent-prod"

compose() {
  AGENT_IMAGE_REF="${AGENT_IMAGE_REF:-$IMAGE_REF}" \
    docker compose -f docker-compose.prod.yml --env-file .env.prod "$@"
}
log() { printf '[deploy] %s\n' "$*"; }

[[ -f .env.prod ]] || { echo "thiếu .env.prod trong $(pwd)" >&2; exit 1; }

# Token đọc từ stdin, dùng xong logout.
TOKEN="$(head -n 1)"
printf '%s\n' "$TOKEN" | docker login ghcr.io -u "${GHCR_USER:?thiếu GHCR_USER}" --password-stdin
unset TOKEN
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

PREV_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
log "hiện tại: ${PREV_IMAGE:-<chưa có>} → mới: $IMAGE_REF"

compose pull agent
compose up -d --no-build --wait postgres redis

# Mọi migrations/*.sql viết idempotent (IF NOT EXISTS) nên chạy lại mỗi deploy là an toàn.
# ON_ERROR_STOP=1 → lỗi SQL dừng deploy. psql lấy user/db từ env của chính container postgres.
while IFS= read -r sql; do
  log "migrate $sql"
  compose exec -T postgres \
    sh -c 'psql -v ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$sql"
done < <(find migrations -maxdepth 1 -name '*.sql' -type f | sort)

if ! compose up -d --no-build --wait agent; then
  log "agent không healthy → rollback"
  compose logs --tail 50 agent || true
  if [[ -n "$PREV_IMAGE" && "$PREV_IMAGE" != "$IMAGE_REF" ]]; then
    AGENT_IMAGE_REF="$PREV_IMAGE" compose up -d --no-build --wait agent
    log "đã quay lại $PREV_IMAGE"
  fi
  exit 1
fi

log "xong: $IMAGE_REF"
compose ps
