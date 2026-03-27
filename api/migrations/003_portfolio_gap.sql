-- +goose Up
ALTER TABLE portfolios ADD COLUMN gap_px INT NOT NULL DEFAULT 4;

-- +goose Down
ALTER TABLE portfolios DROP COLUMN gap_px;
