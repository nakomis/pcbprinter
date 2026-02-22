import type { BoardModel, PrinterOptions, Trace, GroundFill } from './types.js';
import jscad from '@jscad/modeling';
import { serialize } from '@jscad/stl-serializer';

const { primitives, booleans, transforms, extrusions } = jscad;
const { cylinder, cuboid, rectangle, polygon } = primitives;
const { union, subtract } = booleans;
const { translate, rotate } = transforms;
const { extrudeLinear } = extrusions;

export interface StlOutputs { pcb: ArrayBuffer; press: ArrayBuffer; }

function concatBuffers(chunks: ArrayBuffer[]): ArrayBuffer {
  const totalLen = chunks.reduce((acc, ab) => acc + ab.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function toArrayBuffer(serialized: ArrayBuffer | ArrayBuffer[]): ArrayBuffer {
  if (serialized instanceof ArrayBuffer) return serialized;
  return concatBuffers(serialized);
}

/**
 * Build a rounded-rectangle solid for a trace.
 * halfWidthMm: half the width of the trace in mm (may be reduced for clearance).
 * heightMm: extrusion height.
 * zOffsetMm: z position of the BOTTOM face of the solid.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTraceSolid(
  trace: Trace,
  halfWidthMm: number,
  heightMm: number,
  zOffsetMm: number,
  toMm: (v: number) => number,
  segments: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const x1 = toMm(trace.x1), y1 = -toMm(trace.y1);
  const x2 = toMm(trace.x2), y2 = -toMm(trace.y2);
  const h = halfWidthMm;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const zCenter = zOffsetMm + heightMm / 2;

  if (len < 1e-9) {
    return translate([x1, y1, zCenter], cylinder({ radius: h, height: heightMm, segments }));
  }

  const bar = translate(
    [midX, midY, zCenter],
    rotate([0, 0, angle], cuboid({ size: [len, h * 2, heightMm] }))
  );
  const capA = translate([x1, y1, zCenter], cylinder({ radius: h, height: heightMm, segments }));
  const capB = translate([x2, y2, zCenter], cylinder({ radius: h, height: heightMm, segments }));
  return union(bar, capA, capB);
}

/**
 * Extrude a groundfill polygon.
 * contours[0] = outer boundary, contours[1..] = holes.
 * Returns null if the polygon has no usable points.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGroundFillSolid(gf: GroundFill, heightMm: number, zOffset: number, toMm: (v: number) => number): any | null {
  if (gf.contours.length === 0) return null;

  const allPoints: [number, number][] = [];
  const paths: number[][] = [];

  for (const contour of gf.contours) {
    if (contour.length < 3) continue;
    const start = allPoints.length;
    for (const [x, y] of contour) {
      allPoints.push([toMm(x), -toMm(y)]); // negate Y: SVG Y-down → JSCAD Y-up
    }
    paths.push(Array.from({ length: contour.length }, (_, i) => start + i));
  }

  if (allPoints.length < 3) return null;

  const poly2d = polygon({ points: allPoints, paths });
  return translate([0, 0, zOffset], extrudeLinear({ height: heightMm }, poly2d));
}

export async function buildStls(model: BoardModel, options: PrinterOptions): Promise<StlOutputs> {
  const toMm = (svgVal: number) => svgVal / model.svgUnitsPerMm;

  const { boardRect, traces, pads } = model;
  const t = options.boardThicknessMm;
  const recess = options.traceRecessMm;
  const clearance = options.traceClearanceMm;
  const pressT = options.pressThicknessMm;
  const segments = options.traceSegments;

  const boardW = toMm(boardRect.w);
  const boardH = toMm(boardRect.h);
  const boardCx = toMm(boardRect.x) + boardW / 2;
  const boardCy = -(toMm(boardRect.y) + boardH / 2);

  // ── PCB ──────────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let boardSolid: any = extrudeLinear(
    { height: t },
    rectangle({ size: [boardW, boardH], center: [boardCx, boardCy] })
  );

  // Drill holes: cylinder is Z-centred, so translate to t/2 to span 0..t fully.
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = toMm(pad.drillRadius);
    boardSolid = subtract(boardSolid,
      translate([cx, cy, t / 2], cylinder({ radius: r, height: t + 0.1, segments }))
    );
  }

  // Trace channels recessed from the top face.
  if (recess > 0) {
    for (const trace of traces) {
      const hw = toMm(trace.strokeWidth) / 2;
      const channel = makeTraceSolid(trace, hw, recess, t - recess, toMm, segments);
      boardSolid = subtract(boardSolid, channel);
    }
  }

  // ── PRESS ─────────────────────────────────────────────────────────────
  //
  // Geometry (z=0 = pressing face, bumps point downward when flipped for use):
  //
  //   z = pressT + recess  ┐
  //                            │  bumps (trace-width - clearance, height = recess)
  //   z = pressT           ┤  ← bottom face of backing plate / top of bumps
  //                            │
  //   z = 0                    ┘  ← top face of backing plate (print-bed side)
  //
  // To use: flip the press so bumps face down, align over pcb, press in.

  // Backing plate (board footprint, full pressT height).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pressSolid: any = extrudeLinear(
    { height: pressT },
    rectangle({ size: [boardW, boardH], center: [boardCx, boardCy] })
  );

  // Bumps protruding from the bottom face (z = pressT) of the backing plate.
  if (recess > 0) {
    for (const trace of traces) {
      const hw = Math.max(0.1, toMm(trace.strokeWidth) / 2 - clearance / 2);
      const bump = makeTraceSolid(trace, hw, recess, pressT, toMm, segments);
      pressSolid = union(pressSolid, bump);
    }
  }

  // Clearance holes through the press at each pad position so the drill pins
  // pass through cleanly when pressing.
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = toMm(pad.drillRadius);
    pressSolid = subtract(pressSolid,
      translate([cx, cy, pressT / 2],
        cylinder({ radius: r, height: pressT + recess + 0.1, segments })
      )
    );
  }

  const pcbArr = serialize({ binary: true }, boardSolid) as ArrayBuffer | ArrayBuffer[];
  const pressArr = serialize({ binary: true }, pressSolid) as ArrayBuffer | ArrayBuffer[];

  return {
    pcb: toArrayBuffer(pcbArr),
    press: toArrayBuffer(pressArr),
  };
}
