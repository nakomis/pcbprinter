import type { BoardModel, PrinterOptions, Trace, GroundFill } from './types.js';
import initManifold from 'manifold-3d';

export interface StlOutputs { pcb: ArrayBuffer; press: ArrayBuffer; }

/**
 * Serialise a manifold-3d Mesh to binary STL.
 * vertProperties layout: [x, y, z, ...extra] with numProp values per vertex.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function meshToStlBuffer(mesh: any): ArrayBuffer {
  const { triVerts, vertProperties, numProp } = mesh;
  const numTris = triVerts.length / 3;
  const buf = new ArrayBuffer(84 + numTris * 50);
  const view = new DataView(buf);
  let off = 80; // 80-byte header is left as zeroes
  view.setUint32(off, numTris, true); off += 4;

  for (let i = 0; i < numTris; i++) {
    const b0 = triVerts[i * 3 + 0] * numProp;
    const b1 = triVerts[i * 3 + 1] * numProp;
    const b2 = triVerts[i * 3 + 2] * numProp;
    const v0x = vertProperties[b0], v0y = vertProperties[b0 + 1], v0z = vertProperties[b0 + 2];
    const v1x = vertProperties[b1], v1y = vertProperties[b1 + 1], v1z = vertProperties[b1 + 2];
    const v2x = vertProperties[b2], v2y = vertProperties[b2 + 1], v2z = vertProperties[b2 + 2];

    // Face normal via cross product (CCW-from-outside → outward normals)
    const ex = v1x - v0x, ey = v1y - v0y, ez = v1z - v0z;
    const fx = v2x - v0x, fy = v2y - v0y, fz = v2z - v0z;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    view.setFloat32(off, nx, true); off += 4;
    view.setFloat32(off, ny, true); off += 4;
    view.setFloat32(off, nz, true); off += 4;
    for (const [vx, vy, vz] of [[v0x, v0y, v0z], [v1x, v1y, v1z], [v2x, v2y, v2z]]) {
      view.setFloat32(off, vx, true); off += 4;
      view.setFloat32(off, vy, true); off += 4;
      view.setFloat32(off, vz, true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return buf;
}

/**
 * Build a 2D rounded-rectangle (stadium) CrossSection for a trace footprint.
 * This is used to union all trace footprints in 2D before extruding to a
 * single channel/bump solid — avoids T-junction non-manifold edges that arise
 * from multiple sequential 3D boolean subtractions at the same z-plane.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTrace2D(CS: any, x1: number, y1: number, x2: number, y2: number, halfWidth: number, segments: number): any {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const capA = CS.circle(halfWidth, segments).translate([x1, y1]);
  if (len < 1e-9) return capA;
  const capB = CS.circle(halfWidth, segments).translate([x2, y2]);
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const bar = CS.square([len, halfWidth * 2], true).rotate(angleDeg).translate([midX, midY]);
  return bar.add(capA).add(capB);
}

/**
 * Build the union of all trace + groundfill footprints as a single 2D CrossSection.
 * Returns null if there are no traces and no ground fills (or recess === 0).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildChannelFootprint2D(
  CS: any,
  traces: Trace[],
  groundFills: GroundFill[],
  halfWidthFn: (t: Trace) => number,
  toMm: (v: number) => number,
  segments: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let footprint: any = null;

  for (const trace of traces) {
    const hw = halfWidthFn(trace);
    const x1 = toMm(trace.x1), y1 = -toMm(trace.y1);
    const x2 = toMm(trace.x2), y2 = -toMm(trace.y2);
    const shape = makeTrace2D(CS, x1, y1, x2, y2, hw, segments);
    footprint = footprint ? footprint.add(shape) : shape;
  }

  for (const gf of groundFills) {
    const contours = gf.contours
      .filter(c => c.length >= 3)
      .map(c => c.map(([x, y]) => [toMm(x), -toMm(y)] as [number, number]));
    if (contours.length === 0) continue;
    try {
      const gf2d = new CS(contours);
      if (!gf2d.isEmpty()) footprint = footprint ? footprint.add(gf2d) : gf2d;
    } catch { /* skip malformed contours */ }
  }

  return footprint;
}

export async function buildStls(model: BoardModel, options: PrinterOptions): Promise<StlOutputs> {
  const wasm = await initManifold();
  wasm.setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const M = (wasm as any).Manifold;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CS = (wasm as any).CrossSection;

  const toMm = (svgVal: number) => svgVal / model.svgUnitsPerMm;
  const { boardRect, traces, pads, groundFills } = model;
  const t = options.boardThicknessMm;
  const recess = options.traceRecessMm;
  const clearance = options.traceClearanceMm;
  const pressT = options.pressThicknessMm;
  const segments = options.traceSegments;

  // eps: small overrun used when subtracting/adding solids that would otherwise
  // create exactly-coplanar faces, which causes degenerate triangles in CSG.
  const eps = 0.05;

  wasm.setCircularSegments(segments);

  const boardW = toMm(boardRect.w);
  const boardH = toMm(boardRect.h);
  const boardCx = toMm(boardRect.x) + boardW / 2;
  const boardCy = -(toMm(boardRect.y) + boardH / 2);

  // ── PCB ──────────────────────────────────────────────────────────────────
  //
  // Strategy: all channel geometry is unioned in 2D first, then extruded to a
  // single 3D solid and subtracted from the board in one operation.  This avoids
  // the T-junction non-manifold edges that arise when many separate 3D channel
  // solids are subtracted sequentially (each one can land edges on the already-
  // triangulated board-top face).
  //
  // The channel solid is extended eps above z=t and eps below z=t-recess so it
  // is never exactly coplanar with any face of the board.

  // 2D board profile: outline minus drill holes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let boardProfile: any = CS.square([boardW, boardH], true).translate([boardCx, boardCy]);
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = toMm(pad.drillRadius);
    boardProfile = boardProfile.subtract(CS.circle(r, segments).translate([cx, cy]));
  }

  // Extrude board profile to full thickness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let board: any = boardProfile.extrude(t);

  // Build channel footprint in 2D then carve with a single 3D subtract
  if (recess > 0) {
    const channelFootprint = buildChannelFootprint2D(
      CS, traces, groundFills,
      (trace) => toMm(trace.strokeWidth) / 2,
      toMm, segments,
    );
    if (channelFootprint) {
      // Extrude from z = t-recess-eps  to  z = t+eps  (overruns both faces)
      const channelSolid = channelFootprint
        .extrude(recess + 2 * eps)
        .translate([0, 0, t - recess - eps]);
      board = board.subtract(channelSolid);
    }
  }

  // ── PRESS ─────────────────────────────────────────────────────────────
  //
  //   z = pressT + pinHeight  ┐  alignment pins (fit into pcb drill holes)
  //   z = pressT + recess     ┤  top of bumps
  //   z = pressT              ┤  pressing face / bottom of bumps
  //                               │  backing plate
  //   z = 0                       ┘  flat back (print-bed face)
  //
  // All trace+fill bump shapes are unioned in 2D first (same as the pcb channel
  // strategy) then a single 3D solid is added to the press plate.  The bump
  // solid is embedded eps below z=pressT so its pcb sits inside the plate
  // rather than exactly on its top face — this breaks the coplanar face and avoids
  // degenerate triangles at the union boundary.
  //
  // Mirror around board X centre before export (press is flipped for use).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let press: any = CS.square([boardW, boardH], true).translate([boardCx, boardCy]).extrude(pressT);

  // Bump solid: 2D footprint extruded, embedded eps into the plate
  if (recess > 0) {
    const bumpFootprint = buildChannelFootprint2D(
      CS, traces, groundFills,
      (trace) => Math.max(0.1, toMm(trace.strokeWidth) / 2 - clearance / 2),
      toMm, segments,
    );
    if (bumpFootprint) {
      const bumpSolid = bumpFootprint
        .extrude(recess + eps)
        .translate([0, 0, pressT - eps]);
      press = press.add(bumpSolid);
    }
  }

  // Alignment pins: cylinders embedded eps below the plate top so there is no
  // coplanar face between the pin pcb and the press top surface.
  const pinHeight = 2.0;
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = Math.max(0.2, toMm(pad.drillRadius) - 0.15);
    press = press.add(
      M.cylinder(pinHeight + eps, r, r, segments).translate([cx, cy, pressT - eps])
    );
  }

  // Mirror around x = boardCx: translate to origin, mirror YZ plane, translate back.
  press = press
    .translate([-boardCx, 0, 0])
    .mirror([1, 0, 0])
    .translate([boardCx, 0, 0]);

  return {
    pcb: meshToStlBuffer(board.getMesh()),
    press: meshToStlBuffer(press.getMesh()),
  };
}
