# Multi-stage Dockerfile for the Next.js web app (standalone output).
# Build context: repository root (needs packages/shared/).

# ── Stage 1: Install dependencies ─────────────────────────────────────────
FROM node:22-alpine AS deps
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

# ── Stage 2: Build ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# npm workspaces hoists deps to root node_modules
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY package.json package-lock.json ./
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

# Build shared first (web depends on it)
RUN npm run build --workspace=packages/shared

# NEXT_PUBLIC_* vars are baked into client JS at build time
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8787
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Remove test config so Next.js doesn't try to typecheck it
RUN rm -f packages/web/vitest.config.ts

RUN npm run build --workspace=packages/web

# ── Stage 3: Runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy standalone output (includes node_modules subset)
COPY --from=builder /app/packages/web/.next/standalone ./
# Copy static assets
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static

EXPOSE 3000

# The standalone server is at packages/web/server.js
CMD ["node", "packages/web/server.js"]
