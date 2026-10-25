-- +goose Up
ALTER TABLE users
  ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN can_create_portfolio BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN can_publish_portfolio BOOLEAN NOT NULL DEFAULT TRUE;

-- +goose Down
ALTER TABLE users
  DROP COLUMN is_admin,
  DROP COLUMN can_create_portfolio,
  DROP COLUMN can_publish_portfolio;
