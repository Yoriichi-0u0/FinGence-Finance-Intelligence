/** Monotone cubic control points between actual observations only. Missing values break paths.
 * Tangents are zero at extrema and bounded by adjacent secants, so the curve stays inside
 * each observed interval's value range. This changes SVG geometry, never observations/tooltips. */
export function smoothObservedSegments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
    const groups: { index: number; x: number; y: number }[][] = [];
    let group: typeof groups[number] = [];
    values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) { group = []; return; }
        if (!group.length) { group = []; groups.push(group); }
        group.push({ index: i, x: x(i), y: y(v) });
    });
    return groups.map(points => {
        const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
        const tangent = points.map((_, i) => i === 0 ? slopes[0] ?? 0 : i === points.length - 1 ? slopes[i - 1] : slopes[i - 1] * slopes[i] <= 0 ? 0 : Math.sign(slopes[i]) * Math.min(Math.abs(slopes[i - 1]), Math.abs(slopes[i])));
        let path = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach((p, i) => { const a = points[i], h = (p.x - a.x) / 3;
            path += h > 0 && Number.isFinite(tangent[i]) && Number.isFinite(tangent[i + 1]) ? ` C ${a.x + h} ${a.y + tangent[i] * h} ${p.x - h} ${p.y - tangent[i + 1] * h} ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`;
        });
        return { path, first: points[0].index, last: points.at(-1)!.index };
    });
}
