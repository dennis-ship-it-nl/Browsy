const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

class Store {
  constructor(name, def) {
    this.file = path.join(app.getPath('userData'), name + '.json');
    this.def = def;
    this.timer = null;
    this.data = this.load();
  }
  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(this.def) ? (Array.isArray(d) ? d : []) : Object.assign(JSON.parse(JSON.stringify(this.def)), d);
    } catch (_) { return JSON.parse(JSON.stringify(this.def)); }
  }
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 500); }
  flush() {
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data)); fs.renameSync(this.file + '.tmp', this.file); } catch (_) {}
  }
}

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  startup: 'restore',        // restore | newtab | home
  homepage: '',
  theme: 'system',           // system | light | dark
  bookmarksBar: true,
  permissions: {},
  extensions: [],
  newtabLinks: [
    ['Monday', 'Taken per klant', 'https://monday.com'],
    ['Platform', 'platform.daar-om.app', 'https://platform.daar-om.app'],
    ['Simplicate', 'Projecten en uren', 'https://www.simplicate.nl'],
    ['Analytics', 'GA4', 'https://analytics.google.com'],
    ['Drive', 'Klantmappen', 'https://drive.google.com']
  ]
};

const ENGINES = {
  google: ['Google', 'https://www.google.com/search?q=%s'],
  bing: ['Bing', 'https://www.bing.com/search?q=%s'],
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
  ecosia: ['Ecosia', 'https://www.ecosia.org/search?q=%s']
};

const norm = u => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

function createData() {
  const settings = new Store('settings', DEFAULT_SETTINGS);
  const bookmarks = new Store('bookmarks', []);
  const history = new Store('history', { entries: {} });
  const downloads = new Store('downloads', []);

  const api = {
    settings, bookmarks, history, downloads, ENGINES,
    get: () => settings.data,
    set(patch) { Object.assign(settings.data, patch); settings.save(); },
    searchUrl(q) {
      const e = ENGINES[settings.data.searchEngine] || ENGINES.google;
      return e[1].replace('%s', encodeURIComponent(q));
    },
    // geschiedenis
    addHistory(url, title) {
      if (!/^https?:\/\//i.test(url)) return;
      const e = history.data.entries;
      const x = e[url] || { url, title: '', last: 0, count: 0 };
      x.last = Date.now(); x.count++; if (title) x.title = title;
      e[url] = x;
      const keys = Object.keys(e);
      if (keys.length > 6000) keys.sort((a, b) => e[a].last - e[b].last).slice(0, 500).forEach(k => delete e[k]);
      history.save();
    },
    setHistoryTitle(url, title) {
      const x = history.data.entries[url]; if (x && title) { x.title = title; history.save(); }
    },
    listHistory(q, limit = 400) {
      let list = Object.values(history.data.entries);
      if (q) { q = q.toLowerCase(); list = list.filter(x => x.url.toLowerCase().includes(q) || (x.title || '').toLowerCase().includes(q)); }
      return list.sort((a, b) => b.last - a.last).slice(0, limit);
    },
    removeHistory(url) { delete history.data.entries[url]; history.save(); },
    clearHistory() { history.data.entries = {}; history.save(); },
    // bladwijzers
    isBookmarked(url) { const n = norm(url); return !!n && bookmarks.data.some(b => norm(b.url) === n); },
    addBookmark(title, url) {
      if (!/^https?:\/\//i.test(url) || api.isBookmarked(url)) return false;
      bookmarks.data.push({ id: crypto.randomUUID(), title: title || url, url, added: Date.now() });
      bookmarks.save(); return true;
    },
    removeBookmark(id) { const i = bookmarks.data.findIndex(b => b.id === id); if (i >= 0) { bookmarks.data.splice(i, 1); bookmarks.save(); } },
    removeBookmarkByUrl(url) { const n = norm(url); const i = bookmarks.data.findIndex(b => norm(b.url) === n); if (i >= 0) { bookmarks.data.splice(i, 1); bookmarks.save(); } },
    renameBookmark(id, title) { const b = bookmarks.data.find(x => x.id === id); if (b && title) { b.title = title; bookmarks.save(); } },
    // suggesties voor de adresbalk
    suggest(q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      const out = [], seen = new Set();
      const push = (type, title, url) => { if (!seen.has(url) && out.length < 8) { seen.add(url); out.push({ type, title, url }); } };
      bookmarks.data.filter(b => b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)).slice(0, 3).forEach(b => push('bookmark', b.title, b.url));
      Object.values(history.data.entries)
        .filter(x => x.url.toLowerCase().includes(q) || (x.title || '').toLowerCase().includes(q))
        .sort((a, b) => (b.count * 3 + b.last / 1e11) - (a.count * 3 + a.last / 1e11))
        .slice(0, 5).forEach(x => push('history', x.title || x.url, x.url));
      return out;
    }
  };
  return api;
}

module.exports = { createData, ENGINES };
