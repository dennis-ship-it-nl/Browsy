const { app, BaseWindow, ipcMain, nativeTheme, session, protocol, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { createData } = require('./lib/store');
const { createDownloads } = require('./lib/downloads');
const { BrowserWin, NEWTAB } = require('./lib/window');
const { buildMenus } = require('./lib/menu');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, uninstallExtension } = require('electron-chrome-web-store');

app.setName('Browsy');
try {
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s*Electron\/\S+/i, '')
    .replace(/\s*(browsy|Browsy)\/\S+/i, '');
} catch (_) {}

protocol.registerSchemesAsPrivileged([
  { scheme: 'daarom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let data, downloads, ctx;
const PAGES = ['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'error'];
const SESSION_FILE = () => path.join(app.getPath('userData'), 'session.json');

/* ---------- adres omzetten ---------- */
function toURL(input) {
  const s = String(input || '').trim();
  if (!s) return NEWTAB;
  const m = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (m) return /^(https?|file|daarom)$/i.test(m[1]) ? s : data.searchUrl(s);
  if (/^about:blank$/i.test(s)) return s;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(s)) return 'https://' + s;
  return data.searchUrl(s);
}
const looksLikeURL = q => /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || (!/\s/.test(q) && /^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(q)) || /^localhost/i.test(q);

/* ---------- rechten ---------- */
const AUTO = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock']);
const ASK = { media: 'je camera of microfoon', geolocation: 'je locatie', notifications: 'meldingen', midi: 'MIDI-apparaten', 'clipboard-read': 'het klembord', 'display-capture': 'je scherm' };
const hostOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.host : ''; } catch (_) { return ''; } };

async function decide(wc, perm, details) {
  if (AUTO.has(perm)) return true;
  const label = ASK[perm]; if (!label) return false;
  const host = hostOf((details && details.requestingUrl) || wc.getURL());
  if (!host) return false;
  const key = host + '|' + perm, perms = data.get().permissions;
  if (perms[key] !== undefined) return perms[key];
  const w = ctx.ctrlFor(wc);
  const r = await dialog.showMessageBox(w && w.alive() ? w.win : undefined, {
    type: 'question', buttons: ['Toestaan', 'Blokkeren'], defaultId: 1, cancelId: 1,
    message: host + ' wil toegang tot ' + label, checkboxLabel: 'Onthoud mijn keuze voor deze site'
  });
  const allow = r.response === 0;
  if (r.checkboxChecked) { perms[key] = allow; data.set({ permissions: perms }); }
  return allow;
}

/* ---------- Chrome bladwijzers importeren ---------- */
function collect(node, out) {
  if (!node) return;
  if (node.type === 'url' && /^https?:/i.test(node.url || '')) out.push({ title: node.name, url: node.url });
  (node.children || []).forEach(c => collect(c, out));
}
async function importChrome(interactive) {
  let added = 0, found = 0;
  try {
    const base = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    const profiles = fs.readdirSync(base).filter(n => n === 'Default' || /^Profile \d+$/.test(n));
    for (const p of profiles) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(base, p, 'Bookmarks'), 'utf8')); } catch (_) { continue; }
      const out = []; Object.values(j.roots || {}).forEach(r => collect(r, out));
      found += out.length;
      out.forEach(b => { if (data.addBookmark(b.title, b.url)) added++; });
    }
  } catch (_) {}
  ctx.pushAll();
  if (interactive) {
    dialog.showMessageBox({ type: 'info', message: found ? added + ' bladwijzers geïmporteerd (' + (found - added) + ' bestonden al).' : 'Geen Chrome-bladwijzers gevonden op deze Mac.' });
  }
  return { added, found };
}

/* ---------- sessie ---------- */
function snapshot() {
  return { windows: ctx.windows.filter(w => !w.priv && w.alive()).map(w => ({
    tabs: w.tabs.map(t => ({ url: t.view.webContents.getURL() || t.url, pinned: t.pinned })),
    active: Math.max(0, w.tabs.findIndex(t => t.id === w.activeId)) })) };
}
let saveTimer = null;
function saveSession() {
  try { fs.writeFileSync(SESSION_FILE(), JSON.stringify(snapshot())); } catch (_) {}
}

/* ---------- ctx ---------- */
function makeCtx() {
  return {
    data, downloads, windows: [], winSeq: 1, lastFocused: null, byId: new Map(),
    toURL,
    register(wc, w) { this.byId.set(wc.id, w); },
    unregister(wc) { try { this.byId.delete(wc.id); } catch (_) {} },
    ctrlFor(wc) { return this.byId.get(wc.id); },
    focused() { return this.lastFocused && this.lastFocused.alive() ? this.lastFocused : this.windows[this.windows.length - 1] || null; },
    scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 1000); },
    pushAll() { this.windows.forEach(w => w.push()); },
    relayout() { this.windows.forEach(w => { w.layout(); w.push(); }); },
    prepareSession(ses) {
      if (ses.__prepared) return; ses.__prepared = true;
      downloads.hook(ses);
      try { ses.protocol.handle('daarom', daaromHandler); } catch (_) {}
      ses.setPermissionRequestHandler((wc, perm, cb, details) => { decide(wc, perm, details).then(cb, () => cb(false)); });
      ses.setPermissionCheckHandler((wc, perm, origin) => AUTO.has(perm) || data.get().permissions[hostOf(origin) + '|' + perm] === true);
    },
    suggestions(q) {
      q = String(q || '').trim(); if (!q) return [];
      const first = { type: looksLikeURL(q) ? 'url' : 'search', title: q, url: toURL(q) };
      return [first].concat(data.suggest(q).filter(x => x.url !== first.url)).slice(0, 8);
    },
    newWindow(opts = {}) {
      const w = new BrowserWin(ctx, opts);
      const urls = opts.urls && opts.urls.length ? opts.urls : [opts.private ? NEWTAB : startUrl()];
      urls.forEach((u, i) => w.createTab(u, { activate: i === urls.length - 1 }));
      return w;
    },
    openPage(name) {
      const w = this.focused() || this.newWindow();
      const url = 'daarom://' + name;
      const t = w.tabs.find(x => x.url.startsWith(url));
      if (t) w.setActive(t.id); else w.createTab(url);
    },
    openUrl(url) {
      const w = this.focused();
      if (w) w.createTab(url); else this.newWindow({ urls: [url] });
    },
    makeDefault() {
      app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https');
      dialog.showMessageBox({ type: 'info', message: 'Controleer in Systeeminstellingen, Bureaublad en Dock, of Browsy nu je standaardbrowser is.' });
    },
    importChrome
  };
}
const startUrl = () => (data.get().startup === 'home' && data.get().homepage) ? toURL(data.get().homepage) : NEWTAB;

/* ---------- extensies ---------- */
async function setupExtensions() {
  const ses = session.defaultSession;
  ctx.extensions = new ElectronChromeExtensions({
    session: ses,
    async createTab(details) {
      let w = ctx.focused(); if (!w || w.priv) w = ctx.windows.find(x => !x.priv) || ctx.newWindow();
      const t = w.createTab(details.url ? toURL(details.url) : NEWTAB, { activate: details.active !== false });
      return [t.view.webContents, w.win];
    },
    selectTab(wc) { const w = ctx.ctrlFor(wc); const t = w && w.tabByWc(wc); if (t) w.setActive(t.id); },
    removeTab(wc) { const w = ctx.ctrlFor(wc); const t = w && w.tabByWc(wc); if (t) w.closeTab(t.id); },
    async createWindow(details) {
      const urls = details.url ? [].concat(details.url).map(toURL) : [];
      return ctx.newWindow({ urls }).win;
    },
    removeWindow(win) { const w = ctx.windows.find(x => x.win === win); if (w) w.win.close(); }
  });
  ElectronChromeExtensions.handleCRXProtocol(ses);
  try { await installChromeWebStore({ session: ses }); } catch (e) { console.error('Web Store:', e && e.message); }
}
async function loadExtensions() {
  for (const p of data.get().extensions) {
    try { await session.defaultSession.extensions.loadExtension(p, { allowFileAccess: true }); } catch (_) {}
  }
}

/* ---------- eigen interne pagina's: daarom://history enz. ---------- */
function daaromHandler(req) {
  const u = new URL(req.url);
  const name = u.host;
  if (!PAGES.includes(name)) return new Response('Niet gevonden', { status: 404 });
  const file = u.pathname === '/' || u.pathname === '' ? name + '.html' : u.pathname.replace(/^\//, '');
  const root = path.join(__dirname, 'pages');
  const full = path.normalize(path.join(root, file));
  if (!full.startsWith(root + path.sep)) return new Response('Niet toegestaan', { status: 403 });
  return net.fetch(pathToFileURL(full).toString());
}

/* ---------- IPC ---------- */
function uiCtrl(e) { const w = ctx.ctrlFor(e.sender); return w && (e.sender === w.ui.webContents || (w.pop && e.sender === w.pop.webContents)) ? w : null; }
function popCtrl(e) { const w = ctx.ctrlFor(e.sender); return w && w.pop && e.sender === w.pop.webContents ? w : null; }
const onUI = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { const w = uiCtrl(e); if (w) return fn(w, ...a); });
const onPop = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { const w = popCtrl(e); if (w) return fn(w, ...a); });

function setupIPC() {
  // alleen voor geautomatiseerd testen (DAAROM_TEST=1), staat anders uit
  if (process.env.DAAROM_TEST === '1') ipcMain.handle('test:eval', async (_e, code) => { const v = await eval(code); try { return JSON.stringify(v ?? null); } catch (_) { return 'null'; } });

  onUI('ui:ready', w => w.push());
  onUI('tab:new', w => w.createTab(NEWTAB));
  onUI('tab:close', (w, id) => w.closeTab(id));
  onUI('tab:switch', (w, id) => w.setActive(id));
  onUI('tab:move', (w, id, to) => w.moveTab(id, to));
  onUI('tab:menu', (w, id) => w.tabMenu(id));
  onUI('nav', (w, text) => w.go(text));
  onUI('back', w => { const t = w.cur(); if (t) t.view.webContents.navigationHistory.goBack(); });
  onUI('forward', w => { const t = w.cur(); if (t) t.view.webContents.navigationHistory.goForward(); });
  onUI('reload', w => w.reloadOrStop());
  onUI('claude:toggle', w => w.toggleClaude());
  onUI('bookmark:toggle', w => w.toggleBookmark());
  onUI('bookmark:open', (w, id, inNew) => { const b = data.bookmarks.data.find(x => x.id === id); if (b) { if (inNew) w.createTab(b.url); else w.go(b.url); } });
  onUI('bookmark:menu', (w, id) => w.bookmarkMenu(id));
  onUI('suggest:query', (w, text, rect) => w.suggest(String(text || ''), rect));
  onUI('suggest:move', (w, d) => w.moveSel(d));
  onUI('suggest:close', w => { if (w.popMode === 'suggest') w.hidePop(); });
  onUI('menu:main', w => ctx.popupMainMenu(w));
  onPop('pop:ready', w => { w.popReady = true; w.setPop({}); });
  onPop('pop:pick', (w, i) => { const it = w.sugg[i]; if (it) w.go(it.url); });
  onPop('find:query', (w, text) => w.find(String(text || ''), true, false));
  onPop('find:step', (w, forward) => w.find(w.lastFind, !!forward, true));
  onPop('find:close', w => w.closeFind());

  // interne pagina's (daarom://)
  const page = (ch, fn) => ipcMain.handle('pages:' + ch, (e, ...a) => {
    const f = e.senderFrame;
    if (!f || f !== e.sender.mainFrame || !/^daarom:\/\//.test(f.url)) return null;
    return fn(e, ...a);
  });
  page('getSettings', () => Object.assign({}, data.get(), { engines: Object.fromEntries(Object.entries(data.ENGINES).map(([k, v]) => [k, v[0]])), version: app.getVersion() }));
  page('setSettings', (e, patch) => {
    const allowed = ['searchEngine', 'startup', 'homepage', 'theme', 'bookmarksBar', 'newtabLinks'];
    const clean = {}; allowed.forEach(k => { if (k in patch) clean[k] = patch[k]; });
    if (clean.theme) nativeTheme.themeSource = ['light', 'dark'].includes(clean.theme) ? clean.theme : 'system';
    data.set(clean); ctx.relayout(); return true;
  });
  page('navigate', (e, text) => { const w = ctx.ctrlFor(e.sender); const t = w && w.tabByWc(e.sender); if (t) e.sender.loadURL(toURL(text)).catch(() => {}); });
  page('history:list', (e, q) => data.listHistory(q));
  page('history:remove', (e, url) => { data.removeHistory(url); return true; });
  page('bookmarks:list', () => data.bookmarks.data);
  page('bookmarks:remove', (e, id) => { data.removeBookmark(id); ctx.pushAll(); return true; });
  page('bookmarks:rename', (e, id, title) => { data.renameBookmark(id, String(title || '')); ctx.pushAll(); return true; });
  page('downloads:list', () => downloads.list());
  page('downloads:open', (e, k) => downloads.open(k));
  page('downloads:show', (e, k) => downloads.show(k));
  page('downloads:cancel', (e, k) => downloads.cancel(k));
  page('downloads:clear', () => { downloads.clear(); return true; });
  page('data:clear', async (e, o) => {
    if (o.history) data.clearHistory();
    if (o.cookies) await session.defaultSession.clearStorageData();
    if (o.cache) await session.defaultSession.clearCache();
    return true;
  });
  page('ext:list', () => session.defaultSession.extensions.getAllExtensions().map(x => ({ id: x.id, name: x.name, version: x.version, path: x.path })));
  page('ext:add', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], message: 'Kies de map van een uitgepakte extensie' });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      const x = await session.defaultSession.extensions.loadExtension(r.filePaths[0], { allowFileAccess: true });
      const list = data.get().extensions.filter(p => p !== r.filePaths[0]); list.push(r.filePaths[0]); data.set({ extensions: list });
      return { ok: true, name: x.name };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  page('ext:remove', (e, id) => {
    const x = session.defaultSession.extensions.getAllExtensions().find(y => y.id === id);
    if (!x) return true;
    data.set({ extensions: data.get().extensions.filter(p => p !== x.path) });
    if (x.path.startsWith(path.join(app.getPath('userData'), 'Extensions'))) return uninstallExtension(id).then(() => true, () => true);
    session.defaultSession.extensions.removeExtension(id);
    return true;
  });
  page('import:chrome', () => importChrome(false));
  page('defaultBrowser', () => { ctx.makeDefault(); return true; });
  page('openUrl', (e, u) => { if (/^https:\/\//i.test(String(u))) { const w = ctx.ctrlFor(e.sender); if (w) w.createTab(String(u)); } });
  page('openPage', (e, name) => { if (PAGES.includes(name)) ctx.openPage(name); });
}

/* ---------- start ---------- */
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady() && ctx) ctx.openUrl(url); else pendingUrls.push(url); });
const pendingUrls = [];
app.on('second-instance', (_e, argv) => {
  const urls = argv.filter(a => /^https?:\/\//i.test(a));
  if (ctx) { if (urls.length) urls.forEach(u => ctx.openUrl(u)); else ctx.newWindow(); }
});

app.whenReady().then(async () => {
  data = createData();
  downloads = createDownloads(data);
  ctx = makeCtx();
  nativeTheme.themeSource = ['light', 'dark'].includes(data.get().theme) ? data.get().theme : 'system';

  setupIPC();
  buildMenus(ctx);
  ctx.prepareSession(session.defaultSession);
  await setupExtensions();
  await loadExtensions();
  ctx.prepareSession(session.fromPartition('persist:claude'));

  // vensters herstellen
  let restored = false;
  if (data.get().startup === 'restore') {
    try {
      const snap = JSON.parse(fs.readFileSync(SESSION_FILE(), 'utf8'));
      (snap.windows || []).forEach(sw => {
        const tabs = (sw.tabs || []).filter(t => typeof t.url === 'string' && /^(https?:\/\/|daarom:\/\/)/i.test(t.url));
        if (!tabs.length) return;
        const w = new BrowserWin(ctx);
        tabs.forEach(t => w.createTab(t.url, { activate: false, pinned: t.pinned }));
        w.setActive(w.tabs[Math.min(sw.active || 0, w.tabs.length - 1)].id);
        restored = true;
      });
    } catch (_) {}
  }
  if (pendingUrls.length) { pendingUrls.forEach(u => ctx.openUrl(u)); restored = true; }
  if (!restored) ctx.newWindow();
});

app.on('before-quit', () => { try { saveSession(); [data.settings, data.bookmarks, data.history, data.downloads].forEach(s => s.flush()); } catch (_) {} });
app.on('window-all-closed', () => app.quit());
