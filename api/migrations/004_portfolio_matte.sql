-- +goose Up
ALTER TABLE portfolios ADD COLUMN matte_px INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE portfolios DROP COLUMN matte_px;
