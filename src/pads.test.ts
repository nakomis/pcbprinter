import { describe, it, expect } from 'vitest';
import { snapTracesToPads } from './pads.js';
import type { BoardModel } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';

function makeModel(overrides: Partial<BoardModel> = {}): BoardModel {
  return {
    svgUnitsPerMm: 3.7795,
    boardRect: { x: 0, y: 0, w: 200, h: 200 },
    traces: [],
    pads: [],
    footprintCircles: [],
    ...overrides,
  };
}

describe('snapTracesToPads', () => {
  it('snaps a trace endpoint within tolerance to the nearest pad centre', () => {
    // tolerance = 1.5mm * 3.7795 svgUnitsPerMm ≈ 5.669 svg units
    const model = makeModel({
      traces: [{ x1: 100, y1: 100, x2: 200, y2: 200, strokeWidth: 1, color: '#000' }],
      pads: [{ cx: 102, cy: 101, drillRadius: 1, padRadius: 3, color: '#cc0000' }],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    // distance from (100,100) to (102,101) = sqrt(4+1) = ~2.24 < 5.669
    expect(model.traces[0].x1).toBe(102);
    expect(model.traces[0].y1).toBe(101);
    // endpoint 2 (200,200) is far from pad — should not move
    expect(model.traces[0].x2).toBe(200);
    expect(model.traces[0].y2).toBe(200);
  });

  it('does NOT snap an endpoint outside tolerance', () => {
    // tolerance = 1.5 * 3.7795 ≈ 5.669 units
    const model = makeModel({
      traces: [{ x1: 100, y1: 100, x2: 200, y2: 200, strokeWidth: 1, color: '#000' }],
      pads: [{ cx: 110, cy: 100, drillRadius: 1, padRadius: 3, color: '#cc0000' }],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    // distance from (100,100) to (110,100) = 10 > 5.669 — should not snap
    expect(model.traces[0].x1).toBe(100);
    expect(model.traces[0].y1).toBe(100);
  });

  it('snaps both endpoints of a trace independently', () => {
    const model = makeModel({
      traces: [{ x1: 10, y1: 10, x2: 50, y2: 50, strokeWidth: 1, color: '#000' }],
      pads: [
        { cx: 11, cy: 11, drillRadius: 1, padRadius: 3, color: '#cc0000' },
        { cx: 51, cy: 51, drillRadius: 1, padRadius: 3, color: '#cc0000' },
      ],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    expect(model.traces[0].x1).toBe(11);
    expect(model.traces[0].y1).toBe(11);
    expect(model.traces[0].x2).toBe(51);
    expect(model.traces[0].y2).toBe(51);
  });

  it('snaps to the nearest pad when multiple pads are within tolerance', () => {
    // Two pads close to endpoint 1: one at distance 2, one at distance 3
    const model = makeModel({
      traces: [{ x1: 100, y1: 100, x2: 200, y2: 200, strokeWidth: 1, color: '#000' }],
      pads: [
        { cx: 103, cy: 100, drillRadius: 1, padRadius: 3, color: '#cc0000' }, // dist=3
        { cx: 102, cy: 100, drillRadius: 1, padRadius: 3, color: '#00cc00' }, // dist=2
      ],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    expect(model.traces[0].x1).toBe(102);
    expect(model.traces[0].y1).toBe(100);
  });

  it('does nothing when there are no pads', () => {
    const model = makeModel({
      traces: [{ x1: 10, y1: 10, x2: 20, y2: 20, strokeWidth: 1, color: '#000' }],
      pads: [],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    expect(model.traces[0].x1).toBe(10);
    expect(model.traces[0].y1).toBe(10);
    expect(model.traces[0].x2).toBe(20);
    expect(model.traces[0].y2).toBe(20);
  });

  it('does nothing when there are no traces', () => {
    const model = makeModel({
      traces: [],
      pads: [{ cx: 10, cy: 10, drillRadius: 1, padRadius: 3, color: '#cc0000' }],
    });
    snapTracesToPads(model, DEFAULT_OPTIONS);
    expect(model.traces).toHaveLength(0);
  });

  it('uses snapToleranceMm from options', () => {
    // With a very small tolerance (0.1mm * 3.7795 ≈ 0.38 svg units), endpoint at distance 2 should NOT snap
    const opts = { ...DEFAULT_OPTIONS, snapToleranceMm: 0.1 };
    const model = makeModel({
      traces: [{ x1: 100, y1: 100, x2: 200, y2: 200, strokeWidth: 1, color: '#000' }],
      pads: [{ cx: 102, cy: 100, drillRadius: 1, padRadius: 3, color: '#cc0000' }],
    });
    snapTracesToPads(model, opts);
    // distance = 2 > 0.378 — should NOT snap
    expect(model.traces[0].x1).toBe(100);
    expect(model.traces[0].y1).toBe(100);
  });
});
