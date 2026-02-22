import type { BoardModel, PrinterOptions, Trace } from './types.js';
import jscad from '@jscad/modeling';
import { serialize } from '@jscad/stl-serializer';

const { primitives, booleans, transforms, extrusions } = jscad;
const { cylinder, cuboid, rectangle } = primitives;
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
  if (serialized instanceof ArrayBuffer) {
    return serialized;
  }
  return concatBuffers(serialized);
}

function makeTraceSolid(
  trace: Trace,
  heightMm: number,
  zOffsetMm: number,
  toMm: (v: number) => number,
  segments: number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const x1 = toMm(trace.x1), y1 = -toMm(trace.y1);
  const x2 = toMm(trace.x2), y2 = -toMm(trace.y2);
  const h = toMm(trace.strokeWidth) / 2;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const z = zOffsetMm + heightMm / 2;

  if (len < 1e-9) {
    return translate([x1, y1, z], cylinder({ radius: h, height: heightMm, segments }));
  }

  const bar = translate(
    [midX, midY, z],
    rotate([0, 0, angle], cuboid({ size: [len, h * 2, heightMm] }))
  );
  const capA = translate([x1, y1, z], cylinder({ radius: h, height: heightMm, segments }));
  const capB = translate([x2, y2, z], cylinder({ radius: h, height: heightMm, segments }));
  return union(bar, capA, capB);
}

export async function buildStls(model: BoardModel, options: PrinterOptions): Promise<StlOutputs> {
  const toMm = (svgVal: number) => svgVal / model.svgUnitsPerMm;

  const { boardRect, traces, pads } = model;
  const t = options.boardThicknessMm;
  const th = options.traceHeightMm;
  const segments = options.traceSegments;

  const boardW = toMm(boardRect.w);
  const boardH = toMm(boardRect.h);
  const boardCx = toMm(boardRect.x) + boardW / 2;
  const boardCy = -(toMm(boardRect.y) + boardH / 2);

  // Build pcb board solid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let boardSolid: any = extrudeLinear(
    { height: t },
    rectangle({ size: [boardW, boardH], center: [boardCx, boardCy] })
  );

  // Subtract drill holes
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = toMm(pad.drillRadius);
    const drillCyl = translate(
      [cx, cy, -0.05],
      cylinder({ radius: r, height: t + 0.1, segments })
    );
    boardSolid = subtract(boardSolid, drillCyl);
  }

  // Optionally recess trace channels into board
  if (options.traceRecessMm > 0) {
    for (const trace of traces) {
      const channel = makeTraceSolid(trace, options.traceRecessMm, t - options.traceRecessMm, toMm, segments);
      boardSolid = subtract(boardSolid, channel);
    }
  }

  // Build press solid (traces + pads on top of board)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presss: any[] = [];

  for (const trace of traces) {
    presss.push(makeTraceSolid(trace, th, t, toMm, segments));
  }

  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const pr = toMm(pad.padRadius);
    const dr = toMm(pad.drillRadius);
    const padDisc = translate(
      [cx, cy, t + th / 2],
      cylinder({ radius: pr, height: th, segments })
    );
    const drillHole = translate(
      [cx, cy, t - 0.05],
      cylinder({ radius: dr, height: th + 0.1, segments })
    );
    presss.push(subtract(padDisc, drillHole));
  }

  if (presss.length === 0) {
    throw new Error('No traces or pads found — nothing to put in press STL');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pressSolid: any = presss.length === 1
    ? presss[0]
    : union(...presss);

  const pcbArr = serialize({ binary: true }, boardSolid) as ArrayBuffer | ArrayBuffer[];
  const pressArr = serialize({ binary: true }, pressSolid) as ArrayBuffer | ArrayBuffer[];

  const pcb = toArrayBuffer(pcbArr);
  const press = toArrayBuffer(pressArr);

  return { pcb, press };
}
