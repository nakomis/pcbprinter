import type { BoardModel } from './types.js';
import type { PrinterOptions } from './types.js';
export interface StlOutputs { pcb: ArrayBuffer; press: ArrayBuffer; }
export async function buildStls(model: BoardModel, options: PrinterOptions): Promise<StlOutputs> { throw new Error('not implemented'); }
