import { describe, it, expect } from 'vitest';
import { lineToRoundedPath, lineToPolygon } from './geometry.js';

describe('lineToRoundedPath()', () => {
  it('horizontal line starts with M and ends with Z', () => {
    const path = lineToRoundedPath(0, 0, 100, 0, 5);
    expect(path.trim().startsWith('M')).toBe(true);
    expect(path.trim().endsWith('Z')).toBe(true);
  });

  it('horizontal line contains L and A commands', () => {
    const path = lineToRoundedPath(0, 0, 100, 0, 5);
    expect(path).toContain('L');
    expect(path).toContain('A');
  });

  it('horizontal line path has correct structure (M L A L A Z)', () => {
    const path = lineToRoundedPath(0, 0, 100, 0, 5);
    // Count occurrences of each command type
    const mCount = (path.match(/\bM\b/g) ?? []).length;
    const lCount = (path.match(/\bL\b/g) ?? []).length;
    const aCount = (path.match(/\bA\b/g) ?? []).length;
    expect(mCount).toBe(1);
    expect(lCount).toBe(2);
    expect(aCount).toBe(2);
  });

  it('horizontal line: top-side point has correct y (y - halfWidth)', () => {
    // For line (0,0)→(100,0), normal is (0,-1) rotated... wait:
    // ux=1, uy=0, nx=-uy=0, ny=ux=1
    // a = (x1+nx*h, y1+ny*h) = (0+0, 0+5) = (0, 5)
    const path = lineToRoundedPath(0, 0, 100, 0, 5);
    // The path should start at approximately (0, 5)
    expect(path).toMatch(/^M 0,5/);
  });

  it('diagonal line starts with M and ends with Z', () => {
    const path = lineToRoundedPath(0, 0, 10, 10, 2);
    expect(path.trim().startsWith('M')).toBe(true);
    expect(path.trim().endsWith('Z')).toBe(true);
  });

  it('vertical line starts with M and ends with Z', () => {
    const path = lineToRoundedPath(5, 0, 5, 100, 3);
    expect(path.trim().startsWith('M')).toBe(true);
    expect(path.trim().endsWith('Z')).toBe(true);
  });

  it('arc radius in path matches halfWidth', () => {
    const h = 7.5;
    const path = lineToRoundedPath(0, 0, 50, 0, h);
    // Arc command format: A rx,ry ...
    const arcMatch = path.match(/A ([\d.]+),([\d.]+)/);
    expect(arcMatch).not.toBeNull();
    expect(parseFloat(arcMatch![1])).toBeCloseTo(h, 5);
    expect(parseFloat(arcMatch![2])).toBeCloseTo(h, 5);
  });
});

describe('lineToRoundedPath() — zero-length line', () => {
  it('returns a valid non-empty path string', () => {
    const path = lineToRoundedPath(10, 20, 10, 20, 5);
    expect(typeof path).toBe('string');
    expect(path.trim().length).toBeGreaterThan(0);
  });

  it('zero-length line path starts with M and ends with Z', () => {
    const path = lineToRoundedPath(0, 0, 0, 0, 3);
    expect(path.trim().startsWith('M')).toBe(true);
    expect(path.trim().endsWith('Z')).toBe(true);
  });

  it('zero-length line path contains arc commands', () => {
    const path = lineToRoundedPath(0, 0, 0, 0, 3);
    expect(path).toContain('A');
  });
});

describe('lineToPolygon()', () => {
  it('horizontal line: returns an array of [x,y] pairs', () => {
    const pts = lineToPolygon(0, 0, 100, 0, 5, 8);
    expect(Array.isArray(pts)).toBe(true);
    pts.forEach(p => {
      expect(p.length).toBe(2);
      expect(typeof p[0]).toBe('number');
      expect(typeof p[1]).toBe('number');
    });
  });

  it('horizontal line: all points within expected bounding box', () => {
    const h = 5;
    const pts = lineToPolygon(0, 0, 100, 0, h, 16);
    pts.forEach(([x, y]) => {
      // x should be between -h and 100+h (cap ends)
      expect(x).toBeGreaterThanOrEqual(-h - 1e-9);
      expect(x).toBeLessThanOrEqual(100 + h + 1e-9);
      // y should be between -h and +h (halfWidth above/below line)
      expect(y).toBeGreaterThanOrEqual(-h - 1e-9);
      expect(y).toBeLessThanOrEqual(h + 1e-9);
    });
  });

  it('horizontal line: has more than 4 points (includes cap segments)', () => {
    const pts = lineToPolygon(0, 0, 100, 0, 5, 8);
    // 2 rectangle sides + 2 caps each with (segments/2 - 1) intermediate points
    // + 4 corner points = at least 4 + 2*(8/2-1) = 4 + 6 = 10
    expect(pts.length).toBeGreaterThan(4);
  });

  it('horizontal line: point count is consistent with segments parameter', () => {
    // With segments=8: halfSegs=4
    // Points: a, b, (halfSegs-1)=3 cap points, c, d, (halfSegs-1)=3 cap points = 2+3+2+3 = 10
    const pts = lineToPolygon(0, 0, 100, 0, 5, 8);
    expect(pts.length).toBe(10);
  });

  it('vertical line: all points within expected bounding box', () => {
    const h = 4;
    const pts = lineToPolygon(0, 0, 0, 50, h, 16);
    pts.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(-h - 1e-9);
      expect(x).toBeLessThanOrEqual(h + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-h - 1e-9);
      expect(y).toBeLessThanOrEqual(50 + h + 1e-9);
    });
  });

  it('zero-length line: returns a circle approximation', () => {
    const h = 5;
    const segs = 16;
    const pts = lineToPolygon(10, 20, 10, 20, h, segs);
    expect(pts.length).toBe(segs);
    // All points should be at distance h from centre (10, 20)
    pts.forEach(([x, y]) => {
      const dist = Math.hypot(x - 10, y - 20);
      expect(dist).toBeCloseTo(h, 9);
    });
  });

  it('diagonal line: all points within expected bounding box', () => {
    const h = 3;
    const pts = lineToPolygon(0, 0, 10, 10, h, 16);
    const margin = h + 1e-9;
    pts.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(-margin);
      expect(x).toBeLessThanOrEqual(10 + margin);
      expect(y).toBeGreaterThanOrEqual(-margin);
      expect(y).toBeLessThanOrEqual(10 + margin);
    });
  });
});
