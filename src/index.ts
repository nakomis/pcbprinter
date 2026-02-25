import versionData from '../version.json' with { type: 'json' };
export const VERSION: string = versionData.version;

export { parseFritzingSvg } from './parser.js';
export { parseFritzingFz } from './fzParser.js';
export { snapTracesToPads } from './pads.js';
export { buildStls } from './stlWriter.js';
export type { StlOutputs, ManifoldInitOptions } from './stlWriter.js';
export { buildSvg } from './svgWriter.js';
export type { BoardModel, PrinterOptions, Trace, Pad, GroundFill } from './types.js';
export { DEFAULT_OPTIONS } from './types.js';
