import { describe, it, expect } from 'vitest';
import type { BoardModel, PrinterOptions } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';
import { buildStls } from './stlWriter.js';

// 3.7795275591 SVG units per mm (96 dpi / 25.4)
const SVG_UNITS_PER_MM = 3.7795275591;

function makeOptions(overrides: Partial<PrinterOptions> = {}): PrinterOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function makeModel(overrides: Partial<BoardModel> = {}): BoardModel {
  return {
    svgUnitsPerMm: SVG_UNITS_PER_MM,
    boardRect: {
      x: 0,
      y: 0,
      w: 100 * SVG_UNITS_PER_MM,   // 100mm wide
      h: 80 * SVG_UNITS_PER_MM,    // 80mm tall
    },
    traces: [],
    pads: [],
    footprintCircles: [],
    ...overrides,
  };
}

function parseBinaryStlTriangleCount(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  return view.getUint32(80, true /* little-endian */);
}

describe('buildStls()', () => {
  it('returns an object with pcb and press properties', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#copper',
      }],
    });
    const result = await buildStls(model, makeOptions());
    expect(result).toHaveProperty('pcb');
    expect(result).toHaveProperty('press');
  });

  it('pcb is an ArrayBuffer', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#copper',
      }],
    });
    const { pcb } = await buildStls(model, makeOptions());
    expect(pcb instanceof ArrayBuffer).toBe(true);
  });

  it('press is an ArrayBuffer', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#copper',
      }],
    });
    const { press } = await buildStls(model, makeOptions());
    expect(press instanceof ArrayBuffer).toBe(true);
  });

  it('pcb buffer has byteLength > 0', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#copper',
      }],
    });
    const { pcb } = await buildStls(model, makeOptions());
    expect(pcb.byteLength).toBeGreaterThan(0);
  });

  it('press buffer has byteLength > 0', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#copper',
      }],
    });
    const { press } = await buildStls(model, makeOptions());
    expect(press.byteLength).toBeGreaterThan(0);
  });

  it('pcb STL has minimum size for binary STL (header + count + at least 1 triangle)', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 5 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 1 * SVG_UNITS_PER_MM,
        color: '#aaa',
      }],
    });
    const { pcb } = await buildStls(model, makeOptions());
    // Binary STL: 80 byte header + 4 byte count + N * 50 bytes per triangle
    expect(pcb.byteLength).toBeGreaterThanOrEqual(80 + 4 + 50);
  });

  it('press STL has minimum size for binary STL', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 5 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 1 * SVG_UNITS_PER_MM,
        color: '#aaa',
      }],
    });
    const { press } = await buildStls(model, makeOptions());
    expect(press.byteLength).toBeGreaterThanOrEqual(80 + 4 + 50);
  });

  it('pcb STL triangle count is consistent with buffer size', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#aaa',
      }],
    });
    const { pcb } = await buildStls(model, makeOptions());
    const triCount = parseBinaryStlTriangleCount(pcb);
    const expectedSize = 80 + 4 + triCount * 50;
    expect(pcb.byteLength).toBe(expectedSize);
  });

  it('press STL triangle count is consistent with buffer size', async () => {
    const model = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 10 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 2 * SVG_UNITS_PER_MM,
        color: '#aaa',
      }],
    });
    const { press } = await buildStls(model, makeOptions());
    const triCount = parseBinaryStlTriangleCount(press);
    const expectedSize = 80 + 4 + triCount * 50;
    expect(press.byteLength).toBe(expectedSize);
  });

  it('model with a pad: pcb buffer is non-empty', async () => {
    const model = makeModel({
      pads: [{
        cx: 20 * SVG_UNITS_PER_MM,
        cy: 20 * SVG_UNITS_PER_MM,
        drillRadius: 0.5 * SVG_UNITS_PER_MM,
        padRadius: 1.0 * SVG_UNITS_PER_MM,
        color: '#gold',
      }],
    });
    const { pcb } = await buildStls(model, makeOptions());
    expect(pcb.byteLength).toBeGreaterThan(0);
  });

  it('model with a pad: press buffer is non-empty', async () => {
    const model = makeModel({
      pads: [{
        cx: 20 * SVG_UNITS_PER_MM,
        cy: 20 * SVG_UNITS_PER_MM,
        drillRadius: 0.5 * SVG_UNITS_PER_MM,
        padRadius: 1.0 * SVG_UNITS_PER_MM,
        color: '#gold',
      }],
    });
    const { press } = await buildStls(model, makeOptions());
    expect(press.byteLength).toBeGreaterThan(0);
  });

  it('board with trace recess produces pcb that is not the same as without recess', async () => {
    const traces = [{
      x1: 10 * SVG_UNITS_PER_MM, y1: 10 * SVG_UNITS_PER_MM,
      x2: 50 * SVG_UNITS_PER_MM, y2: 10 * SVG_UNITS_PER_MM,
      strokeWidth: 2 * SVG_UNITS_PER_MM,
      color: '#aaa',
    }];
    const model = makeModel({ traces });
    const { pcb: pcbNoRecess } = await buildStls(model, makeOptions({ traceRecessMm: 0 }));
    const { pcb: pcbWithRecess } = await buildStls(model, makeOptions({ traceRecessMm: 0.1 }));
    // The recessed board should be different (different triangle count)
    const triCountNoRecess = parseBinaryStlTriangleCount(pcbNoRecess);
    const triCountWithRecess = parseBinaryStlTriangleCount(pcbWithRecess);
    expect(triCountWithRecess).not.toBe(triCountNoRecess);
  });

  it('press is larger (more triangles) when traces are longer', async () => {
    const modelShort = makeModel({
      traces: [{
        x1: 0, y1: 0,
        x2: 5 * SVG_UNITS_PER_MM, y2: 0,
        strokeWidth: 1 * SVG_UNITS_PER_MM,
        color: '#aaa',
      }],
    });
    const modelLong = makeModel({
      traces: [
        { x1: 0, y1: 0, x2: 5 * SVG_UNITS_PER_MM, y2: 0, strokeWidth: 1 * SVG_UNITS_PER_MM, color: '#aaa' },
        { x1: 0, y1: 5 * SVG_UNITS_PER_MM, x2: 5 * SVG_UNITS_PER_MM, y2: 5 * SVG_UNITS_PER_MM, strokeWidth: 1 * SVG_UNITS_PER_MM, color: '#aaa' },
      ],
    });
    const { press: compShort } = await buildStls(modelShort, makeOptions());
    const { press: compLong } = await buildStls(modelLong, makeOptions());
    expect(compLong.byteLength).toBeGreaterThan(compShort.byteLength);
  });
});
