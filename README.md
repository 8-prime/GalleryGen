# GalleryGen

Portfolio manager with a React editor, Rust backend, PostgreSQL, and imgproxy.
The default Docker stack serves the frontend, API, public portfolios, and cached
image transformations through a single application port.
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

For updates, keep the existing Compose project name and `.env`:

```sh
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose logs --tail=100 api
curl -f http://localhost:9081/health
```

Existing database and image volumes are reused. The Rust deployment has been
confirmed working on the owner's remote instance. Local tests cover routing,
rendering, signing and caching; database integration tests require an isolated
PostgreSQL instance. See [backend notes](docs/rust-migration.md) for details.
