/** 3×3 affine matrix, row-major: [a, b, c, d, e, f, g, h, i] */
export type Matrix3 = [number,number,number, number,number,number, number,number,number];

export function identity(): Matrix3 { throw new Error('not implemented'); }
export function multiply(a: Matrix3, b: Matrix3): Matrix3 { throw new Error('not implemented'); }
export function applyToPoint(m: Matrix3, x: number, y: number): [number, number] { throw new Error('not implemented'); }
export function parseSvgTransform(attr: string): Matrix3 { throw new Error('not implemented'); }
