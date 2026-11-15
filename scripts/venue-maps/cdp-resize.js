const fs = require('fs'); const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r)); let id = 0; const p = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const m = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return m.result?.exceptionDetails ? 'EXC ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300) : m.result?.result?.value; };
  await send('Page.navigate', { url: 'http://127.0.0.1:4400/resize.html' });
  for (let i = 0; i < 40 && !(await ev('window.ready === true')); i++) await sleep(250);
  const logos = JSON.parse(fs.readFileSync('logos-raw/assigned.json', 'utf8'));
  let total = 0;
  for (const l of logos) {
    // BGG Store's banner is drawn rotated 90° in its tall booth on the PDF.
    const url = await ev(`shrink('/${l.src}', ${l.rotated})`);
    const buf = Buffer.from(url.split(',')[1], 'base64'); total += buf.length;
    l.file = `logos/${l.slug}.webp`; fs.writeFileSync(l.file, buf);
  }
  // Manifest: one entry per exhibitor name, reusable in later years when the name matches.
  fs.writeFileSync('logos/index.json', JSON.stringify(logos.map(({ name, slug, file, booth }) => ({ name, slug, file: file.replace('logos/', ''), firstSeen: 'BGG.CON 2026', booth2026: booth })), null, 1));
  console.log(logos.length, 'logos,', Math.round(total / 1024), 'KB total');
  ws.close();
})();
