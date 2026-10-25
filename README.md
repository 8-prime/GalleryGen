# GalleryGen

Portfolio manager with a React editor, Rust backend, PostgreSQL, and imgproxy.
The default Docker stack serves the frontend, API, public portfolios, and cached
image transformations through a single application port. nginx is not required.
The public landing page at `/` is embedded in the Rust binary, including its
photographs and styles. The editor remains under `/app/`.

## Deployment

Configure `.env` from `.env.example`, then run:

```sh
docker compose up -d --build
```

The application is available on port 9081. Point your existing Caddy reverse proxy
at that port. Set `GALLERYGEN_BIND_ADDRESS=127.0.0.1` if only Caddy on the same host
needs access; the default preserves the previous deployment's network binding.
Remove any old Caddy `handle /` static-file block to let Rust serve the landing page:

```caddyfile
photo-mat.com, www.photo-mat.com {
    import access_logging
    reverse_proxy localhost:9081
}
```

For the first switch from Go/nginx, build the new image, then stop the old stack
before starting Rust:

```sh
docker compose build api
docker compose -f docker-compose.go.yml down
docker compose up -d --remove-orphans
docker compose logs --tail=100 api
curl -f http://localhost:9081/health
```

Keep the existing Compose project name and `.env`. These commands reuse existing
database and image volumes. The legacy Go stack is in `docker-compose.go.yml`.

The Rust stack is being validated on the owner's remote instance. Local tests
pass; a full container build and live database/image-processing checks remain
pending. See [migration notes](docs/rust-migration.md) for status and rollback.
