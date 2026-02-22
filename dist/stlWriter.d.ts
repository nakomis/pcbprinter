import type { BoardModel, PrinterOptions } from './types.js';
export interface StlOutputs {
    pcb: ArrayBuffer;
    press: ArrayBuffer;
}
export declare function buildStls(model: BoardModel, options: PrinterOptions): Promise<StlOutputs>;
