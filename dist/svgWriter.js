import { lineToRoundedPath } from './geometry.js';
/** Convert an array of contours back to an SVG path `d` string. */
function contoursToPathD(contours) {
    return contours.map(pts => {
        if (pts.length === 0)
            return '';
        const [first, ...rest] = pts;
        return `M${first[0]},${first[1]}` + rest.map(p => `L${p[0]},${p[1]}`).join('') + 'Z';
    }).join(' ');
}
export function buildSvg(model, options) {
    const { boardRect, traces, pads, footprintCircles, groundFills } = model;
    const { x, y, w, h } = boardRect;
    const lines = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg"`, `     viewBox="${x} ${y} ${w} ${h}"`, `     width="${w}" height="${h}">`);
    // 1. Board background
    lines.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${options.boardColor}"/>`);
    // 2. Board outline
    lines.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111111" stroke-width="0.5"/>`);
    // 3. Groundfill regions (rendered before traces so traces appear on top)
    for (const gf of groundFills) {
        const d = contoursToPathD(gf.contours);
        lines.push(`  <path fill="${gf.color}" fill-rule="evenodd" d="${d}"/>`);
    }
    // 5. Footprint circles
    for (const fc of footprintCircles) {
        lines.push(`  <circle cx="${fc.cx}" cy="${fc.cy}" r="${fc.r}" fill="none" stroke="#F7BD13" stroke-width="0.5"/>`);
    }
    // 6. Trace paths
    for (const trace of traces) {
        const halfWidth = trace.strokeWidth / 2;
        const d = lineToRoundedPath(trace.x1, trace.y1, trace.x2, trace.y2, halfWidth);
        lines.push(`  <path fill="${trace.color}" d="${d}"/>`);
    }
    // 7. Pad pairs (outer then inner)
    for (const pad of pads) {
        lines.push(`  <circle cx="${pad.cx}" cy="${pad.cy}" r="${pad.padRadius}" fill="#f2c600"/>`, `  <circle cx="${pad.cx}" cy="${pad.cy}" r="${pad.drillRadius}" fill="#111111"/>`);
    }
    lines.push(`</svg>`);
    return lines.join('\n');
}
