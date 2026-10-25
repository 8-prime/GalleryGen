import type { PortfolioImage } from "./portfolios";

export const PAGE_WIDTH = 1200;
export const MAX_HEIGHT = 100000;
export type CanvasImage = PortfolioImage & {
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
};
export function toCanvas(images: PortfolioImage[], gap = 4): CanvasImage[] {
  const occupied = new Set<string>();
  let cursor = 0;
  const unit = (PAGE_WIDTH - gap * 2) / 3;
  return [...images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image, order) => {
      const cols = Math.min(3, Math.max(1, image.col_span)),
        rows = Math.min(20, Math.max(1, image.row_span));
      if (image.row_break_before && cursor % 3) cursor += 3 - (cursor % 3);
      while (true) {
        const x = cursor % 3,
          y = Math.floor(cursor / 3);
        if (
          x + cols <= 3 &&
          Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => `${x + c},${y + r}`),
          )
            .flat()
            .every((cell) => !occupied.has(cell))
        )
          break;
        cursor++;
      }
      const col = cursor % 3,
        row = Math.floor(cursor / 3);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) occupied.add(`${col + c},${row + r}`);
      const result = {
        ...image,
        sort_order: order,
        image_fit: image.image_fit || "cover",
        position_x: image.position_x ?? 50,
        position_y: image.position_y ?? 50,
        canvas_x: image.canvas_x ?? col * (unit + gap),
        canvas_y: image.canvas_y ?? row * (unit + gap),
        canvas_width: image.canvas_width ?? cols * unit + (cols - 1) * gap,
        canvas_height: image.canvas_height ?? rows * unit + (rows - 1) * gap,
      };
      cursor++;
      return result;
    });
}
export function clampFrame(image: CanvasImage): CanvasImage {
  const w = Math.min(PAGE_WIDTH, Math.max(20, image.canvas_width)),
    h = Math.min(MAX_HEIGHT, Math.max(20, image.canvas_height));
  return {
    ...image,
    canvas_width: w,
    canvas_height: h,
    canvas_x: Math.max(0, Math.min(PAGE_WIDTH - w, image.canvas_x)),
    canvas_y: Math.max(0, Math.min(MAX_HEIGHT - h, image.canvas_y)),
  };
}
export function bounds(images: CanvasImage[]) {
  const x = Math.min(...images.map((i) => i.canvas_x)),
    y = Math.min(...images.map((i) => i.canvas_y));
  return {
    x,
    y,
    width: Math.max(...images.map((i) => i.canvas_x + i.canvas_width)) - x,
    height: Math.max(...images.map((i) => i.canvas_y + i.canvas_height)) - y,
  };
}
export function snapAxis(
  value: number,
  size: number,
  targets: number[],
  threshold: number,
) {
  let delta = 0,
    guide: number | null = null,
    best = threshold;
  for (const target of targets)
    for (const edge of [value, value + size / 2, value + size]) {
      if (Math.abs(target - edge) < best) {
        delta = target - edge;
        guide = target;
        best = Math.abs(delta);
      }
    }
  return { value: value + delta, guide };
}
