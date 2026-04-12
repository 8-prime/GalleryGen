-- +goose Up
ALTER TABLE images ADD COLUMN page_id REFERENCES pages(id) ON DELETE CASCASE;

-- +goose Down
ALTER TABLE images DROP COLUMN page_id;
