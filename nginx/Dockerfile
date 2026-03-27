# syntax=docker/dockerfile:1

# ── Stage 1: build the React SPA ─────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

RUN corepack enable

WORKDIR /build

# Copy manifests first for layer cache — pnpm install is skipped on rebuilds
# where only source files changed
COPY web/package.json web/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY web/ .

RUN pnpm build

# ── Stage 2: nginx serving the built SPA ─────────────────────────────────────
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=frontend-builder /build/dist /usr/share/nginx/html/app

EXPOSE 80
