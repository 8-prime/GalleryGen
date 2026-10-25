-- +goose Up
ALTER TABLE grid_items ADD COLUMN row_break_before BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE grid_items DROP COLUMN row_break_before;
