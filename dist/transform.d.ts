/** 3×3 affine matrix, row-major: [a, b, c, d, e, f, g, h, i] */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];
export declare function identity(): Matrix3;
export declare function multiply(a: Matrix3, b: Matrix3): Matrix3;
export declare function applyToPoint(m: Matrix3, x: number, y: number): [number, number];
/**
 * Parse an SVG transform attribute string into a Matrix3.
 * Handles: translate, scale, rotate, matrix, and sequences thereof.
 */
export declare function parseSvgTransform(attr: string): Matrix3;
