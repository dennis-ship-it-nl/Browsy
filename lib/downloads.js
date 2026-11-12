const fs = require('fs');
const path = require('path');
const { app, shell, Notification } = require('electron');

function createDownloads(data) {
  const items = new Map();   // id -> { rec, item }
  let seq = 1;

  const persisted = data.downloads.data;   // eerder voltooide downloads
  persisted.forEach(r => items.set('p' + r.id, { rec: r, item: null }));
  seq = persisted.reduce((m, r) => Math.max(m, r.id), 0) + 1;

  const uniquePath = (dir, name) => {
    const ext = path.extname(name), base = path.basename(name, ext);
    let p = path.join(dir, name), n = 1;
    while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);
    return p;
  };

  function hook(ses) {
    if (ses.__dlHooked) return;
    ses.__dlHooked = true;
    ses.on('will-download', (_e, item) => {
      const dir = app.getPath('downloads');
      const p = uniquePath(dir, item.getFilename() || 'download');
      item.setSavePath(p);
      const rec = { id: seq++, name: path.basename(p), url: item.getURL(), path: p, total: item.getTotalBytes(), received: 0, state: 'progressing', time: Date.now() };
      const priv = !ses.isPersistent();
      items.set('d' + rec.id, { rec, item, priv });
      item.on('updated', (_ev, state) => {
        rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
        rec.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      });
      item.once('done', (_ev, state) => {
        rec.state = state; rec.received = item.getReceivedBytes();
        if (state === 'completed') {
          if (!priv) { data.downloads.data.push(Object.assign({}, rec)); data.downloads.save(); }
          try {
            const n = new Notification({ title: 'Download klaar', body: rec.name });
            n.on('click', () => shell.showItemInFolder(rec.path));
            n.show();
          } catch (_) {}
        }
      });
    });
  }

  const find = id => items.get(id);
  return {
    hook,
    list() {
      return [...items.entries()].map(([key, v]) => Object.assign({ key }, v.rec)).sort((a, b) => b.time - a.time);
    },
    open(key) { const v = find(key); if (v) shell.openPath(v.rec.path); },
    show(key) { const v = find(key); if (v) shell.showItemInFolder(v.rec.path); },
    cancel(key) { const v = find(key); if (v && v.item && v.rec.state === 'progressing') v.item.cancel(); },
    clear() {
      for (const [k, v] of [...items.entries()]) if (v.rec.state !== 'progressing') items.delete(k);
      data.downloads.data.length = 0; data.downloads.save();
    },
    active() { return [...items.values()].filter(v => v.rec.state === 'progressing').length; }
  };
}

module.exports = { createDownloads };
