# Rust backend notes

## Status

The Rust deployment is the only supported stack. The owner confirmed it working
on their remote instance, including image processing. Image proxying currently
feels slower; performance investigation remains separate work.

The former backend, generated query code, deployment files and reverse-proxy
container have been removed. SQL migrations now live in backend/migrations and
are embedded directly into the Rust binary. Their contents and versions are
unchanged. The existing goose_db_version table and SQL markers are retained as a
database compatibility format, not a runtime dependency. Do not reset the ledger:
existing deployments use it to avoid reapplying schema changes.

Implemented features include authentication/admin permissions, image uploads and
storage, portfolio/page/placement APIs, public JSON and HTML, the public landing
page, and signed image processing through internal imgproxy with a disk cache.

## Development and verification

Run from backend/:

    cargo test
    cargo clippy --all-targets -- -D warnings

Proxy tests bind a temporary localhost server. DATABASE_URL and JWT_SECRET are
required for application startup. FRONTEND_PATH defaults to ../web/dist relative
to the working directory; export environment variables before cargo run.

The database integration test requires an EMPTY disposable PostgreSQL database:

    GALLERYGEN_TEST_DATABASE_URL=postgres://... cargo test --test database -- --ignored

The test leaves fixtures behind; discard the test database afterward. It checks
initial schema creation, repeat startup, preservation of existing records and
permissions, and refusal to run against a newer schema. This environment has no
Docker daemon or PostgreSQL binaries, so that test remains unrun locally. The
remote deployment is user-verified, rather than an automated integration result.

Authentication retains existing token claims/lifetimes, bcrypt cost 12, default
permissions, and admin bootstrap without resetting existing passwords. Access and
refresh tokens currently have no type distinction. OAuth endpoints return 501;
storage is local. These behaviors can be revisited independently.

## Image processing and cache

Browser-facing image URLs use /img signed paths. Every request verifies its
signature before accessing the cache, including after key rotation. Unsigned query
strings are rejected. Requests forward Accept, whose complete value participates
in the SHA-256 cache key. Responses include Vary: Accept, ETag when available, and
X-Cache-Status (MISS/HIT/STALE).

IMAGE_CACHE_PATH defaults to ./data/cache. IMAGE_CACHE_MAX_BYTES defaults to
10 GiB; zero disables storage. Entries expire after 30 days, with stale fallback
for transport/server failures only. Writes use temporary files and atomic renames;
oldest writes are evicted to stay within the disk limit. Bounded striped locks
coalesce simultaneous requests for a variant. Processing is limited to eight
concurrent upstream requests, 120 seconds each, and 32 MiB per output. Originals
stream directly from disk without a duplicate cache copy.

Original storage keys are immutable. Deleting an image removes the database record
and original file, but cached derivatives may remain accessible during the 30-day
cache lifetime. Stale derivatives can be served beyond that lifetime during an
upstream outage; a successful upstream 404 does not serve stale content. One Rust
process should own a cache directory.

## Deployment

The default docker-compose.yml runs PostgreSQL, imgproxy, and the combined
Rust/frontend application. Port 9081 is configurable through GALLERYGEN_HTTP_PORT.
GALLERYGEN_BIND_ADDRESS defaults to 0.0.0.0; use 127.0.0.1 for host-local Caddy.
Keep the existing Compose project name, .env, JWT secret and imgproxy signing keys.
Compose sets container storage, cache and frontend paths explicitly.

    docker compose up -d --build --remove-orphans

Caddy proxies all requests to the application; see README.md and
docs/Caddyfile.example. No separate static web root is needed. The public landing
page and all its assets are embedded from backend/static/landing and served at /.
The editor remains under /app/. The landing page follows the original cream/coral
direction and advertises implemented features only. Browser visual QA was not
available in the development session; route and asset checks pass.

## Canvas and library work

The canvas editor and library improvements are implemented on feature/canvas-editor.
See docs/canvas-editor.md for behavior, migrations 008/009 and verification status.
Automatic layout remains future work.
