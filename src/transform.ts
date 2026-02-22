/** 3×3 affine matrix, row-major: [a, b, c, d, e, f, g, h, i] */
export type Matrix3 = [number,number,number, number,number,number, number,number,number];

export function identity(): Matrix3 {
  return [1, 0, 0,
          0, 1, 0,
          0, 0, 1];
}

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  // Standard 3×3 matrix multiplication: result[row][col] = sum(a[row][k] * b[k][col])
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0*b0 + a1*b3 + a2*b6,  a0*b1 + a1*b4 + a2*b7,  a0*b2 + a1*b5 + a2*b8,
    a3*b0 + a4*b3 + a5*b6,  a3*b1 + a4*b4 + a5*b7,  a3*b2 + a4*b5 + a5*b8,
    a6*b0 + a7*b3 + a8*b6,  a6*b1 + a7*b4 + a8*b7,  a6*b2 + a7*b5 + a8*b8,
  ];
}

export function applyToPoint(m: Matrix3, x: number, y: number): [number, number] {
  // Multiply matrix m by column vector [x, y, 1]^T
  const xp = m[0]*x + m[1]*y + m[2];
  const yp = m[3]*x + m[4]*y + m[5];
  return [xp, yp];
}

/**
 * Parse an SVG transform attribute string into a Matrix3.
 * Handles: translate, scale, rotate, matrix, and sequences thereof.
 */
export function parseSvgTransform(attr: string): Matrix3 {
  // Match individual transform functions, e.g. translate(10,20), matrix(a,b,c,d,e,f)
  const tokenRe = /(\w+)\s*\(([^)]*)\)/g;
  let result = identity();
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(attr)) !== null) {
    const name = match[1].toLowerCase();
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(s => s.length > 0)
      .map(Number);

    let m: Matrix3;

    switch (name) {
      case 'translate': {
        const tx = args[0] ?? 0;
        const ty = args[1] ?? 0;
        m = [1, 0, tx,
             0, 1, ty,
             0, 0,  1];
        break;
      }
      case 'scale': {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        m = [sx, 0,  0,
              0, sy, 0,
              0,  0, 1];
        break;
      }
      case 'rotate': {
        const deg = args[0] ?? 0;
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        if (args.length >= 3) {
          // rotate(deg, cx, cy): translate to cx,cy; rotate; translate back
          const cx = args[1];
          const cy = args[2];
          const t1: Matrix3 = [1, 0, cx,
                                0, 1, cy,
                                0, 0,  1];
          const r: Matrix3  = [cos, -sin, 0,
                                sin,  cos, 0,
                                  0,    0, 1];
          const t2: Matrix3 = [1, 0, -cx,
                                0, 1, -cy,
                                0, 0,   1];
          m = multiply(t1, multiply(r, t2));
        } else {
          m = [cos, -sin, 0,
               sin,  cos, 0,
                 0,    0, 1];
        }
        break;
      }
      case 'matrix': {
        // SVG matrix(a,b,c,d,e,f) — column-major convention:
        //   [[a, c, e],
        //    [b, d, f],
        //    [0, 0, 1]]
        const [a, b, c, d, e, f] = args;
        m = [a, c, e,
             b, d, f,
             0, 0, 1];
        break;
      }
      default:
        // Unknown transform — treat as identity
        m = identity();
    }

    // Compose left-to-right: result = result * m
    result = multiply(result, m);
  }

  return result;
}
