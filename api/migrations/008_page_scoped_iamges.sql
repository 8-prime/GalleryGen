-- +goose Up
ALTER TABLE images ADD COLUMN page_id UUID REFERENCES pages(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE images DROP COLUMN page_id;
