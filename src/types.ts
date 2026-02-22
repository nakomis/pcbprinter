/** All coordinates are in absolute SVG user units throughout the internal model.
 *  Conversion to mm happens only in stlWriter. */

export interface BoardModel {
  /** How many SVG user units equal 1 mm (derived from viewBox vs physical size). */
  svgUnitsPerMm: number;
  boardRect: Rect;
  traces: Trace[];
  pads: Pad[];
  /** fill="none" circles kept for SVG visual reference only — not printed. */
  footprintCircles: FootprintCircle[];
  /** Copper groundfill shapes — each is a list of contours (outer + holes) in absolute SVG units. */
  groundFills: GroundFill[];
}

/**
 * A copper groundfill region from a <g id="groundplane"> element.
 * contours[0] is the outer boundary; contours[1..] are holes (if any).
 * All points in absolute SVG user units.
 */
export interface GroundFill {
  contours: Array<[number, number][]>;
  color: string;
}

export interface Rect {
  x: number; y: number; w: number; h: number;
}

export interface Trace {
  x1: number; y1: number;
  x2: number; y2: number;
  /** Stroke width in SVG user units. */
  strokeWidth: number;
  color: string;
}

export interface Pad {
  cx: number; cy: number;
  /** Radius of the drill hole in SVG user units. */
  drillRadius: number;
  /** Radius of the annular copper pad in SVG user units (= trace half-width). */
  padRadius: number;
  color: string;
}

export interface FootprintCircle {
  cx: number; cy: number; r: number;
}

export interface PrinterOptions {
  outDir: string;
  writeSvg: boolean;
  boardColor: string;
  boardThicknessMm: number;
  traceRecessMm: number;
  /** How much narrower (total, in mm) press bumps are vs pcb channels. */
  traceClearanceMm: number;
  /** Thickness of the solid press backing plate in mm. */
  pressThicknessMm: number;
  drillDiameterMm: number;
  snapToleranceMm: number;
  traceSegments: number;
}

export const DEFAULT_OPTIONS: PrinterOptions = {
  outDir: '.',
  writeSvg: false,
  boardColor: '#03A550',
  boardThicknessMm: 1.6,
  traceRecessMm: 0.4,
  traceClearanceMm: 0.6,
  pressThicknessMm: 15,
  drillDiameterMm: 1.0,
  snapToleranceMm: 1.5,
  traceSegments: 32,
};
