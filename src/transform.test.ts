import { describe, it, expect } from 'vitest';
import { identity, multiply, applyToPoint, parseSvgTransform, type Matrix3 } from './transform.js';

const EPS = 1e-9;

function approxEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

function matricesApproxEqual(a: Matrix3, b: Matrix3, eps = EPS): boolean {
  return a.every((v, i) => approxEqual(v, b[i], eps));
}

describe('identity()', () => {
  it('returns a 3×3 identity matrix', () => {
    const m = identity();
    expect(m).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('has 9 elements', () => {
    expect(identity().length).toBe(9);
  });
});

describe('multiply()', () => {
  it('identity × identity = identity', () => {
    const result = multiply(identity(), identity());
    expect(result).toEqual(identity());
  });

  it('translate(5,0) × translate(0,3) = translate(5,3)', () => {
    const t1: Matrix3 = [1, 0, 5,  0, 1, 0,  0, 0, 1];
    const t2: Matrix3 = [1, 0, 0,  0, 1, 3,  0, 0, 1];
    const result = multiply(t1, t2);
    const expected: Matrix3 = [1, 0, 5,  0, 1, 3,  0, 0, 1];
    expect(matricesApproxEqual(result, expected)).toBe(true);
  });

  it('translate(10,20) × translate(-10,-20) = identity', () => {
    const t1: Matrix3 = [1, 0, 10,  0, 1, 20,  0, 0, 1];
    const t2: Matrix3 = [1, 0, -10, 0, 1, -20, 0, 0, 1];
    const result = multiply(t1, t2);
    expect(matricesApproxEqual(result, identity())).toBe(true);
  });

  it('is not commutative for non-trivial transforms', () => {
    const t: Matrix3 = [1, 0, 5,  0, 1, 3,  0, 0, 1];
    const s: Matrix3 = [2, 0, 0,  0, 2, 0,  0, 0, 1];
    const ab = multiply(t, s);
    const ba = multiply(s, t);
    // t then s: scale after translate — translation is preserved as-is then scaled
    // s then t: translate after scale
    expect(matricesApproxEqual(ab, ba)).toBe(false);
  });
});

describe('applyToPoint()', () => {
  it('identity leaves point unchanged', () => {
    const [x, y] = applyToPoint(identity(), 7, 13);
    expect(x).toBeCloseTo(7, 9);
    expect(y).toBeCloseTo(13, 9);
  });

  it('translate(10, 20) shifts point correctly', () => {
    const m = parseSvgTransform('translate(10, 20)');
    const [x, y] = applyToPoint(m, 5, 5);
    expect(x).toBeCloseTo(15, 9);
    expect(y).toBeCloseTo(25, 9);
  });

  it('applies translate to origin', () => {
    const m: Matrix3 = [1, 0, 3,  0, 1, 7,  0, 0, 1];
    const [x, y] = applyToPoint(m, 0, 0);
    expect(x).toBeCloseTo(3, 9);
    expect(y).toBeCloseTo(7, 9);
  });
});

describe('parseSvgTransform()', () => {
  it('translate(10, 20) produces correct matrix', () => {
    const m = parseSvgTransform('translate(10, 20)');
    const expected: Matrix3 = [1, 0, 10,  0, 1, 20,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });

  it('translate(5) with single arg sets ty=0', () => {
    const m = parseSvgTransform('translate(5)');
    const expected: Matrix3 = [1, 0, 5,  0, 1, 0,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });

  it('matrix(0,1,-1,0,5,3) produces correct matrix', () => {
    // SVG matrix(a,b,c,d,e,f): [[a,c,e],[b,d,f],[0,0,1]]
    // matrix(0,1,-1,0,5,3): a=0,b=1,c=-1,d=0,e=5,f=3
    // [[0,-1,5],[1,0,3],[0,0,1]]
    const m = parseSvgTransform('matrix(0,1,-1,0,5,3)');
    const expected: Matrix3 = [0, -1, 5,  1, 0, 3,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });

  it('rotate(90) produces correct rotation matrix', () => {
    const m = parseSvgTransform('rotate(90)');
    const cos90 = Math.cos(Math.PI / 2);  // ~0
    const sin90 = Math.sin(Math.PI / 2);  // ~1
    const expected: Matrix3 = [cos90, -sin90, 0,  sin90, cos90, 0,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });

  it('rotate(90) applied to (1,0) gives approximately (0,1)', () => {
    const m = parseSvgTransform('rotate(90)');
    const [x, y] = applyToPoint(m, 1, 0);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
  });

  it('rotate(-90, 10, 20) applied to (10, 20) returns (10, 20) — centre is fixed', () => {
    const m = parseSvgTransform('rotate(-90, 10, 20)');
    const [x, y] = applyToPoint(m, 10, 20);
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(20, 9);
  });

  it('rotate(-90, 10, 20) applied to (20, 20) gives (10, 30)', () => {
    // rotate -90 degrees about (10,20)
    // (20,20) relative to centre = (10,0)
    // rotate -90°: (10,0) → (0,-10) in standard math, but SVG Y is down
    // In screen coords: rotate -90° maps (x,y) → (y,-x)
    // relative (10,0) rotated -90°: (0,-10)
    // absolute: (10+0, 20+(-10)) = (10, 10)
    const m = parseSvgTransform('rotate(-90, 10, 20)');
    const [x, y] = applyToPoint(m, 20, 20);
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(10, 9);
  });

  it('two transforms in sequence: translate(5,0) rotate(90)', () => {
    // SVG spec: transforms are applied left-to-right to the coordinate system.
    // Combined matrix = T * R. Applied to a point: T*(R*p), so rotate is applied first.
    // For point (1,0):
    //   rotate(90) on (1,0) → (0,1)
    //   translate(5,0) on (0,1) → (5,1)
    const m = parseSvgTransform('translate(5,0) rotate(90)');
    const [x, y] = applyToPoint(m, 1, 0);
    expect(x).toBeCloseTo(5, 9);
    expect(y).toBeCloseTo(1, 9);
  });

  it('empty string returns identity', () => {
    const m = parseSvgTransform('');
    expect(matricesApproxEqual(m, identity())).toBe(true);
  });

  it('scale(2) produces correct scale matrix', () => {
    const m = parseSvgTransform('scale(2)');
    const expected: Matrix3 = [2, 0, 0,  0, 2, 0,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });

  it('scale(2, 3) produces non-uniform scale matrix', () => {
    const m = parseSvgTransform('scale(2, 3)');
    const expected: Matrix3 = [2, 0, 0,  0, 3, 0,  0, 0, 1];
    expect(matricesApproxEqual(m, expected)).toBe(true);
  });
});
