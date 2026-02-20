# Dockerfile for the local control plane (Node.js + better-sqlite3).
# Uses bookworm-slim (not Alpine) because better-sqlite3 needs glibc for native compilation.
# Build context: repository root (needs packages/shared/).

FROM node:22-bookworm-slim

# Install build tools for native modules (better-sqlite3 uses node-gyp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files (npm ci needs them to match the lockfile)
COPY packages/control-plane/package.json packages/control-plane/package.json
COPY packages/github-bot/package.json packages/github-bot/package.json
COPY packages/linear-bot/package.json packages/linear-bot/package.json
COPY packages/local-control-plane/package.json packages/local-control-plane/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/slack-bot/package.json packages/slack-bot/package.json
COPY packages/web/package.json packages/web/package.json

RUN npm ci

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/local-control-plane/ packages/local-control-plane/

# Build shared (control plane imports from it)
RUN npm run build --workspace=packages/shared

# Data directory for SQLite (mount as volume)
RUN mkdir -p /data

ENV DATA_DIR=/data

EXPOSE 8787

CMD ["npx", "tsx", "packages/local-control-plane/src/index.ts"]
