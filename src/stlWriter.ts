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

    // Face normal via cross product (now correct for CCW-from-outside convention)
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
 * Build a rounded-rectangle (capsule) solid for a trace using manifold-3d.
 * zOffsetMm: z position of the BOTTOM face of the solid.
 * Manifold.cylinder with center=true is used so the caps are Z-centred at zCenter.
 * Note: manifold-3d rotate() takes DEGREES, not radians.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTraceSolid(M: any, trace: Trace, halfWidthMm: number, heightMm: number, zOffsetMm: number, toMm: (v: number) => number, segments: number): any {
  const x1 = toMm(trace.x1), y1 = -toMm(trace.y1);
  const x2 = toMm(trace.x2), y2 = -toMm(trace.y2);
  const h = halfWidthMm;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const zCenter = zOffsetMm + heightMm / 2;

  // center=true → cylinder is Z-centred, so translate to zCenter positions it correctly
  const capA = M.cylinder(heightMm, h, h, segments, true).translate([x1, y1, zCenter]);
  const capB = M.cylinder(heightMm, h, h, segments, true).translate([x2, y2, zCenter]);
  if (len < 1e-9) return capA;

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const bar = M.cube([len, h * 2, heightMm], true)
    .rotate([0, 0, angleDeg])
    .translate([midX, midY, zCenter]);
  return bar.add(capA).add(capB);
}

/**
 * Extrude a groundfill polygon using manifold-3d CrossSection.
 * contours[0] = outer boundary, contours[1..] = holes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGroundFillSolid(CS: any, gf: GroundFill, heightMm: number, zOffset: number, toMm: (v: number) => number): any | null {
  if (gf.contours.length === 0) return null;
  const contours = gf.contours
    .filter(c => c.length >= 3)
    .map(c => c.map(([x, y]) => [toMm(x), -toMm(y)] as [number, number]));
  if (contours.length === 0) return null;
  try {
    const cs = new CS(contours);
    if (cs.isEmpty()) return null;
    return cs.extrude(heightMm).translate([0, 0, zOffset]);
  } catch {
    return null;
  }
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

  // Set global circular segment count for manifold-3d primitives
  wasm.setCircularSegments(segments);

  const boardW = toMm(boardRect.w);
  const boardH = toMm(boardRect.h);
  const boardCx = toMm(boardRect.x) + boardW / 2;
  const boardCy = -(toMm(boardRect.y) + boardH / 2);

  // ── PCB ──────────────────────────────────────────────────────────────────
  //
  // Build the 2D cross-section first (board outline minus drill holes) then
  // extrude. CrossSection.extrude() guarantees a clean bottom face at z=0
  // with correct outward (-Z) normals — avoiding the degenerate-triangle issue
  // that 3D cube().subtract(cylinder) produces at the z=0 boundary.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let boardProfile: any = CS.square([boardW, boardH], true).translate([boardCx, boardCy]);
  for (const pad of pads) {
    const cx = toMm(pad.cx);
    const cy = -toMm(pad.cy);
    const r = toMm(pad.drillRadius);
    boardProfile = boardProfile.subtract(CS.circle(r, segments).translate([cx, cy]));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let board: any = boardProfile.extrude(t);

  // Trace channels recessed from the top face (3D subtract, only touches z≈t).
  // Extend by 0.05 mm above z=t so the channel solid is never exactly coplanar
  // with the board top face — coplanar CSG produces degenerate triangles / non-manifold edges.
  const eps = 0.05;
  if (recess > 0) {
    for (const trace of traces) {
      const hw = toMm(trace.strokeWidth) / 2;
      board = board.subtract(makeTraceSolid(M, trace, hw, recess + eps, t - recess, toMm, segments));
    }
  }

  // Groundfill channels.
  for (const gf of groundFills) {
    const solid = makeGroundFillSolid(CS, gf, recess + eps, t - recess, toMm);
    if (solid) board = board.subtract(solid);
  }

  // ── PRESS ─────────────────────────────────────────────────────────────
  //
  //   z = pressT + pinHeight  ┐  alignment pins (fit into pcb drill holes)
  //   z = pressT + recess     ┤  top of bumps
  //   z = pressT              ┤  pressing face / bottom of bumps
  //                               │  backing plate
  //   z = 0                       ┘  flat back (print-bed face)
  //
  // Same 2D-extrude approach for the backing plate; bumps/pins added via 3D union.
  // Mirror around board X centre before export (press is flipped over for use).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let press: any = CS.square([boardW, boardH], true).translate([boardCx, boardCy]).extrude(pressT);

  // Trace bumps protruding from the pressing face.
  // Embed eps into the plate (zOffset = pressT - eps, height = recess + eps) so the
  // bump pcb is never exactly coplanar with the press top face.
  if (recess > 0) {
    for (const trace of traces) {
      const hw = Math.max(0.1, toMm(trace.strokeWidth) / 2 - clearance / 2);
      press = press.add(makeTraceSolid(M, trace, hw, recess + eps, pressT - eps, toMm, segments));
    }
  }

  // Alignment pins at each pad position — fit into pcb drill holes to locate press.
  // Embed eps into the plate for the same coplanarity reason.
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
