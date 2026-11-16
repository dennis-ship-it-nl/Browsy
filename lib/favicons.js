// Favicon-cache per site (origin). Bewaart kleine iconen als data-URL, zodat ze direct
// beschikbaar zijn (ook bij navigatie op dezelfde site, offline en in de bladwijzerbalk).
const { net } = require('electron');

const MAX_BYTES = 80 * 1024;
const MAX_ENTRIES = 600;

const originOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch (_) { return ''; } };

function createFavicons(store) {
  const pending = new Map();   // origin -> promise
  const failed = new Map();    // origin -> tijdstip van laatste mislukte poging

  async function download(iconUrl) {
    if (/^data:image\//i.test(iconUrl)) return iconUrl.length <= MAX_BYTES * 1.4 ? iconUrl : '';
    if (!/^https?:/i.test(iconUrl)) return '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await net.fetch(iconUrl, { redirect: 'follow', signal: ctrl.signal, headers: { Accept: 'image/*,*/*;q=0.8' } });
      if (!r.ok) return '';
      let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) return '';
      if (!type.startsWith('image/')) {
        // veel sites sturen .ico als application/octet-stream
        if (/\.ico(\?|$)/i.test(iconUrl)) type = 'image/x-icon'; else if (buf.slice(0, 4).toString('hex') === '89504e47') type = 'image/png'; else return '';
      }
      return 'data:' + type + ';base64,' + buf.toString('base64');
    } catch (_) { return ''; } finally { clearTimeout(timer); }
  }

  function put(origin, dataUrl) {
    const d = store.data;
    delete d[origin]; d[origin] = dataUrl;          // nieuwste achteraan
    const keys = Object.keys(d);
    if (keys.length > MAX_ENTRIES) keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => delete d[k]);
    store.save();
  }

  return {
    get(url) { const o = originOf(url); return o ? (store.data[o] || '') : ''; },
    originOf,
    // Leer het icoon van een pagina. candidates = lijst met icoon-URL's uit de pagina.
    learn(pageUrl, candidates) {
      const origin = originOf(pageUrl); if (!origin) return Promise.resolve('');
      if (pending.has(origin)) return pending.get(origin);
      const list = (candidates || []).filter(Boolean).concat(origin + '/favicon.ico');
      const p = (async () => {
        for (const c of list) {
          const d = await download(c);
          if (d) { put(origin, d); return d; }
        }
        failed.set(origin, Date.now());
        return '';
      })().finally(() => pending.delete(origin));
      pending.set(origin, p);
      return p;
    },
    // Meerdere sites achter elkaar ophalen (maximaal 3 tegelijk). Roept done() aan als er iets nieuws is.
    ensureMany(urls, done) {
      if (this._busy) return; 
      const todo = [...new Set(urls)].filter(u => { const o = originOf(u); return o && !store.data[o] && !pending.has(o) && !(failed.has(o) && Date.now() - failed.get(o) < 6 * 3600 * 1000); });
      if (!todo.length) return;
      this._busy = true; let got = false, i = 0;
      const worker = async () => { while (i < todo.length) { const u = todo[i++]; if (await this.ensure(u)) got = true; } };
      Promise.all([worker(), worker(), worker()]).finally(() => { this._busy = false; if (got) done(); });
    },
    // Voor bladwijzers zonder icoon: probeer /favicon.ico (maximaal 1x per 6 uur per site)
    ensure(url) {
      const origin = originOf(url); if (!origin || store.data[origin] || pending.has(origin)) return Promise.resolve('');
      if (failed.has(origin) && Date.now() - failed.get(origin) < 6 * 3600 * 1000) return Promise.resolve('');
      return this.learn(url, []);
    }
  };
}

module.exports = { createFavicons, originOf };
