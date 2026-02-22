/** Returns an SVG path `d` string for a filled rounded-rectangle trace. */
export function lineToRoundedPath(x1, y1, x2, y2, halfWidth) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
        // Zero-length line: emit a circle using two arc commands
        const r = halfWidth;
        // SVG circle approximation: two semicircular arcs
        return (`M ${x1 - r},${y1} ` +
            `A ${r},${r} 0 0,1 ${x1 + r},${y1} ` +
            `A ${r},${r} 0 0,1 ${x1 - r},${y1} Z`);
    }
    const ux = dx / len;
    const uy = dy / len;
    // Normal vector (perpendicular, 90° CCW)
    const nx = -uy;
    const ny = ux;
    const h = halfWidth;
    const ax = x1 + nx * h, ay = y1 + ny * h; // a
    const bx = x2 + nx * h, by = y2 + ny * h; // b
    const cx = x2 - nx * h, cy = y2 - ny * h; // c
    const dx2 = x1 - nx * h, dy2 = y1 - ny * h; // d
    const fmt = (n) => +n.toFixed(6) + '';
    return (`M ${fmt(ax)},${fmt(ay)} ` +
        `L ${fmt(bx)},${fmt(by)} ` +
        `A ${fmt(h)},${fmt(h)} 0 0,1 ${fmt(cx)},${fmt(cy)} ` +
        `L ${fmt(dx2)},${fmt(dy2)} ` +
        `A ${fmt(h)},${fmt(h)} 0 0,1 ${fmt(ax)},${fmt(ay)} Z`);
}
/** Returns an array of [x,y] points approximating the rounded-rect outline (for 3D use). */
export function lineToPolygon(x1, y1, x2, y2, halfWidth, segments) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const h = halfWidth;
    if (len === 0) {
        // Zero-length: return a circle polygon centred at (x1, y1)
        const pts = [];
        for (let i = 0; i < segments; i++) {
            const angle = (2 * Math.PI * i) / segments;
            pts.push([x1 + h * Math.cos(angle), y1 + h * Math.sin(angle)]);
        }
        return pts;
    }
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const pts = [];
    // Half-segments for each end cap
    const halfSegs = Math.max(2, Math.floor(segments / 2));
    // Left side of rectangle (from d to a, i.e. start point, -normal to +normal)
    // Then right cap at end point (b to c, sweeping through +ux side)
    // Then right side (c to d)
    // Then left cap at start point (d to a, sweeping through -ux side)
    // Start at point a = (x1 + nx*h, y1 + ny*h)
    // Go to b = (x2 + nx*h, y2 + ny*h)
    // Arc from b around end point (x2,y2) to c = (x2 - nx*h, y2 - ny*h)
    // Go to d = (x1 - nx*h, y1 - ny*h)
    // Arc from d around start point (x1,y1) to a
    // Point a
    pts.push([x1 + nx * h, y1 + ny * h]);
    // Point b
    pts.push([x2 + nx * h, y2 + ny * h]);
    // Arc at end cap: from angle (ux,uy) normal direction, sweeping to -(nx,ny) side
    // At end point (x2,y2), the cap goes from angle of +normal to angle of -normal
    // sweeping clockwise (which is CW in screen coords = decreasing angle)
    // +normal direction angle = atan2(ny, nx)
    // -normal direction angle = atan2(-ny, -nx)
    // We sweep from +normal to -normal going through +ux direction (the "forward" cap)
    const startAngleEnd = Math.atan2(ny, nx);
    for (let i = 1; i < halfSegs; i++) {
        // Sweep from +normal angle going in the direction of the unit vector (forward cap)
        const angle = startAngleEnd - (Math.PI * i) / halfSegs;
        pts.push([x2 + h * Math.cos(angle), y2 + h * Math.sin(angle)]);
    }
    // Point c = (x2 - nx*h, y2 - ny*h)
    pts.push([x2 - nx * h, y2 - ny * h]);
    // Point d = (x1 - nx*h, y1 - ny*h)
    pts.push([x1 - nx * h, y1 - ny * h]);
    // Arc at start cap: from -normal sweeping through -ux direction back to +normal
    const startAngleStart = Math.atan2(-ny, -nx);
    for (let i = 1; i < halfSegs; i++) {
        const angle = startAngleStart - (Math.PI * i) / halfSegs;
        pts.push([x1 + h * Math.cos(angle), y1 + h * Math.sin(angle)]);
    }
    return pts;
}
