-- +goose Up
CREATE TABLE image_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  UNIQUE (user_id, name)
);
ALTER TABLE images ADD COLUMN folder_id uuid REFERENCES image_folders(id) ON DELETE SET NULL;
CREATE INDEX images_user_folder ON images(user_id, folder_id);
-- +goose Down
ALTER TABLE images DROP COLUMN folder_id;
DROP TABLE image_folders;
