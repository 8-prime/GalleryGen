-- +goose Up
-- Make portfolio slugs globally unique (required for /p/{slug} public URLs)
ALTER TABLE portfolios DROP CONSTRAINT portfolios_user_id_slug_key;
ALTER TABLE portfolios ADD CONSTRAINT portfolios_slug_key UNIQUE (slug);

-- +goose Down
ALTER TABLE portfolios DROP CONSTRAINT portfolios_slug_key;
ALTER TABLE portfolios ADD CONSTRAINT portfolios_user_id_slug_key UNIQUE (user_id, slug);
