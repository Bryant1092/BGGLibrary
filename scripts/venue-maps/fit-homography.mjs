// Perspective (homography) transform from the BGG.CON hall map to the Hyatt plan, fitted on the
// hall's four outer corners: the Hyatt drawing is a slight perspective view, so a plain affine fit
// drifted up to ~4 Hyatt units at the hall's entrance end.
export const CORNERS = [
  [[1028.23, 35.74], [165.2, 442.8]],     // top-left (top of the movable wall to Hall B)
  [[1829.24, 35.68], [242.0, 430.5]],     // top-right
  [[1789.28, 983.2], [261.0, 489.6]],     // bottom-right (entrance end of the right wall)
  [[1116.23, 1028.09], [203.11, 503.37]], // bottom-left (end of the movable wall)
];
function solve(A, b) {
  const n = b.length; const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
    [m[i], m[p]] = [m[p], m[i]];
    for (let k = 0; k < n; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j]; }
  }
  return m.map((r, i) => r[n] / r[i]);
}
export function homography(pairs) {
  const A = [], b = [];
  for (const [[x, y], [X, Y]] of pairs) {
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solve(A, b);
  return ([x, y]) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
}
