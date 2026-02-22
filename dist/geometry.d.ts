/** Returns an SVG path `d` string for a filled rounded-rectangle trace. */
export declare function lineToRoundedPath(x1: number, y1: number, x2: number, y2: number, halfWidth: number): string;
/** Returns an array of [x,y] points approximating the rounded-rect outline (for 3D use). */
export declare function lineToPolygon(x1: number, y1: number, x2: number, y2: number, halfWidth: number, segments: number): [number, number][];
