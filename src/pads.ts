import type { BoardModel } from './types.js';
import type { PrinterOptions } from './types.js';

/** Snap trace endpoints to the nearest pad centre within snapTolerance. Mutates model in place. */
export function snapTracesToPads(model: BoardModel, options: PrinterOptions): void {
  const toleranceSvg = options.snapToleranceMm * model.svgUnitsPerMm;

  for (const trace of model.traces) {
    // Check endpoint 1
    let bestDist1 = toleranceSvg;
    let bestPad1 = null;
    for (const pad of model.pads) {
      const dx = pad.cx - trace.x1;
      const dy = pad.cy - trace.y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= bestDist1) {
        bestDist1 = dist;
        bestPad1 = pad;
      }
    }
    if (bestPad1 !== null) {
      trace.x1 = bestPad1.cx;
      trace.y1 = bestPad1.cy;
    }

    // Check endpoint 2
    let bestDist2 = toleranceSvg;
    let bestPad2 = null;
    for (const pad of model.pads) {
      const dx = pad.cx - trace.x2;
      const dy = pad.cy - trace.y2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= bestDist2) {
        bestDist2 = dist;
        bestPad2 = pad;
      }
    }
    if (bestPad2 !== null) {
      trace.x2 = bestPad2.cx;
      trace.y2 = bestPad2.cy;
    }
  }
}
