# CI/CD — dilim-agent

```
PR ──► CI (lint · typecheck · test · docker build) ──► merge main
                                                          │
main ──► Deploy ──► test ──► build & push GHCR ──► deploy VPS (chờ approval)
```

| File | Chạy khi | Làm gì |
|---|---|---|
| `.github/workflows/ci.yml` | mọi PR, push `main` | lint, typecheck, `bun test`, build Dockerfile (không push) |
| `.github/workflows/deploy.yml` | push `main`, chạy tay | test → push image GHCR → deploy production |
| `.github/dependabot.yml` | hằng tuần | bump bun deps + GitHub Actions |
| `scripts/deploy-remote.sh` | chạy trên server, do CI gọi | pull → migrate → thay agent → rollback nếu healthcheck đỏ |

## Cần cấu hình một lần

### 1. Environment `production`

Settings → Environments → New environment → `production`:
- **Required reviewers**: chọn người duyệt deploy.
- **Deployment branches**: chỉ `main`.

Không tạo thì job deploy vẫn chạy, chỉ là không ai duyệt.

### 2. Secrets (trong environment `production`)

| Tên | Nội dung |
|---|---|
| `DEPLOY_HOST` | IP/hostname server prod |
| `DEPLOY_USER` | user SSH (phải ở group `docker`) |
| `DEPLOY_SSH_KEY` | private key OpenSSH (ed25519, **không passphrase**) |
| `DEPLOY_SSH_KNOWN_HOSTS` | output của `ssh-keyscan <host>` |

### 3. Variables

`DEPLOY_PATH` = `/opt/dilim-agent`

### 4. Server

```bash
sudo mkdir -p /opt/dilim-agent && sudo chown "$USER" /opt/dilim-agent
cd /opt/dilim-agent
cp <đường-dẫn>/.env.prod.example .env.prod && chmod 600 .env.prod && vi .env.prod
```

`.env.prod` **không** do CI đẩy lên — secret nằm trên server. Compose, migrations và
deploy script thì CI tự đẩy mỗi lần deploy, server không cần clone git.

Deploy key:

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions-deploy"
cat deploy_key.pub >> ~/.ssh/authorized_keys   # trên server
cat deploy_key                                  # → secret DEPLOY_SSH_KEY, rồi xoá file
```

### 5. Branch protection (khuyến nghị)

Settings → Rules → Ruleset cho `main`: require PR + require status check `lint · typecheck · test · build`.

## Migration

`deploy-remote.sh` chạy lại **toàn bộ** `migrations/*.sql` mỗi lần deploy, theo thứ tự tên file.
Nên mọi migration phải idempotent (`CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS`). Không có bảng theo dõi version.

## Rollback

Tự động khi container mới không đạt healthcheck. Thủ công:

```bash
cd /opt/dilim-agent
AGENT_IMAGE_REF=ghcr.io/dili-group/open-dilim@sha256:<digest-cũ> \
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build --wait agent
```

Digest cũ xem ở Packages → `open-dilim`, hoặc `docker images --digests` trên server.
Migration **không** tự rollback — schema đi lùi phải viết migration mới.

## Ghi chú

- Image tag: `<commit-sha>` và `latest`. Deploy pin theo **digest**, không theo tag.
- `Dockerfile` chạy `apk upgrade --no-cache`: base `oven/bun:*-alpine` chậm hơn Alpine vài
  ngày về bản vá OS (lúc dựng CI có 2 CVE CRITICAL openssl đã có fix).
- Deploy lại đúng commit hiện tại: Actions → Deploy → Run workflow.
