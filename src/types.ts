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
  /** Silkscreen text labels to be rendered as raised relief on the pcb. */
  textLabels?: TextLabel[];
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

/**
 * A silkscreen text label parsed from the SVG.
 * Glyph points from opentype.js (in SVG user units, y-down) are transformed
 * by `matrix` to get SVG global coordinates, then divided by svgUnitsPerMm
 * and y-flipped to reach manifold mm space.
 */
export interface TextLabel {
  text: string;
  /** Font size in SVG user units (in local coordinate space, before matrix). */
  fontSize: number;
  /** Baseline origin in the silkscreenLabel group's local space (usually 0, fontSize). */
  textX: number;
  textY: number;
  /** Accumulated row-major 3×3 affine transform (same layout as Matrix3 in transform.ts). */
  matrix: [number,number,number, number,number,number, number,number,number];
}

export interface PrinterOptions {
  outDir: string;
  writeSvg: boolean;
  boardColor: string;
  boardThicknessMm: number;
  traceRecessMm: number;
  /** How much narrower (total, in mm) press bumps are vs pcb channels. */
  traceClearanceMm: number;
  /** Width of the chamfer step at the top of each press bump (0 = no chamfer). */
  bumpChamferMm: number;
  /** Thickness of the solid press backing plate in mm. */
  pressThicknessMm: number;
  /** Depth (sagitta) of the finger-indent notch on each side of the press in mm (0 = none).
   *  Chord is fixed at 20 mm; this controls how far the arc cuts into the plate. */
  fingerIndentMm: number;
  /** Height of raised text relief on pcb top face in mm (0 = no text). */
  textReliefMm: number;
  /** Path to a TTF/OTF font file for text rendering (CLI only; resolved before calling buildStls). */
  fontPath?: string;
  /** Pre-loaded font binary data for text rendering (pass ArrayBuffer from any source). */
  fontData?: ArrayBuffer;
  drillDiameterMm: number;
  snapToleranceMm: number;
  traceSegments: number;
}

export const DEFAULT_OPTIONS: PrinterOptions = {
  outDir: '.',
  writeSvg: false,
  boardColor: '#03A550',
  boardThicknessMm: 3,
  traceRecessMm: 0.6,
  traceClearanceMm: 0.1,
  bumpChamferMm: 0.2,
  pressThicknessMm: 10,
  fingerIndentMm: 4,
  textReliefMm: 0,
  drillDiameterMm: 1.3,
  snapToleranceMm: 1.5,
  traceSegments: 32,
};
