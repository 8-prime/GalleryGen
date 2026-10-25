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
- [x] Combined frontend/Rust Dockerfile, default Compose stack without nginx, Caddy example (container build unverified).
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
- The legacy Go/nginx stack is retained in docker-compose.go.yml as a fallback.

## Current status and continuation

Work is on feature/rust-backend and pushed to origin at working checkpoints.
The default Compose stack now runs the Rust backend and frontend without nginx.
The owner chose to validate it on their existing single-user remote deployment and
accepts possible data loss. Image and portfolio routes are ported; live API/database
checks remain pending.
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

## Default deployment

The default docker-compose.yml defines Postgres, imgproxy, and the combined
Rust/frontend image. It publishes port 9081, preserving the previous nginx entry
point. GALLERYGEN_BIND_ADDRESS defaults to 0.0.0.0 to preserve existing connectivity;
set it to 127.0.0.1 if central Caddy runs on the same host. GALLERYGEN_HTTP_PORT
can override 9081. See docs/Caddyfile.example for host-based Caddy. Containerized
Caddy can use the host port or a shared network and the api service address.

On the existing remote checkout, keep the same directory/Compose project name,
.env, JWT secret, imgproxy signing keys, and existing named volumes. Then:

    git fetch origin
    git switch feature/rust-backend
    git pull --ff-only
    docker compose build api
    docker compose -f docker-compose.go.yml down
    docker compose up -d --remove-orphans
    docker compose logs --tail=100 api
    curl -f http://localhost:9081/health

Build first so the old application stays available while compiling. The explicit
legacy down step stops both nginx and Go before Rust starts and frees port 9081.
Do not pass -v: existing database/original volumes are reused. Deployments that
already use -p must keep passing their existing project name on all commands.
The user chose the remote deployment as the integration test environment.

The central Caddy upstream can stay on port 9081. Keep IMGPROXY_ENABLED=true with
valid hex signing keys to use resizing. Compose explicitly sets storage, cache and
frontend paths inside the container.

To return to Go/nginx:

    docker compose down
    docker compose -f docker-compose.go.yml up -d --build --remove-orphans

No schema changes beyond the original seven migrations are introduced by this
port. The old docker-compose.rust.yml has been replaced by the default stack.

Current validation includes Rust unit/router tests, localhost mock-upstream cache
tests, Clippy, and Compose structural validation (--no-env-resolution
--no-interpolate). Live Postgres, real imgproxy and Docker image builds remain
unverified because this environment has no Docker daemon or PostgreSQL binaries.

## Public landing page

Rust now serves a new Photo Mat landing page at `/`, replacing the login redirect.
The page follows the existing site's cream/coral direction and describes implemented
features only. It links to sign-in/registration and explains the early-access
permissions. Its illustrative photo gallery supports local category filtering.
HTML, CSS, JavaScript, favicon and sample photographs are embedded in the binary
from backend/static/landing; Docker includes those sources during compilation.
The old public logo.png and preview.png references returned 404, so they are not reused.

Remove the old Caddy `handle /` static-root block and proxy all requests to port
9081 to use the new landing page. README.md includes the full site block.
Landing route/asset tests, HTML asset/anchor checks and JavaScript syntax checks
pass. Browser visual QA was unavailable: the enabled CUA runtime reported no surfaces.
