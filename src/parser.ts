import type { BoardModel, Pad, Trace, FootprintCircle, Rect, GroundFill, TextLabel } from './types.js';
import type { PrinterOptions } from './types.js';
import { DOMParser } from '@xmldom/xmldom';
import { identity, multiply, applyToPoint, parseSvgTransform } from './transform.js';
import type { Matrix3 } from './transform.js';

/** Convert a physical SVG width value (e.g. "2.02928in") to millimetres. */
function physicalWidthToMm(attr: string): number | null {
  const match = attr.trim().match(/^([\d.]+)\s*(in|mm|cm|px)?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  switch (unit) {
    case 'in': return value * 25.4;
    case 'mm': return value;
    case 'cm': return value * 10;
    case 'px':
    default:
      return (value / 96) * 25.4; // 96 dpi
  }
}

/** Parse stroke-width attribute, handling px/pt units. */
function parseStrokeWidth(attr: string | null): number {
  if (!attr) return 1;
  const match = attr.trim().match(/^([\d.]+)\s*(px|pt)?$/i);
  if (!match) return 1;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  if (unit === 'pt') return value * 1.333;
  return value; // px or unitless = SVG user units
}

/** Get the effective fill from an element, checking the element itself only. */
function getElementFill(el: Element): string | null {
  return el.getAttribute('fill');
}

/** Get the effective fill, walking up to parent if needed. */
function getFill(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const fill = node.getAttribute('fill');
    if (fill) return fill;
    node = node.parentElement ?? null;
  }
  return 'none';
}

/** Get the stroke attribute from an element. */
function getStroke(el: Element): string {
  const stroke = el.getAttribute('stroke');
  return stroke ?? '#000000';
}

/** Check if the id contains 'label' (case-insensitive). */
function idContainsLabel(id: string | null): boolean {
  if (!id) return false;
  return id.toLowerCase().includes('label');
}

/** Compute a transform matrix from an element's transform attribute, applying it to a parent matrix. */
function computeTransform(el: Element, parentTransform: Matrix3): Matrix3 {
  const transformAttr = el.getAttribute('transform');
  if (!transformAttr) return parentTransform;
  const local = parseSvgTransform(transformAttr);
  return multiply(parentTransform, local);
}

/** Recursively collect lines and circles from a copper group.
 *  parentTransform: the transform already accumulated from all ancestors (NOT including this node's own transform).
 */
function collectFromCopper(
  node: Element,
  parentTransform: Matrix3,
  svgUnitsPerMm: number,
  options: PrinterOptions,
  traces: Trace[],
  pads: Pad[],
  footprintCircles: FootprintCircle[],
): void {
  const id = node.getAttribute('id') ?? '';
  // Skip label and silkscreen subgroups even inside copper
  if (idContainsLabel(id) || id.toLowerCase() === 'silkscreen') return;

  // Apply this node's own transform
  const transform = computeTransform(node, parentTransform);

  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Element;
    if (child.nodeType !== 1) continue;

    const tag = child.tagName;

    if (tag === 'line') {
      const x1 = parseFloat(child.getAttribute('x1') ?? '0');
      const y1 = parseFloat(child.getAttribute('y1') ?? '0');
      const x2 = parseFloat(child.getAttribute('x2') ?? '0');
      const y2 = parseFloat(child.getAttribute('y2') ?? '0');
      const [tx1, ty1] = applyToPoint(transform, x1, y1);
      const [tx2, ty2] = applyToPoint(transform, x2, y2);
      const strokeWidthRaw = child.getAttribute('stroke-width');
      const strokeWidth = parseStrokeWidth(strokeWidthRaw);
      // Apply scale to stroke width (use the x-scale component of the current transform)
      const scaledStrokeWidth = strokeWidth * Math.abs(transform[0]);
      const color = getStroke(child);
      traces.push({ x1: tx1, y1: ty1, x2: tx2, y2: ty2, strokeWidth: scaledStrokeWidth, color });
    } else if (tag === 'circle') {
      const cx = parseFloat(child.getAttribute('cx') ?? '0');
      const cy = parseFloat(child.getAttribute('cy') ?? '0');
      const r = parseFloat(child.getAttribute('r') ?? '0');
      const [tcx, tcy] = applyToPoint(transform, cx, cy);
      // Scale the radius using the x-scale component of the transform
      const scaledR = r * Math.abs(transform[0]);
      // All circles inside copper groups are through-hole pads in Fritzing SVGs.
      // Use stroke colour if present (Fritzing uses fill="none" + stroke for copper rings),
      // otherwise fall back to fill.
      const stroke = child.getAttribute('stroke');
      const fill = child.getAttribute('fill');
      const color = (stroke && stroke !== 'none') ? stroke : (fill && fill !== 'none') ? fill : '#f2c600';
      const drillRadius = (options.drillDiameterMm / 2) * svgUnitsPerMm;
      pads.push({
        cx: tcx,
        cy: tcy,
        drillRadius,
        padRadius: scaledR,
        color,
      });
    } else if (tag === 'g') {
      // Recurse into nested groups, passing this node's accumulated transform
      collectFromCopper(child, transform, svgUnitsPerMm, options, traces, pads, footprintCircles);
    }
  }
}

/** Walk the DOM, collecting traces/pads/footprintCircles.
 *  parentTransform: the transform accumulated from all ancestors (NOT including this node's own transform).
 */
function walkGroup(
  node: Element,
  parentTransform: Matrix3,
  svgUnitsPerMm: number,
  options: PrinterOptions,
  traces: Trace[],
  pads: Pad[],
  footprintCircles: FootprintCircle[],
  boardRect: { value: Rect | null },
): void {
  const id = node.getAttribute('id') ?? '';

  // Skip watermark, silkscreen, and label groups entirely
  if (
    id.toLowerCase() === 'watermark' ||
    id.toLowerCase() === 'silkscreen' ||
    idContainsLabel(id)
  ) {
    return;
  }

  // Apply this node's own transform
  const transform = computeTransform(node, parentTransform);

  const isBoard = id.toLowerCase() === 'board';
  const isCopper = id.toLowerCase().startsWith('copper');

  // If this is the board group, find the first rect child
  if (isBoard && boardRect.value === null) {
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Element;
      if (child.nodeType === 1 && child.tagName === 'rect') {
        const x = parseFloat(child.getAttribute('x') ?? '0');
        const y = parseFloat(child.getAttribute('y') ?? '0');
        const w = parseFloat(child.getAttribute('width') ?? '0');
        const h = parseFloat(child.getAttribute('height') ?? '0');
        const [tx, ty] = applyToPoint(transform, x, y);
        // For width/height: transform the opposite corner and compute difference
        const [tx2, ty2] = applyToPoint(transform, x + w, y + h);
        boardRect.value = {
          x: tx,
          y: ty,
          w: tx2 - tx,
          h: ty2 - ty,
        };
        break;
      }
    }
  }

  // If this is a copper group, collect circles (pads) from it
  if (isCopper) {
    collectFromCopper(node, parentTransform, svgUnitsPerMm, options, traces, pads, footprintCircles);
    return;
  }

  // Collect <line> elements that are direct children of any non-excluded group
  // (Fritzing places traces as top-level <g partID="..."><line .../></g> outside copper groups)
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Element;
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'line') {
      const x1 = parseFloat(child.getAttribute('x1') ?? '0');
      const y1 = parseFloat(child.getAttribute('y1') ?? '0');
      const x2 = parseFloat(child.getAttribute('x2') ?? '0');
      const y2 = parseFloat(child.getAttribute('y2') ?? '0');
      const [tx1, ty1] = applyToPoint(transform, x1, y1);
      const [tx2, ty2] = applyToPoint(transform, x2, y2);
      const strokeWidth = parseStrokeWidth(child.getAttribute('stroke-width'));
      const scaledStrokeWidth = strokeWidth * Math.abs(transform[0]);
      const color = getStroke(child);
      traces.push({ x1: tx1, y1: ty1, x2: tx2, y2: ty2, strokeWidth: scaledStrokeWidth, color });
    } else if (child.tagName === 'g') {
      walkGroup(child, transform, svgUnitsPerMm, options, traces, pads, footprintCircles, boardRect);
    }
  }
}

/**
 * Parse an SVG path `d` string containing only M, L, Z commands (as Fritzing exports)
 * into an array of contours. Each contour is a closed list of [x,y] points.
 * The accumulated transform is applied to each point.
 */
function parseSvgPathToContours(d: string, transform: Matrix3): Array<[number, number][]> {
  const contours: Array<[number, number][]> = [];
  let current: [number, number][] = [];

  // Tokenise: split on command letters, keeping the letter
  const tokens = d.trim().split(/(?=[MmLlHhVvZz])/);

  for (const token of tokens) {
    if (!token.trim()) continue;
    const cmd = token[0];
    const nums = token.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);

    if (cmd === 'M' || cmd === 'm') {
      // Start a new sub-path
      if (current.length > 0) contours.push(current);
      current = [];
      // Remaining pairs after the first are implicit L/l commands
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const [tx, ty] = applyToPoint(transform, nums[i], nums[i + 1]);
        current.push([tx, ty]);
      }
    } else if (cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const [tx, ty] = applyToPoint(transform, nums[i], nums[i + 1]);
        current.push([tx, ty]);
      }
    } else if (cmd === 'l') {
      // Relative lineto — need current position
      let [cx, cy] = current.length > 0 ? current[current.length - 1] : [0, 0];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        // Undo transform to get pre-transform position, add delta, re-transform
        // Simpler: track pre-transform cursor separately
        // Since we process absolute coords after transform, relative needs pre-transform cursor
        // We'll keep a raw cursor for relative commands
        cx += nums[i]; cy += nums[i + 1];
        const [tx, ty] = applyToPoint(transform, cx, cy);
        current.push([tx, ty]);
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      if (current.length > 0) {
        contours.push(current);
        current = [];
      }
    }
    // H, V, C, Q, A not expected from Fritzing exports; silently skip
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

/**
 * Collect groundplane paths from a <g id="groundplane"> element and its subtree.
 * The element's own transform (if any) should already be incorporated into `transform`.
 */
function collectGroundFills(
  node: Element,
  transform: Matrix3,
  groundFills: GroundFill[],
): void {
  const id = node.getAttribute('id') ?? '';
  const isGroundplane = id.toLowerCase() === 'groundplane';
  const nodeTransform = computeTransform(node, transform);

  if (isGroundplane) {
    // Collect all <path> children
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Element;
      if (child.nodeType !== 1 || child.tagName !== 'path') continue;
      const d = child.getAttribute('d');
      if (!d) continue;
      const fill = child.getAttribute('fill') ?? '#f9a435';
      const contours = parseSvgPathToContours(d, nodeTransform);
      if (contours.length > 0) {
        groundFills.push({ contours, color: fill });
      }
    }
    return;
  }

  // Recurse into child groups
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Element;
    if (child.nodeType === 1 && child.tagName === 'g') {
      collectGroundFills(child, nodeTransform, groundFills);
    }
  }
}

/**
 * Walk the DOM collecting silkscreen text labels from <g id="silkscreenLabel"> groups.
 * The accumulated transform through all ancestor <g> elements is passed down so that
 * each glyph point can be mapped to SVG global coordinates by the caller.
 */
function collectTextLabels(
  node: Element,
  parentTransform: Matrix3,
  textLabels: TextLabel[],
): void {
  const id = node.getAttribute('id') ?? '';
  const transform = computeTransform(node, parentTransform);

  if (id === 'silkscreenLabel') {
    const fontSizeAttr = node.getAttribute('font-size');
    const fontSize = fontSizeAttr ? parseFloat(fontSizeAttr) : 5;
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i] as Element;
      if (child.nodeType !== 1 || child.tagName !== 'text') continue;
      const text = (child.textContent ?? '').trim();
      if (!text) continue;
      const textX = parseFloat(child.getAttribute('x') ?? '0');
      const textY = parseFloat(child.getAttribute('y') ?? String(fontSize));
      textLabels.push({ text, fontSize, textX, textY, matrix: transform });
    }
    return;
  }

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i] as Element;
    if (child.nodeType === 1 && child.tagName === 'g') {
      collectTextLabels(child, transform, textLabels);
    }
  }
}

/** Deduplicate pads: if two pad centres are within 0.1 SVG units, keep one. */
function deduplicatePads(pads: Pad[]): Pad[] {
  const result: Pad[] = [];
  for (const pad of pads) {
    const duplicate = result.some(p => {
      const dx = p.cx - pad.cx;
      const dy = p.cy - pad.cy;
      return Math.sqrt(dx * dx + dy * dy) < 0.1;
    });
    if (!duplicate) {
      result.push(pad);
    }
  }
  return result;
}

export function parseFritzingSvg(svgSource: string, options: PrinterOptions): BoardModel {
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const svgEl = doc.documentElement as unknown as Element;

  // Determine svgUnitsPerMm
  let svgUnitsPerMm = 3.7795; // fallback: 96 dpi
  const widthAttr = svgEl.getAttribute('width');
  const viewBoxAttr = svgEl.getAttribute('viewBox');

  if (widthAttr && viewBoxAttr) {
    const physicalMm = physicalWidthToMm(widthAttr);
    const viewBoxParts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
    if (physicalMm && physicalMm > 0 && viewBoxParts.length >= 4) {
      const viewBoxWidth = viewBoxParts[2];
      svgUnitsPerMm = viewBoxWidth / physicalMm;
    }
  }

  const traces: Trace[] = [];
  const pads: Pad[] = [];
  const footprintCircles: FootprintCircle[] = [];
  const groundFills: GroundFill[] = [];
  const textLabels: TextLabel[] = [];
  const boardRect: { value: Rect | null } = { value: null };

  const rootTransform = identity();

  // Walk top-level elements
  const children = svgEl.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Element;
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'g') {
      walkGroup(child, rootTransform, svgUnitsPerMm, options, traces, pads, footprintCircles, boardRect);
      collectGroundFills(child, rootTransform, groundFills);
      collectTextLabels(child, rootTransform, textLabels);
    } else if (child.tagName === 'text' && idContainsLabel(child.getAttribute('id'))) {
      // Top-level <text id="label"> elements (e.g. {version} placeholder in Fritzing SVGs)
      const text = (child.textContent ?? '').trim();
      if (text) {
        const fontSizeAttr = child.getAttribute('font-size');
        const fontSize = fontSizeAttr ? parseFloat(fontSizeAttr) : 5;
        const textX = parseFloat(child.getAttribute('x') ?? '0');
        const textY = parseFloat(child.getAttribute('y') ?? String(fontSize));
        textLabels.push({ text, fontSize, textX, textY, matrix: rootTransform });
      }
    }
  }

  const dedupedPads = deduplicatePads(pads);

  return {
    svgUnitsPerMm,
    boardRect: boardRect.value ?? { x: 0, y: 0, w: 0, h: 0 },
    traces,
    pads: dedupedPads,
    footprintCircles,
    groundFills,
    textLabels,
  };
}
