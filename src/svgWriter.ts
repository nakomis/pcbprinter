import type { BoardModel, PrinterOptions } from './types.js';
import { lineToRoundedPath } from './geometry.js';

export function buildSvg(model: BoardModel, options: PrinterOptions): string {
  const { boardRect, traces, pads, footprintCircles } = model;
  const { x, y, w, h } = boardRect;

  const lines: string[] = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     viewBox="${x} ${y} ${w} ${h}"`,
    `     width="${w}" height="${h}">`
  );

  // 1. Board background
  lines.push(
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${options.boardColor}"/>`
  );

  // 2. Board outline
  lines.push(
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111111" stroke-width="0.5"/>`
  );

  // 3. Footprint circles
  for (const fc of footprintCircles) {
    lines.push(
      `  <circle cx="${fc.cx}" cy="${fc.cy}" r="${fc.r}" fill="none" stroke="#F7BD13" stroke-width="0.5"/>`
    );
  }

  // 4. Trace paths
  for (const trace of traces) {
    const halfWidth = trace.strokeWidth / 2;
    const d = lineToRoundedPath(trace.x1, trace.y1, trace.x2, trace.y2, halfWidth);
    lines.push(`  <path fill="${trace.color}" d="${d}"/>`);
  }

  // 5. Pad pairs (outer then inner)
  for (const pad of pads) {
    lines.push(
      `  <circle cx="${pad.cx}" cy="${pad.cy}" r="${pad.padRadius}" fill="#f2c600"/>`,
      `  <circle cx="${pad.cx}" cy="${pad.cy}" r="${pad.drillRadius}" fill="#111111"/>`
    );
  }

  lines.push(`</svg>`);

  return lines.join('\n');
}
