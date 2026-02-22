import { describe, it, expect, vi } from 'vitest';
// Mock the transform module before importing parser
vi.mock('./transform.js', () => {
    function identity() {
        return [1, 0, 0,
            0, 1, 0,
            0, 0, 1];
    }
    function multiply(a, b) {
        const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
        const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
        return [
            a0 * b0 + a1 * b3 + a2 * b6, a0 * b1 + a1 * b4 + a2 * b7, a0 * b2 + a1 * b5 + a2 * b8,
            a3 * b0 + a4 * b3 + a5 * b6, a3 * b1 + a4 * b4 + a5 * b7, a3 * b2 + a4 * b5 + a5 * b8,
            a6 * b0 + a7 * b3 + a8 * b6, a6 * b1 + a7 * b4 + a8 * b7, a6 * b2 + a7 * b5 + a8 * b8,
        ];
    }
    function applyToPoint(m, x, y) {
        const xp = m[0] * x + m[1] * y + m[2];
        const yp = m[3] * x + m[4] * y + m[5];
        return [xp, yp];
    }
    function parseSvgTransform(attr) {
        // Simple implementation for tests: handle translate only
        const tokenRe = /(\w+)\s*\(([^)]*)\)/g;
        let result = identity();
        let match;
        while ((match = tokenRe.exec(attr)) !== null) {
            const name = match[1].toLowerCase();
            const args = match[2].trim().split(/[\s,]+/).filter(s => s.length > 0).map(Number);
            let m;
            if (name === 'translate') {
                const tx = args[0] ?? 0;
                const ty = args[1] ?? 0;
                m = [1, 0, tx, 0, 1, ty, 0, 0, 1];
            }
            else {
                m = identity();
            }
            result = multiply(result, m);
        }
        return result;
    }
    return { identity, multiply, applyToPoint, parseSvgTransform };
});
import { parseFritzingSvg } from './parser.js';
import { DEFAULT_OPTIONS } from './types.js';
// Helper: build a minimal valid Fritzing SVG
function makeSvg(body, width = '2in', viewBox = '0 0 192 192') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" viewBox="${viewBox}">${body}</svg>`;
}
describe('parseFritzingSvg', () => {
    describe('svgUnitsPerMm calculation', () => {
        it('calculates svgUnitsPerMm from width in inches and viewBox', () => {
            // width=2in => 50.8mm; viewBox width=192 => 192/50.8 ≈ 3.7795
            const svg = makeSvg('<g id="board"><rect x="0" y="0" width="100" height="80"/></g>', '2in', '0 0 192 192');
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.svgUnitsPerMm).toBeCloseTo(192 / 50.8, 3);
        });
        it('falls back to 3.7795 when width attribute is missing', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><g id="board"><rect x="0" y="0" width="100" height="80"/></g></svg>`;
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.svgUnitsPerMm).toBe(3.7795);
        });
        it('calculates svgUnitsPerMm from width in mm', () => {
            const svg = makeSvg('<g id="board"><rect x="0" y="0" width="100" height="80"/></g>', '50mm', '0 0 200 200');
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.svgUnitsPerMm).toBeCloseTo(200 / 50, 5);
        });
    });
    describe('boardRect', () => {
        it('extracts board rect from <g id="board"> first <rect> child', () => {
            const svg = makeSvg('<g id="board"><rect x="10" y="20" width="100" height="80"/></g>');
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.boardRect.x).toBeCloseTo(10);
            expect(model.boardRect.y).toBeCloseTo(20);
            expect(model.boardRect.w).toBeCloseTo(100);
            expect(model.boardRect.h).toBeCloseTo(80);
        });
        it('returns zero rect if no board group found', () => {
            const svg = makeSvg('');
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.boardRect).toEqual({ x: 0, y: 0, w: 0, h: 0 });
        });
    });
    describe('traces', () => {
        it('collects a line from a copper group as a trace', () => {
            const svg = makeSvg(`
        <g id="board"><rect x="0" y="0" width="200" height="200"/></g>
        <g id="copper0">
          <line x1="10" y1="20" x2="50" y2="60" stroke="#cc0000" stroke-width="2"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(1);
            expect(model.traces[0].x1).toBeCloseTo(10);
            expect(model.traces[0].y1).toBeCloseTo(20);
            expect(model.traces[0].x2).toBeCloseTo(50);
            expect(model.traces[0].y2).toBeCloseTo(60);
            expect(model.traces[0].strokeWidth).toBeCloseTo(2);
            expect(model.traces[0].color).toBe('#cc0000');
        });
        it('collects lines from groups with id starting with copper (case-insensitive)', () => {
            const svg = makeSvg(`
        <g id="board"><rect x="0" y="0" width="200" height="200"/></g>
        <g id="Copper1">
          <line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="1"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(1);
        });
        it('normalises pt stroke width (1pt = 1.333 user units)', () => {
            const svg = makeSvg(`
        <g id="copper0">
          <line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="2pt"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces[0].strokeWidth).toBeCloseTo(2 * 1.333);
        });
    });
    describe('pads and footprint circles', () => {
        it('collects circles in copper groups as pads (Fritzing uses fill="none" + stroke)', () => {
            // Real Fritzing SVGs use fill="none" stroke="#F7BD13" for copper pads
            const svg = makeSvg(`
        <g id="copper0">
          <circle cx="30" cy="40" r="5" fill="none" stroke="#F7BD13"/>
        </g>
      `, '1in', '0 0 96 96');
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.pads).toHaveLength(1);
            expect(model.pads[0].cx).toBeCloseTo(30);
            expect(model.pads[0].cy).toBeCloseTo(40);
            expect(model.pads[0].padRadius).toBeCloseTo(5);
            expect(model.pads[0].color).toBe('#F7BD13');
        });
        it('all circles in copper groups are pads, not footprintCircles', () => {
            // In Fritzing PCB SVGs, all circles inside copper groups represent through-hole pads
            const svg = makeSvg(`
        <g id="copper0">
          <circle cx="10" cy="10" r="8" fill="none" stroke="#F7BD13"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.pads).toHaveLength(1);
            expect(model.footprintCircles).toHaveLength(0);
        });
        it('uses drillDiameterMm from options for pad drillRadius', () => {
            const svg = makeSvg(`
        <g id="copper0">
          <circle cx="30" cy="40" r="5" fill="#aa0000"/>
        </g>
      `, '1in', '0 0 96 96');
            const opts = { ...DEFAULT_OPTIONS, drillDiameterMm: 2.0 };
            const model = parseFritzingSvg(svg, opts);
            // 1in = 25.4mm, viewBox width = 96 => svgUnitsPerMm = 96/25.4
            const svgUnitsPerMm = 96 / 25.4;
            expect(model.pads[0].drillRadius).toBeCloseTo(1.0 * svgUnitsPerMm);
        });
        it('deduplicates pads within 0.1 user units', () => {
            const svg = makeSvg(`
        <g id="copper0">
          <circle cx="30" cy="40" r="5" fill="#cc0000"/>
          <circle cx="30.05" cy="40.05" r="5" fill="#cc0000"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.pads).toHaveLength(1);
        });
        it('keeps pads that are more than 0.1 user units apart', () => {
            const svg = makeSvg(`
        <g id="copper0">
          <circle cx="30" cy="40" r="5" fill="#cc0000"/>
          <circle cx="30.2" cy="40" r="5" fill="#cc0000"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.pads).toHaveLength(2);
        });
    });
    describe('excluded groups', () => {
        it('excludes watermark group and its contents', () => {
            const svg = makeSvg(`
        <g id="watermark">
          <g id="copper0">
            <line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="1"/>
          </g>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(0);
        });
        it('excludes groups with id containing "label" (case-insensitive)', () => {
            const svg = makeSvg(`
        <g id="partLabel">
          <g id="copper0">
            <line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="1"/>
          </g>
        </g>
        <g id="silkscreenLabel">
          <circle cx="10" cy="10" r="5" fill="#ff0000"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(0);
            expect(model.pads).toHaveLength(0);
        });
        it('excludes silkscreen group', () => {
            const svg = makeSvg(`
        <g id="silkscreen">
          <circle cx="10" cy="10" r="5" fill="#ff0000"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.pads).toHaveLength(0);
        });
    });
    describe('nested transforms', () => {
        it('applies translate transform on a copper group to line coordinates', () => {
            const svg = makeSvg(`
        <g id="copper0" transform="translate(100,50)">
          <line x1="10" y1="20" x2="30" y2="40" stroke="#000" stroke-width="1"/>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(1);
            expect(model.traces[0].x1).toBeCloseTo(110);
            expect(model.traces[0].y1).toBeCloseTo(70);
            expect(model.traces[0].x2).toBeCloseTo(130);
            expect(model.traces[0].y2).toBeCloseTo(90);
        });
        it('applies nested translate transforms correctly', () => {
            // Outer translate(10, 5), inner translate(2, 3) → total translate(12, 8)
            const svg = makeSvg(`
        <g id="copper0" transform="translate(10,5)">
          <g transform="translate(2,3)">
            <line x1="0" y1="0" x2="20" y2="20" stroke="#000" stroke-width="1"/>
          </g>
        </g>
      `);
            const model = parseFritzingSvg(svg, DEFAULT_OPTIONS);
            expect(model.traces).toHaveLength(1);
            expect(model.traces[0].x1).toBeCloseTo(12);
            expect(model.traces[0].y1).toBeCloseTo(8);
            expect(model.traces[0].x2).toBeCloseTo(32);
            expect(model.traces[0].y2).toBeCloseTo(28);
        });
    });
});
