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
- [ ] Internal imgproxy proxy and bounded persistent disk cache: atomic writes,
      concurrent miss coalescing, output format-aware keys, upstream timeouts,
      bounded responses, eviction, and defined deletion/versioning behavior.
- [ ] Frontend/API compatibility checks against an isolated PostgreSQL database.
- [ ] Combined frontend/Rust Docker image; replace nginx in Compose; Caddy example.
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
Next implement the internal image proxy/cache and deployment packaging. Database startup applies
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
