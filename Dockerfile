# Image production cho dilim-agent. Bun chạy thẳng TypeScript → không có bước build,
# chỉ cần deps production + source.

FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app
# Chỉ copy manifest → layer cache deps không vỡ khi source đổi.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.11-alpine AS runtime
# tini: PID 1 tử tế, forward SIGTERM tới bun (index.ts nghe SIGTERM để shutdown sạch).
RUN apk add --no-cache tini
WORKDIR /app

ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

# Agent sandbox file/shell vào CONFIG.workdir (= cwd = /app) → user `bun` phải sở hữu.
RUN chown -R bun:bun /app
USER bun

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
