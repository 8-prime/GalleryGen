# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend
RUN corepack enable
WORKDIR /build
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM rust:1.96-bookworm AS builder
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/templates ./templates
COPY api/migrations /build/api/migrations
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/backend/target/release/gallerygen-backend /usr/local/bin/gallerygen-backend
COPY --from=frontend /build/dist /app/frontend
ENV FRONTEND_PATH=/app/frontend STORAGE_PATH=/data/images IMAGE_CACHE_PATH=/data/cache PORT=8080
EXPOSE 8080
ENTRYPOINT ["gallerygen-backend"]
