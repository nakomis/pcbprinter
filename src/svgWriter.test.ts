import { describe, it, expect, vi } from 'vitest';
import type { BoardModel, PrinterOptions } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';

// Mock geometry.js since it may not be available yet from the parallel agent
vi.mock('./geometry.js', () => ({
  lineToRoundedPath: vi.fn(
    (x1: number, y1: number, x2: number, y2: number, halfWidth: number) =>
      `M ${x1},${y1} L ${x2},${y2} Z`
  ),
  lineToPolygon: vi.fn(() => []),
}));

import { buildSvg } from './svgWriter.js';

const boardRect = { x: 0, y: 0, w: 100, h: 80 };

function makeOptions(overrides: Partial<PrinterOptions> = {}): PrinterOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function makeModel(overrides: Partial<BoardModel> = {}): BoardModel {
  return {
    svgUnitsPerMm: 3.7795275591,
    boardRect,
    traces: [],
    pads: [],
    footprintCircles: [],
    ...overrides,
  };
}

describe('buildSvg()', () => {
  it('returns a string containing <svg and </svg>', () => {
    const svg = buildSvg(makeModel(), makeOptions());
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('includes the viewBox derived from boardRect', () => {
    const svg = buildSvg(makeModel(), makeOptions());
    expect(svg).toContain('viewBox="0 0 100 80"');
  });

  it('includes the board background color', () => {
    const svg = buildSvg(makeModel(), makeOptions({ boardColor: '#03A550' }));
    expect(svg).toContain('#03A550');
  });

  it('includes a custom board color when overridden', () => {
    const svg = buildSvg(makeModel(), makeOptions({ boardColor: '#FF0000' }));
    expect(svg).toContain('#FF0000');
  });

  it('emits a <path for a single trace', () => {
    const model = makeModel({
      traces: [{
        x1: 10, y1: 20, x2: 50, y2: 60,
        strokeWidth: 2,
        color: '#copper',
      }],
    });
    const svg = buildSvg(model, makeOptions());
    expect(svg).toContain('<path');
    expect(svg).toContain('#copper');
  });

  it('path d attribute comes from lineToRoundedPath mock', () => {
    const model = makeModel({
      traces: [{
        x1: 5, y1: 10, x2: 30, y2: 40,
        strokeWidth: 4,
        color: '#aaa',
      }],
    });
    const svg = buildSvg(model, makeOptions());
    // Mock returns "M x1,y1 L x2,y2 Z"
    expect(svg).toContain('M 5,10 L 30,40 Z');
  });

  it('emits two <circle elements for a pad', () => {
    const model = makeModel({
      pads: [{
        cx: 25, cy: 35,
        drillRadius: 3,
        padRadius: 6,
        color: '#gold',
      }],
    });
    const svg = buildSvg(model, makeOptions());
    const circleMatches = svg.match(/<circle/g);
    expect(circleMatches).not.toBeNull();
    expect(circleMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it('pad outer circle uses padRadius', () => {
    const model = makeModel({
      pads: [{
        cx: 25, cy: 35,
        drillRadius: 3,
        padRadius: 6,
        color: '#gold',
      }],
    });
    const svg = buildSvg(model, makeOptions());
    expect(svg).toContain('r="6"');
    expect(svg).toContain('fill="#f2c600"');
  });

  it('pad inner circle uses drillRadius', () => {
    const model = makeModel({
      pads: [{
        cx: 25, cy: 35,
        drillRadius: 3,
        padRadius: 6,
        color: '#gold',
      }],
    });
    const svg = buildSvg(model, makeOptions());
    expect(svg).toContain('r="3"');
    expect(svg).toContain('fill="#111111"');
  });

  it('footprint circles appear with correct attributes', () => {
    const model = makeModel({
      footprintCircles: [
        { cx: 15, cy: 20, r: 8 },
        { cx: 50, cy: 60, r: 12 },
      ],
    });
    const svg = buildSvg(model, makeOptions());
    expect(svg).toContain('stroke="#F7BD13"');
    // Both circles should appear
    const circleMatches = svg.match(/<circle/g);
    expect(circleMatches).not.toBeNull();
    expect(circleMatches!.length).toBe(2);
  });

  it('output is valid XML (parseable with DOMParser)', async () => {
    const { DOMParser } = await import('@xmldom/xmldom');
    const model = makeModel({
      traces: [{ x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 2, color: '#333' }],
      pads: [{ cx: 5, cy: 5, drillRadius: 1, padRadius: 3, color: '#aaa' }],
      footprintCircles: [{ cx: 20, cy: 20, r: 5 }],
    });
    const svg = buildSvg(model, makeOptions());
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    // @xmldom/xmldom throws errors via the error handler or returns a document
    // Check the root element is an svg
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
  });

  it('board outline rect is present with stroke', () => {
    const svg = buildSvg(makeModel(), makeOptions());
    // There should be a rect with stroke="#111111"
    expect(svg).toContain('stroke="#111111"');
  });

  it('multiple traces produce multiple <path elements', () => {
    const model = makeModel({
      traces: [
        { x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 2, color: '#111' },
        { x1: 20, y1: 0, x2: 30, y2: 10, strokeWidth: 2, color: '#222' },
        { x1: 40, y1: 0, x2: 50, y2: 10, strokeWidth: 2, color: '#333' },
      ],
    });
    const svg = buildSvg(model, makeOptions());
    const pathMatches = svg.match(/<path/g);
    expect(pathMatches).not.toBeNull();
    expect(pathMatches!.length).toBe(3);
  });
});
