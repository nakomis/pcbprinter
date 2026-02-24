/**
 * Parser for Fritzing .fz project files.
 *
 * COORDINATE SYSTEM NOTE: In Fritzing's .fz format the PCB view uses scene coordinates
 * in 72-DPI pixels (2.834 units/mm). Board and component positions in pcbView are correct
 * PCB scene coordinates. WireModuleID pcbView geometry may store breadboard coordinates
 * instead of PCB coordinates in some Fritzing versions — if traces appear misaligned,
 * export the SVG from Fritzing and use parseFritzingSvg instead.
 *
 * Ground fills are NOT stored in .fz (only in the exported SVG) — always empty here.
 */

import type { BoardModel, Pad, Trace } from './types.js';
import { DOMParser } from '@xmldom/xmldom';

/** Fritzing internal units per mm (72 DPI). */
const FZ_UNITS_PER_MM = 2.834645669;

/** Parse a physical size attribute like "6.5564cm", "87.5mm", "2.58in" → mm. */
function parsePhysicalSize(attr: string): number | null {
  const m = attr.trim().match(/^([\d.]+)\s*(cm|mm|in)?$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] ?? 'mm').toLowerCase();
  if (u === 'cm') return v * 10;
  if (u === 'in') return v * 25.4;
  return v; // mm
}

/** Get first child element with a given tag name. */
function firstChild(el: Element, tag: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i] as Element;
    if (n.nodeType === 1 && n.tagName === tag) return n;
  }
  return null;
}

/** Iterate all elements with a given tag name anywhere under el. */
function* allDescendants(el: Element, tag: string): Generator<Element> {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i] as Element;
    if (n.nodeType !== 1) continue;
    if (n.tagName === tag) yield n;
    yield* allDescendants(n, tag);
  }
}

/**
 * Parse a Fritzing .fz XML string and return a BoardModel.
 *
 * All returned coordinates are in millimetres; svgUnitsPerMm is set to 1
 * so the rest of the pipeline (stlWriter) works without further scaling.
 */
export function parseFritzingFz(fzSource: string): BoardModel {
  const doc = new DOMParser().parseFromString(fzSource, 'text/xml');
  const root = doc.documentElement as unknown as Element;

  // ── 1. Board dimensions ──────────────────────────────────────────────────
  let boardWmm = 0;
  let boardHmm = 0;

  const boardsEl = firstChild(root, 'boards');
  if (boardsEl) {
    const boardEl = firstChild(boardsEl, 'board');
    if (boardEl) {
      const w = boardEl.getAttribute('width');
      const h = boardEl.getAttribute('height');
      if (w) boardWmm = parsePhysicalSize(w) ?? 0;
      if (h) boardHmm = parsePhysicalSize(h) ?? 0;
    }
  }

  // ── 2. Board position (PCB scene origin for the board module) ────────────
  // The board module's pcbView geometry gives the board top-left corner in
  // Fritzing scene coordinates (72 DPI = 2.834645 units/mm).
  let boardOriginX = 0; // Fritzing units
  let boardOriginY = 0;

  const instancesEl = firstChild(root, 'instances');
  if (instancesEl) {
    for (const inst of allDescendants(instancesEl, 'instance')) {
      const moduleIdRef = inst.getAttribute('moduleIdRef') ?? '';
      if (!moduleIdRef.includes('PCBModuleID')) continue;
      for (const pcbView of allDescendants(inst, 'pcbView')) {
        const geomEl = firstChild(pcbView, 'geometry');
        if (geomEl) {
          boardOriginX = parseFloat(geomEl.getAttribute('x') ?? '0');
          boardOriginY = parseFloat(geomEl.getAttribute('y') ?? '0');
        }
        break;
      }
      break;
    }
  }

  // Conversion helper: Fritzing scene units → mm relative to board origin
  const toMmX = (fzX: number) => (fzX - boardOriginX) / FZ_UNITS_PER_MM;
  const toMmY = (fzY: number) => (fzY - boardOriginY) / FZ_UNITS_PER_MM;

  // Board rect in mm (origin at 0,0; all coords relative to board top-left)
  const boardRect = { x: 0, y: 0, w: boardWmm, h: boardHmm };

  // ── 3. Traces from WireModuleID instances ────────────────────────────────
  const traces: Trace[] = [];
  const padMap = new Map<string, Pad>(); // key = "x,y" for dedup

  if (instancesEl) {
    for (const inst of allDescendants(instancesEl, 'instance')) {
      const moduleIdRef = inst.getAttribute('moduleIdRef') ?? '';
      if (moduleIdRef !== 'WireModuleID') continue;

      // Find pcbView with a copper trace layer
      for (const pcbView of allDescendants(inst, 'pcbView')) {
        const layer = pcbView.getAttribute('layer') ?? '';
        if (!layer.includes('trace')) continue;

        const geomEl = firstChild(pcbView, 'geometry');
        const wireEl = firstChild(pcbView, 'wireExtras');
        if (!geomEl || !wireEl) continue;

        const gx = parseFloat(geomEl.getAttribute('x') ?? '0');
        const gy = parseFloat(geomEl.getAttribute('y') ?? '0');
        const gx1 = parseFloat(geomEl.getAttribute('x1') ?? '0');
        const gy1 = parseFloat(geomEl.getAttribute('y1') ?? '0');
        const gx2 = parseFloat(geomEl.getAttribute('x2') ?? '0');
        const gy2 = parseFloat(geomEl.getAttribute('y2') ?? '0');
        const mils = parseFloat(wireEl.getAttribute('mils') ?? '0');
        const color = wireEl.getAttribute('color') ?? '#f2c600';

        if (mils <= 0) continue;

        const x1mm = toMmX(gx + gx1);
        const y1mm = toMmY(gy + gy1);
        const x2mm = toMmX(gx + gx2);
        const y2mm = toMmY(gy + gy2);
        const strokeWidthMm = mils * 0.0254;

        traces.push({ x1: x1mm, y1: y1mm, x2: x2mm, y2: y2mm, strokeWidth: strokeWidthMm, color });

        // Add trace endpoints as candidate pad positions
        for (const [ex, ey] of [[x1mm, y1mm], [x2mm, y2mm]] as [number, number][]) {
          const key = `${ex.toFixed(3)},${ey.toFixed(3)}`;
          if (!padMap.has(key)) {
            padMap.set(key, {
              cx: ex,
              cy: ey,
              drillRadius: strokeWidthMm / 2,
              padRadius: strokeWidthMm,
              color,
            });
          }
        }
        break;
      }
    }
  }

  // ── 4. Pads from component pcbView positions ──────────────────────────────
  // Component instances store their PCB-view center in the pcbView geometry.
  // Each connector with x=0,y=0 offset means we don't know the exact pin offset
  // (that lives in the .fzp part file). We add the component center as a pad if
  // it has a pcbView and is not a wire/board/breadboard/schematic-only element.
  //
  // Mounting holes (Hole* parts) appear here with a single pin at the center,
  // which is the most useful case.
  if (instancesEl) {
    for (const inst of allDescendants(instancesEl, 'instance')) {
      const moduleIdRef = inst.getAttribute('moduleIdRef') ?? '';
      // Skip wires, the board, and breadboard-only parts
      if (moduleIdRef === 'WireModuleID') continue;
      if (moduleIdRef.includes('PCBModuleID')) continue;

      for (const pcbView of allDescendants(inst, 'pcbView')) {
        const layer = pcbView.getAttribute('layer') ?? '';
        // Only copper pads, not trace layers
        if (layer.includes('trace') || layer === 'board') continue;

        const geomEl = firstChild(pcbView, 'geometry');
        if (!geomEl) continue;

        const px = parseFloat(geomEl.getAttribute('x') ?? '0');
        const py = parseFloat(geomEl.getAttribute('y') ?? '0');

        // For each connector listed, add it as a pad candidate
        // (using component center since connector offsets are in the .fzp file)
        const connectors = [...allDescendants(pcbView, 'connector')];
        if (connectors.length === 0) continue;

        for (const connector of connectors) {
          const cgeom = firstChild(connector, 'geometry');
          const offX = cgeom ? parseFloat(cgeom.getAttribute('x') ?? '0') : 0;
          const offY = cgeom ? parseFloat(cgeom.getAttribute('y') ?? '0') : 0;

          const cxMm = toMmX(px + offX);
          const cyMm = toMmY(py + offY);

          // Only include if within board bounds (±20% margin to allow overhang)
          const margin = Math.max(boardWmm, boardHmm) * 0.2;
          if (
            cxMm < -margin || cxMm > boardWmm + margin ||
            cyMm < -margin || cyMm > boardHmm + margin
          ) continue;

          const key = `${cxMm.toFixed(3)},${cyMm.toFixed(3)}`;
          if (!padMap.has(key)) {
            padMap.set(key, {
              cx: cxMm,
              cy: cyMm,
              drillRadius: 0.65, // 1.3mm diameter default drill
              padRadius: 1.0,
              color: '#f2c600',
            });
          }
          break; // Only add first connector position per component pcbView group
        }
        break; // Only process first pcbView per instance
      }
    }
  }

  const pads: Pad[] = [...padMap.values()];

  return {
    svgUnitsPerMm: 1,
    boardRect,
    traces,
    pads,
    footprintCircles: [],
    groundFills: [],
    textLabels: [],
  };
}
