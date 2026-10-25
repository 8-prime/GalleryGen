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
- [ ] PostgreSQL integration and existing Goose migration history compatibility.
- [ ] Authentication, admin bootstrap, permissions and admin routes.
- [ ] Image upload/list/delete, protected originals and public media.
- [ ] Portfolio/page/image-placement endpoints, including legacy main-page routes.
- [ ] Public JSON and escaped server-rendered portfolio HTML.
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

The backend/ crate is an initial foundation, not a deployable replacement. Compose
still runs the original stack. Next implement database migration compatibility and
authentication. Run commands from backend/: cargo test, cargo clippy --all-targets
-- -D warnings. FRONTEND_PATH defaults to ../web/dist relative to the working directory.
