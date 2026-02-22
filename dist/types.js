/** All coordinates are in absolute SVG user units throughout the internal model.
 *  Conversion to mm happens only in stlWriter. */
export const DEFAULT_OPTIONS = {
    outDir: '.',
    writeSvg: false,
    boardColor: '#03A550',
    boardThicknessMm: 1.6,
    traceHeightMm: 0.2,
    traceRecessMm: 0,
    drillDiameterMm: 1.0,
    snapToleranceMm: 1.5,
    traceSegments: 32,
};
