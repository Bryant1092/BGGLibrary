// Converts one PDF page's vector drawing to SVG (no images, no text), plus a JSON of
// its text labels and filled shapes, so floor plans keep their exact geometry.
// Usage: node pdf2svg.mjs <pdf> <page> <outPrefix>
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , file, pageNo, out] = process.argv;
const OPS = pdfjs.OPS;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(Number(pageNo));
const vp = page.getViewport({ scale: 1 });
const H = vp.height;
const list = await page.getOperatorList();

const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const apply = (m, x, y) => [m[0]*x + m[2]*y + m[4], H - (m[1]*x + m[3]*y + m[5])];
const color = a => {
  if (typeof a[0] === 'string') return a[0];
  const [r, g, b] = a.map(v => Math.round(v <= 1 && a.every(x => x <= 1) ? v * 255 : v));
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
};

let st = { ctm: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lw: 1, dash: null, clips: [] };
// Clipping masks: the PDF trims some shapes with clip paths (e.g. the hall map's floor
// outlines); without them, hidden parts of shapes show up as solid blocks.
const clipDefs = []; let pendingClip = null;
const stack = [];
let d = '';
let pts = [];
const shapes = [];
const out_paths = [];
const fmt = n => Math.round(n * 100) / 100;

for (let i = 0; i < list.fnArray.length; i++) {
  const fn = list.fnArray[i], args = list.argsArray[i];
  switch (fn) {
    case OPS.save: stack.push({ ...st, ctm: [...st.ctm], clips: [...st.clips] }); break;
    case OPS.restore: st = stack.pop() || st; break;
    case OPS.transform: st.ctm = mul(st.ctm, args); break;
    case OPS.setLineWidth: st.lw = args[0]; break;
    case OPS.setDash: st.dash = args[0] && args[0].length ? args[0] : null; break;
    case OPS.setFillRGBColor: case OPS.setFillColor: st.fill = color(args); break;
    case OPS.setStrokeRGBColor: case OPS.setStrokeColor: st.stroke = color(args); break;
    case OPS.setFillGray: st.fill = color([args[0], args[0], args[0]]); break;
    case OPS.setStrokeGray: st.stroke = color([args[0], args[0], args[0]]); break;
    case OPS.setFillCMYKColor: case OPS.setStrokeCMYKColor: {
      const [c, m, y, k] = args; const rgb = [255*(1-c)*(1-k), 255*(1-m)*(1-k), 255*(1-y)*(1-k)];
      if (fn === OPS.setFillCMYKColor) st.fill = color(rgb); else st.stroke = color(rgb); break;
    }
    case OPS.setGState: for (const [k, v] of args[0]) { if (k === 'LW') st.lw = v; } break;
    case OPS.constructPath: {
      const [ops, coords] = args; let c = 0;
      for (const op of ops) {
        if (op === OPS.moveTo) { const [x, y] = apply(st.ctm, coords[c++], coords[c++]); d += `M${fmt(x)} ${fmt(y)}`; pts.push([x, y]); }
        else if (op === OPS.lineTo) { const [x, y] = apply(st.ctm, coords[c++], coords[c++]); d += `L${fmt(x)} ${fmt(y)}`; pts.push([x, y]); }
        else if (op === OPS.curveTo) { const p1 = apply(st.ctm, coords[c++], coords[c++]), p2 = apply(st.ctm, coords[c++], coords[c++]), p3 = apply(st.ctm, coords[c++], coords[c++]); d += `C${fmt(p1[0])} ${fmt(p1[1])} ${fmt(p2[0])} ${fmt(p2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`; pts.push(p3); }
        else if (op === OPS.curveTo2) { const p2 = apply(st.ctm, coords[c++], coords[c++]), p3 = apply(st.ctm, coords[c++], coords[c++]); d += `S${fmt(p2[0])} ${fmt(p2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`; pts.push(p3); }
        else if (op === OPS.curveTo3) { const p1 = apply(st.ctm, coords[c++], coords[c++]), p3 = apply(st.ctm, coords[c++], coords[c++]); d += `C${fmt(p1[0])} ${fmt(p1[1])} ${fmt(p3[0])} ${fmt(p3[1])} ${fmt(p3[0])} ${fmt(p3[1])}`; pts.push(p3); }
        else if (op === OPS.rectangle) { const x = coords[c++], y = coords[c++], w = coords[c++], h = coords[c++]; const q = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => apply(st.ctm, a, b)); d += `M${q.map(p => fmt(p[0]) + ' ' + fmt(p[1])).join('L')}Z`; pts.push(...q); }
        else if (op === OPS.closePath) { d += 'Z'; }
      }
      break;
    }
    case OPS.fill: case OPS.eoFill: case OPS.stroke: case OPS.closeStroke: case OPS.fillStroke: case OPS.eoFillStroke:
    case OPS.closeFillStroke: case OPS.closeEOFillStroke: case OPS.endPath: case OPS.clip: case OPS.eoClip: {
      if (fn === OPS.clip || fn === OPS.eoClip) { pendingClip = { d, rule: fn === OPS.eoClip ? 'evenodd' : 'nonzero' }; break; }
      if (pendingClip) {
        const id = 'c' + clipDefs.length;
        clipDefs.push(`<clipPath id="${id}"><path d="${pendingClip.d}" clip-rule="${pendingClip.rule}"/></clipPath>`);
        st.clips = [...st.clips, id]; pendingClip = null;
      }
      if (fn === OPS.endPath) { d = ''; pts = []; break; }
      const doFill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(fn);
      const doStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(fn);
      const scale = Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])) || 1;
      if (d) {
        const attrs = [`d="${d}"`, `fill="${doFill ? st.fill : 'none'}"`];
        if (fn === OPS.eoFill || fn === OPS.eoFillStroke || fn === OPS.closeEOFillStroke) attrs.push('fill-rule="evenodd"');
        if (doStroke) attrs.push(`stroke="${st.stroke}" stroke-width="${fmt(Math.max(st.lw * scale, 0.3))}"`, ...(st.dash ? [`stroke-dasharray="${st.dash.map(v => fmt(v * scale)).join(' ')}"`] : []));
        const xs0 = pts.map(p => p[0]), ys0 = pts.map(p => p[1]);
        const wrapped = st.clips.reduce((inner, id) => `<g clip-path="url(#${id})">${inner}</g>`, `<path ${attrs.join(' ')}/>`);
        out_paths.push({ svg: wrapped, bbox: pts.length ? [Math.min(...xs0), Math.min(...ys0), Math.max(...xs0), Math.max(...ys0)] : [0, 0, 0, 0], fill: doFill ? st.fill : null });
        if (doFill && pts.length > 2) {
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          shapes.push({ fill: st.fill, d, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], pts: pts.map(p => [fmt(p[0]), fmt(p[1])]) });
        }
      }
      d = ''; pts = [];
      break;
    }
  }
}

const text = (await page.getTextContent()).items.filter(t => t.str.trim()).map(t => ({
  str: t.str, x: fmt(t.transform[4]), y: fmt(H - t.transform[5]), size: fmt(Math.hypot(t.transform[0], t.transform[1])), w: fmt(t.width),
}));
writeFileSync(`${out}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vp.width)} ${fmt(H)}" stroke-linejoin="round" stroke-linecap="round"><defs>${clipDefs.join('')}</defs>${out_paths.map(p => p.svg).join('')}</svg>`);
writeFileSync(`${out}.json`, JSON.stringify({ width: vp.width, height: H, text, shapes, paths: out_paths, clipDefs }));
const fills = {}; shapes.forEach(s => fills[s.fill] = (fills[s.fill] || 0) + 1);
console.log(`${out}: ${out_paths.length} paths, ${shapes.length} filled shapes, ${text.length} labels; fills:`, JSON.stringify(fills));
