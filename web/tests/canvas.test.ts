import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bounds,
  clampFrame,
  PAGE_WIDTH,
  snapAxis,
  toCanvas,
} from "../src/lib/canvas.ts";
import type { PortfolioImage } from "../src/lib/portfolios.ts";

function image(
  id: string,
  changes: Partial<PortfolioImage> = {},
): PortfolioImage {
  return {
    id,
    image_id: id,
    sort_order: 0,
    col_span: 1,
    row_span: 1,
    col_start: 1,
    row_start: 1,
    row_break_before: false,
    filename: `${id}.jpg`,
    mime_type: "image/jpeg",
    width: 1200,
    height: 800,
    thumb_url: "/thumb",
    full_url: "/full",
    canvas_x: null,
    canvas_y: null,
    canvas_width: null,
    canvas_height: null,
    image_fit: "cover",
    position_x: 50,
    position_y: 50,
    ...changes,
  };
}
test("legacy layouts get independent frames and retain reading order", () => {
  const frames = toCanvas(
    [
      image("a", { col_span: 2, row_span: 2 }),
      image("b", { sort_order: 1 }),
      image("c", { sort_order: 2 }),
    ],
    12,
  );
  assert.equal(frames[0].canvas_x, 0);
  assert.equal(frames[1].canvas_x + frames[1].canvas_width, PAGE_WIDTH);
  assert.ok(frames[2].canvas_y > frames[1].canvas_y);
  assert.deepEqual(
    frames.map((f) => f.image_id),
    ["a", "b", "c"],
  );
  const moved = clampFrame({ ...frames[0], canvas_y: 3000 });
  assert.equal(moved.sort_order, 0);
  assert.equal(frames[1].canvas_y, 0);
});
test("saved free positions and individual image modes survive conversion", () => {
  const [frame] = toCanvas([
    image("a", {
      canvas_x: 73,
      canvas_y: 2810,
      canvas_width: 507,
      canvas_height: 201,
      image_fit: "contain",
      position_x: 23,
    }),
  ]);
  assert.equal(frame.canvas_x, 73);
  assert.equal(frame.canvas_y, 2810);
  assert.equal(frame.canvas_width, 507);
  assert.equal(frame.image_fit, "contain");
  assert.equal(frame.position_x, 23);
});
test("snapping is only applied near a guide and can align centers", () => {
  assert.deepEqual(snapAxis(194, 200, [300], 8), { value: 200, guide: 300 });
  assert.deepEqual(snapAxis(180, 200, [300], 8), { value: 180, guide: null });
});
test("group bounds and frame clamping preserve page edges", () => {
  const frames = toCanvas([image("a"), image("b", { sort_order: 1 })]);
  const box = bounds(frames);
  assert.equal(box.x, 0);
  assert.ok(box.width <= PAGE_WIDTH);
  const frame = clampFrame({
    ...frames[0],
    canvas_x: 1190,
    canvas_width: 500,
    canvas_y: -200,
    canvas_height: 0,
  });
  assert.equal(frame.canvas_x, 700);
  assert.equal(frame.canvas_y, 0);
  assert.equal(frame.canvas_height, 20);
});
