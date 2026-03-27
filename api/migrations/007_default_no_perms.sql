-- +goose Up
ALTER TABLE users
  ALTER COLUMN can_create_portfolio SET DEFAULT FALSE,
  ALTER COLUMN can_publish_portfolio SET DEFAULT FALSE;

-- +goose Down
ALTER TABLE users
  ALTER COLUMN can_create_portfolio SET DEFAULT TRUE,
  ALTER COLUMN can_publish_portfolio SET DEFAULT TRUE;
