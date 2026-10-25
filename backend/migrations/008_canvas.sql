-- +goose Up
ALTER TABLE grid_items
  ADD COLUMN canvas_x double precision,
  ADD COLUMN canvas_y double precision,
  ADD COLUMN canvas_width double precision,
  ADD COLUMN canvas_height double precision,
  ADD COLUMN image_fit text NOT NULL DEFAULT 'cover' CHECK (image_fit IN ('cover','contain')),
  ADD COLUMN position_x double precision NOT NULL DEFAULT 50 CHECK (position_x BETWEEN 0 AND 100),
  ADD COLUMN position_y double precision NOT NULL DEFAULT 50 CHECK (position_y BETWEEN 0 AND 100),
  ADD CONSTRAINT canvas_frame_complete CHECK (
    (canvas_x IS NULL AND canvas_y IS NULL AND canvas_width IS NULL AND canvas_height IS NULL)
    OR (canvas_x IS NOT NULL AND canvas_y IS NOT NULL AND canvas_width IS NOT NULL AND canvas_height IS NOT NULL
      AND canvas_x >= 0 AND canvas_y >= 0 AND canvas_width >= 20 AND canvas_height >= 20
      AND canvas_x + canvas_width <= 1200 AND canvas_y + canvas_height <= 100000));
-- +goose Down
ALTER TABLE grid_items DROP CONSTRAINT canvas_frame_complete,
  DROP COLUMN canvas_x, DROP COLUMN canvas_y, DROP COLUMN canvas_width, DROP COLUMN canvas_height,
  DROP COLUMN image_fit, DROP COLUMN position_x, DROP COLUMN position_y;
