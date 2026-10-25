# Rust backend migration

## Agreed scope

Replace the maintained Go backend with Rust. Preserve the existing frontend API,
database contents, image files, portfolio URLs, bcrypt passwords, and HS256 tokens.
Keep imgproxy as an internal image processing service. Remove nginx when Rust has
replaced its frontend serving, routing, upload limits/timeouts, and image caching.
The external deployment remains central Caddy → Rust → internal services.

Canvas editing and library improvements follow the compatibility migration:
free image placement, optional snapping, no automatic displacement, per-placement
fit/crop settings, separate mobile reading order, folders/search, and a large
multi-select library dialog. Do not introduce these schema changes during the port.

## Implementation checklist

- [x] Axum server foundation, tracing, shutdown, health, frontend serving under /app.
- [x] Port imgproxy signed path generation with an independent compatibility vector.
- [x] PostgreSQL integration and Goose history support implemented (live database verification pending).
- [x] Authentication, admin bootstrap, permissions and admin routes implemented (live verification pending).
- [x] Image upload/list/delete, protected originals and public media implemented.
- [x] Portfolio/page/image-placement endpoints, including legacy main-page routes implemented.
- [x] Public JSON and escaped server-rendered portfolio HTML implemented.
- [x] Internal imgproxy proxy and bounded persistent disk cache implemented: atomic writes,
      concurrent miss coalescing, output format-aware keys, upstream timeouts,
      bounded responses, eviction, and defined deletion/versioning behavior.
- [ ] Frontend/API compatibility checks against an isolated PostgreSQL database.
- [x] Combined frontend/Rust Dockerfile, opt-in Compose stack without nginx, Caddy example (container build unverified).
- [ ] Verify uploads, existing users/data, public pages and cached images end to end.

## Compatibility details discovered

- Existing migrations are Goose SQL files 001–007 in api/migrations. Reuse their
  applied-version history; do not run SQLx migrations blindly over existing tables.
  Test both empty databases and existing version-7 databases.
- OAuth endpoints currently return 501; S3 configuration exists but storage is local.
- nginx caches /media and /img for 30 days with a shared 10 GB disk limit and stale
  responses on upstream failure. It allows 100 MB uploads and 120-second API timeouts.
- /img strips its prefix before forwarding to imgproxy; signed paths must survive
  forwarding unchanged. imgproxy reads the shared originals volume read-only.
- Keep the existing Go/Compose deployment available until compatibility checks pass.

## Current status and continuation

Work is on feature/rust-backend and pushed to origin at working checkpoints.
The backend/ crate is not a deployable replacement. Compose still runs the original
stack. Image and portfolio routes are ported; live API/database checks remain pending.
Next run live database/API and container compatibility checks. Database startup applies
the original SQL using the Goose ledger, transactionally and with a Rust startup
advisory lock. Stop the Go backend before migrating; its lock differs.

Authentication preserves the existing token claim shape and lifetimes, bcrypt cost
12, default permissions, admin bootstrap without resetting existing passwords, and
OAuth 501 stubs. Legacy access/refresh tokens have no type distinction; this behavior
is preserved for compatibility and should be revisited separately.

Run commands from backend/: cargo test; cargo clippy --all-targets -- -D warnings.
FRONTEND_PATH defaults to ../web/dist relative to the working directory. DATABASE_URL
and JWT_SECRET are required. Export environment variables before cargo run.

Live database tests are pending: Docker is installed but its daemon/socket is absent.
Use an EMPTY disposable PostgreSQL database and run:
GALLERYGEN_TEST_DATABASE_URL=postgres://... cargo test --test database -- --ignored
The test leaves fixtures behind; discard the database afterward. Also verify startup
against a database actually created by Go/Goose before deployment.

Image originals stream from disk. Uploads accept the existing multipart file field
with a 100 MB request limit, extract JPEG/PNG/GIF dimensions, and remove orphaned
files on failed inserts. Browser URLs use /img signed paths rather than the internal
imgproxy hostname. Placement create/update responses include actual metadata and
working URLs, fixing the old /img/{UUID} placeholder response. Reordering is atomic;
lazy main-page creation locks the portfolio row to avoid duplicate main pages.
Public HTML retains the existing CSS/navigation using an autoescaped MiniJinja
template and also handles portfolios without any pages.

## Image proxy and cache

The /img route forwards only correctly signed paths to the configured internal
imgproxy origin. Signatures are checked before cache hits, including after key
rotation. Query strings are rejected; transformation options are signed in the path.
Requests forward Accept; the complete Accept value is part of the SHA-256 cache key.
Responses carry Vary: Accept, ETag when provided, and X-Cache-Status (MISS/HIT/STALE).

IMAGE_CACHE_PATH defaults to ./data/cache; IMAGE_CACHE_MAX_BYTES defaults to 10 GiB
(zero disables storage). Entries expire after 30 days, with stale fallback for
upstream transport/server failures only. Writes use temporary files and atomic
renames; oldest writes are evicted to stay under the disk limit. Requests for the
same variant coalesce using bounded striped locks. Upstream processing is limited
to eight concurrent requests, 120 seconds each, and 32 MiB per output. Original
files already live on disk and are streamed without making a second cached copy.

Original storage keys are immutable. Deleting an original removes its database
entry and file, but previously cached derivatives can remain accessible for the
30-day cache lifetime, as with the old nginx setup. A cached stale derivative can
be served beyond that lifetime during upstream outages; a successful upstream 404
does not serve stale content. One Rust process should own a cache directory.

## Deployment preview (not yet validated with Docker)

The default docker-compose.yml continues to run Go/nginx. The opt-in
docker-compose.rust.yml defines Postgres, imgproxy, and the combined Rust/frontend
image, with the application bound to 127.0.0.1:9081. The existing central Caddy can
proxy to that address; see docs/Caddyfile.example. For Caddy in a container use a
shared Docker network and the api service address instead.

Before switching: back up the database and originals; verify the Rust image and
API against copies. Use the SAME Compose project name to retain the postgres_data
and images_data volumes. Stop the old stack without deleting volumes:

    docker compose -p gallerygen -f docker-compose.yml down
    docker compose -p gallerygen -f docker-compose.rust.yml up -d --build

Substitute the deployment's existing project name for gallerygen. Keep the existing
.env and set IMGPROXY_ENABLED=true with valid hex signing keys to use resizing.
Rust Compose explicitly sets storage, cache and frontend paths inside the container.
Rollback uses the inverse commands, again without deleting volumes. No schema
changes beyond the original seven migrations are introduced by this port.

Current validation includes Rust unit/router tests, localhost mock-upstream cache
tests, Clippy, and Compose structural validation (--no-env-resolution
--no-interpolate). Live Postgres, real imgproxy and Docker image builds remain
unverified because this environment has no Docker daemon or PostgreSQL binaries.
