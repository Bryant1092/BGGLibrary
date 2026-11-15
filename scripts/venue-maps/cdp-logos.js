const fs = require('fs'); const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r)); let id = 0; const p = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const m = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return m.result?.exceptionDetails ? 'EXC ' + JSON.stringify(m.result.exceptionDetails).slice(0, 400) : m.result?.result?.value; };
  await send('Page.navigate', { url: 'http://127.0.0.1:4400/extract-logos.html' });
  for (let i = 0; i < 40 && !(await ev('window.ready === true')); i++) await sleep(250);
  const n = await ev("extract('maps-src/exhibit-hall.pdf').then(l => (window.__logos = l).length)");
  console.log('found', n);
  const list = [];
  for (let i = 0; i < n; i++) {
    const info = await ev('(({ id, w, h, box, png }) => ({ id, w, h, box, size: png.length }))(window.__logos[' + i + '])');
    // Logos sit inside booths (well under a quarter of the page); skip the page-sized background art.
    const small = (info.box[2] - info.box[0]) < 400 && (info.box[3] - info.box[1]) < 400 && info.size < 3e6;
    list.push({ ...info, png: small ? await ev('window.__logos[' + i + '].png') : null });
  }
  const meta = list.filter(im => im.png).map((im, i) => { const f = `logos-raw/img${String(i).padStart(2, '0')}.png`; fs.writeFileSync(f, Buffer.from(im.png.split(',')[1], 'base64')); return { file: f, w: im.w, h: im.h, box: im.box.map(v => Math.round(v * 10) / 10) }; });
  fs.writeFileSync('logos-raw/images.json', JSON.stringify(meta, null, 1));
  console.log(meta.length, 'images'); meta.forEach(m => console.log(m.file, m.w + 'x' + m.h, m.box.map(Math.round).join(',')));
  ws.close();
})();
