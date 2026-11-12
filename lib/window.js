const path = require('path');
const fs = require('fs');
const { BaseWindow, WebContentsView, Menu, dialog, shell, clipboard, nativeTheme, session } = require('electron');

const ROOT = path.join(__dirname, '..');
const TOOL_H = 99, BAR_H = 34, PANEL = 420;
const NEWTAB = 'daarom://newtab';

class BrowserWin {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.priv = !!opts.private;
    this.id = ctx.winSeq++;
    this.partition = this.priv ? 'private-' + this.id : undefined;
    this.ses = this.priv ? session.fromPartition(this.partition) : session.defaultSession;
    ctx.prepareSession(this.ses);

    this.tabs = []; this.activeId = null; this.seq = 1; this.closed = [];
    this.shown = null; this.claude = null; this.claudeOpen = false; this.htmlFS = false;
    this.pop = null; this.popReady = false; this.popMode = null; this.popState = {};
    this.sugg = []; this.sel = -1; this.typed = ''; this.addrRect = { x: 160, width: 600 };
    this.lastFind = '';

    const dark = nativeTheme.shouldUseDarkColors;
    this.win = new BaseWindow({
      width: 1280, height: 820, minWidth: 640, minHeight: 420,
      title: this.priv ? 'Browsy (privé)' : 'Browsy',
      titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 16 },
      backgroundColor: this.priv ? '#1B1F26' : (dark ? '#141915' : '#E8EBDF')
    });

    this.ui = new WebContentsView({
      webPreferences: { preload: path.join(ROOT, 'preload-ui.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
    });
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadFile(path.join(ROOT, 'ui', 'index.html'));
    this.ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ui.webContents.on('will-navigate', e => e.preventDefault());
    ctx.register(this.ui.webContents, this);

    this.win.on('resize', () => this.layout());
    this.win.on('enter-full-screen', () => this.layout());
    this.win.on('leave-full-screen', () => this.layout());
    this.win.on('focus', () => { ctx.lastFocused = this; });
    this.win.on('closed', () => this.dispose());
    ctx.windows.push(this);
    ctx.lastFocused = this;
    this.layout();
  }

  /* ---------- hulpjes ---------- */
  cur() { return this.tabs.find(t => t.id === this.activeId); }
  tabByWc(wc) { return this.tabs.find(t => t.view.webContents === wc); }
  top() { return TOOL_H + (this.ctx.data.get().bookmarksBar ? BAR_H : 0); }
  alive() { return this.win && !this.win.isDestroyed(); }

  dispose() {
    this.ctx.windows = this.ctx.windows.filter(w => w !== this);
    if (this.ctx.lastFocused === this) this.ctx.lastFocused = this.ctx.windows[this.ctx.windows.length - 1] || null;
    this.tabs.forEach(t => { try { this.ctx.unregister(t.view.webContents); t.view.webContents.close(); } catch (_) {} });
    this.tabs = [];
    [this.claude, this.pop, this.ui].forEach(v => { try { if (v) { this.ctx.unregister(v.webContents); v.webContents.close(); } } catch (_) {} });
    this.ctx.scheduleSave();
  }

  /* ---------- state naar de UI ---------- */
  push() {
    if (!this.alive() || this.ui.webContents.isDestroyed()) return;
    const t = this.cur();
    const nh = t ? t.view.webContents.navigationHistory : null;
    const d = this.ctx.data;
    const showBar = d.get().bookmarksBar;
    this.ui.webContents.send('state', {
      platform: process.platform, priv: this.priv, activeId: this.activeId, activeWc: t ? t.view.webContents.id : null, claudeOpen: this.claudeOpen,
      canBack: !!(nh && nh.canGoBack()), canForward: !!(nh && nh.canGoForward()),
      loading: !!(t && t.loading), bookmarked: !!(t && d.isBookmarked(t.url)),
      bookmarksBar: showBar, bookmarks: showBar ? d.bookmarks.data.map(b => ({ id: b.id, title: b.title })) : [],
      tabs: this.tabs.map(x => ({
        id: x.id, title: x.title, favicon: x.favicon, url: this.displayUrl(x.url),
        pinned: x.pinned, audible: x.audible, muted: x.muted
      }))
    });
    if (t) this.win.setTitle((t.title || 'Browsy') + (this.priv ? ' (privé)' : ''));
  }
  displayUrl(u) {
    if (!u || u.startsWith(NEWTAB)) return '';
    if (u.startsWith('daarom://error')) { try { return new URL(u).searchParams.get('url') || ''; } catch (_) { return ''; } }
    return u;
  }

  layout() {
    if (!this.alive()) return;
    const { width: W, height: H } = this.win.getContentBounds();
    const top = this.top();
    if (this.htmlFS) {
      this.ui.setBounds({ x: 0, y: 0, width: W, height: 0 });
      if (this.shown) this.shown.setBounds({ x: 0, y: 0, width: W, height: H });
      if (this.claude) this.claude.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const pw = this.claudeOpen ? Math.min(PANEL, Math.max(0, W - 320)) : 0;
    this.ui.setBounds({ x: 0, y: 0, width: W, height: top });
    if (this.shown) this.shown.setBounds({ x: 0, y: top, width: W - pw, height: H - top });
    if (this.claude && this.claudeOpen) this.claude.setBounds({ x: W - pw + 1, y: top, width: pw - 1, height: H - top });
    this.placePop();
  }

  setHtmlFS(on) { this.htmlFS = on; this.win.setFullScreen(on); this.layout(); }

  /* ---------- tabs ---------- */
  openHandler = details => {
    if (/^daarom:/i.test(details.url)) return { action: 'deny' };
    if (details.disposition === 'new-window' && details.features) return { action: 'allow' };
    if (details.url && details.url !== 'about:blank') this.createTab(details.url, { activate: details.disposition !== 'background-tab' });
    return { action: 'deny' };
  };

  createTab(url, o = {}) {
    const activate = o.activate !== false;
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true,
        preload: path.join(ROOT, 'preload-pages.js'), partition: this.partition }
    });
    const wc = view.webContents;
    const tab = { id: this.seq++, view, title: 'Nieuw tabblad', url: url || NEWTAB, favicon: '', loading: false, pinned: !!o.pinned, audible: false, muted: false, failed: false };
    if (typeof o.index === 'number') this.tabs.splice(o.index, 0, tab); else this.tabs.push(tab);
    if (tab.pinned) this.sortPinned();
    this.ctx.register(wc, this);
    if (!this.priv && this.ctx.extensions) { try { this.ctx.extensions.addTab(wc, this.win); } catch (_) {} }
    const d = this.ctx.data;

    wc.on('page-title-updated', (_e, t) => { tab.title = t || tab.title; if (!this.priv) d.setHistoryTitle(tab.url, t); this.push(); });
    wc.on('did-navigate', (_e, u) => {
      tab.url = u; tab.favicon = '';
      if (!this.priv) d.addHistory(u, wc.getTitle());
      if (this.popMode === 'find' && tab.id === this.activeId) this.closeFind();
      this.push(); this.ctx.scheduleSave();
    });
    wc.on('did-navigate-in-page', (_e, u, isMain) => { if (isMain) { tab.url = u; this.push(); this.ctx.scheduleSave(); } });
    wc.on('page-favicon-updated', (_e, f) => { tab.favicon = f[0] || ''; this.push(); });
    wc.on('did-start-loading', () => { tab.loading = true; this.push(); });
    wc.on('did-stop-loading', () => { tab.loading = false; tab.url = wc.getURL() || tab.url; this.push(); });
    wc.on('audio-state-changed', () => { tab.audible = wc.isCurrentlyAudible(); this.push(); });
    wc.on('enter-html-full-screen', () => this.setHtmlFS(true));
    wc.on('leave-html-full-screen', () => this.setHtmlFS(false));
    wc.on('focus', () => { if (this.popMode === 'suggest') this.hidePop(); });
    wc.on('context-menu', (_e, p) => this.pageMenu(wc, p));
    wc.on('found-in-page', (_e, r) => {
      if (tab.id === this.activeId) this.setPop({ found: { active: r.activeMatchOrdinal, matches: r.matches } });
    });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
      if (!isMain || code === -3 || /^daarom:/i.test(failedUrl)) return;
      wc.loadURL('daarom://error?code=' + code + '&desc=' + encodeURIComponent(desc) + '&url=' + encodeURIComponent(failedUrl)).catch(() => {});
    });
    wc.on('will-navigate', (e, target) => {
      if (/^(mailto|tel):/i.test(target)) { e.preventDefault(); shell.openExternal(target); return; }
      if (/^daarom:/i.test(target) && !/^daarom:/i.test(wc.getURL())) e.preventDefault();
    });
    wc.setWindowOpenHandler(this.openHandler);
    wc.loadURL(tab.url).catch(() => {});

    if (activate) this.setActive(tab.id); else this.push();
    this.ctx.scheduleSave();
    return tab;
  }

  sortPinned() {
    const p = this.tabs.filter(t => t.pinned), r = this.tabs.filter(t => !t.pinned);
    this.tabs = p.concat(r);
  }

  setActive(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) return;
    if (this.popMode === 'find') this.closeFind(true);
    if (this.popMode) this.hidePop();
    if (this.shown && this.shown !== t.view && this.win.contentView.children.includes(this.shown)) this.win.contentView.removeChildView(this.shown);
    this.shown = t.view; this.activeId = id;
    this.win.contentView.addChildView(t.view);
    this.layout(); this.push();
    t.view.webContents.focus();
    if (!this.priv && this.ctx.extensions) { try { this.ctx.extensions.selectTab(t.view.webContents); } catch (_) {} }
    this.ctx.scheduleSave();
  }

  closeTab(id) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    const u = t.view.webContents.getURL();
    if (!this.priv && u && !u.startsWith(NEWTAB)) { this.closed.push({ url: u, pinned: t.pinned }); if (this.closed.length > 25) this.closed.shift(); }
    if (this.win.contentView.children.includes(t.view)) this.win.contentView.removeChildView(t.view);
    if (this.shown === t.view) this.shown = null;
    if (!this.priv && this.ctx.extensions) { try { this.ctx.extensions.removeTab(t.view.webContents); } catch (_) {} }
    this.ctx.unregister(t.view.webContents);
    t.view.webContents.close();
    if (!this.tabs.length) { this.createTab(NEWTAB); return; }
    if (this.activeId === id) this.setActive(this.tabs[Math.min(i, this.tabs.length - 1)].id); else this.push();
    this.ctx.scheduleSave();
  }

  reopenClosed() { const c = this.closed.pop(); if (c) this.createTab(c.url, { pinned: c.pinned }); }
  stepTab(d) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex(t => t.id === this.activeId);
    this.setActive(this.tabs[(i + d + this.tabs.length) % this.tabs.length].id);
  }
  moveTab(id, to) {
    const i = this.tabs.findIndex(t => t.id === id); if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    const pc = this.tabs.filter(x => x.pinned).length;
    to = Math.max(0, Math.min(to, this.tabs.length));
    to = t.pinned ? Math.min(to, pc) : Math.max(to, pc);
    this.tabs.splice(to, 0, t);
    this.push(); this.ctx.scheduleSave();
  }
  togglePin(id) { const t = this.tabs.find(x => x.id === id); if (!t) return; t.pinned = !t.pinned; this.sortPinned(); this.push(); this.ctx.scheduleSave(); }
  toggleMute(id) { const t = this.tabs.find(x => x.id === id); if (!t) return; t.muted = !t.muted; t.view.webContents.setAudioMuted(t.muted); this.push(); }
  duplicate(id) { const t = this.tabs.find(x => x.id === id); if (t) this.createTab(t.view.webContents.getURL() || t.url, { index: this.tabs.indexOf(t) + 1 }); }

  tabMenu(id) {
    const t = this.tabs.find(x => x.id === id); if (!t) return;
    const i = this.tabs.indexOf(t);
    Menu.buildFromTemplate([
      { label: 'Nieuw tabblad rechts', click: () => this.createTab(NEWTAB, { index: i + 1 }) },
      { label: 'Herlaad', click: () => t.view.webContents.reload() },
      { label: 'Dupliceer', click: () => this.duplicate(id) },
      { type: 'separator' },
      { label: t.pinned ? 'Maak los' : 'Zet vast', click: () => this.togglePin(id) },
      { label: t.muted ? 'Geluid aan' : 'Dempen', click: () => this.toggleMute(id) },
      { type: 'separator' },
      { label: 'Sluit tabblad', click: () => this.closeTab(id) },
      { label: 'Sluit andere tabbladen', click: () => this.tabs.filter(x => x.id !== id && !x.pinned).forEach(x => this.closeTab(x.id)) },
      { label: 'Sluit tabbladen rechts', click: () => this.tabs.slice(i + 1).filter(x => !x.pinned).forEach(x => this.closeTab(x.id)) }
    ]).popup({ window: this.win });
  }

  pageMenu(wc, p) {
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'Open link in nieuw tabblad', click: () => this.createTab(p.linkURL, { activate: false }) },
        { label: 'Open link in privévenster', click: () => this.ctx.newWindow({ private: true, urls: [p.linkURL] }) },
        { label: 'Kopieer linkadres', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'cut', label: 'Knip' }, { role: 'copy', label: 'Kopieer' }, { role: 'paste', label: 'Plak' }, { role: 'selectAll', label: 'Selecteer alles' });
      (p.dictionarySuggestions || []).slice(0, 4).forEach(s => items.unshift({ label: s, click: () => wc.replaceMisspelling(s) }));
      if (p.misspelledWord) items.unshift({ type: 'separator' });
    } else if (p.selectionText) {
      items.push({ role: 'copy', label: 'Kopieer' },
        { label: 'Zoek op het web naar "' + p.selectionText.trim().slice(0, 24) + '"', click: () => this.createTab(this.ctx.data.searchUrl(p.selectionText.trim())) });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Open afbeelding in nieuw tabblad', click: () => this.createTab(p.srcURL, { activate: false }) },
        { label: 'Sla afbeelding op', click: () => wc.downloadURL(p.srcURL) },
        { label: 'Kopieer afbeelding', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Kopieer afbeeldingsadres', click: () => clipboard.writeText(p.srcURL) });
    }
    if (!p.linkURL && !p.isEditable && !p.selectionText) {
      const nh = wc.navigationHistory;
      items.push({ label: 'Terug', enabled: nh.canGoBack(), click: () => nh.goBack() },
        { label: 'Vooruit', enabled: nh.canGoForward(), click: () => nh.goForward() },
        { label: 'Herlaad', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Afdrukken...', click: () => wc.print() },
        { label: 'Sla pagina op als PDF...', click: () => this.savePDF() });
    }
    if (!this.priv && this.ctx.extensions) { try { const ex = this.ctx.extensions.getContextMenuItems(wc, p); if (ex.length) items.push({ type: 'separator' }, ...ex); } catch (_) {} }
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Onderdeel inspecteren', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  async savePDF() {
    const t = this.cur(); if (!t) return;
    try {
      const data = await t.view.webContents.printToPDF({});
      const r = await dialog.showSaveDialog(this.win, { defaultPath: (t.title || 'pagina').replace(/[\\/:*?"<>|]/g, '_') + '.pdf' });
      if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, data);
    } catch (_) {}
  }

  /* ---------- navigeren en bladwijzers ---------- */
  go(text) {
    const t = this.cur(); if (!t) return;
    this.hidePop();
    t.view.webContents.loadURL(this.ctx.toURL(text)).catch(() => {});
    t.view.webContents.focus();
  }
  reloadOrStop() { const t = this.cur(); if (!t) return; if (t.loading) t.view.webContents.stop(); else t.view.webContents.reload(); }
  toggleBookmark() {
    const t = this.cur(); if (!t) return;
    const d = this.ctx.data;
    if (d.isBookmarked(t.url)) d.removeBookmarkByUrl(t.url); else d.addBookmark(t.title, t.view.webContents.getURL() || t.url);
    this.ctx.pushAll();
  }
  bookmarkMenu(id) {
    const d = this.ctx.data, b = d.bookmarks.data.find(x => x.id === id); if (!b) return;
    Menu.buildFromTemplate([
      { label: 'Open', click: () => this.go(b.url) },
      { label: 'Open in nieuw tabblad', click: () => this.createTab(b.url) },
      { label: 'Open in privévenster', click: () => this.ctx.newWindow({ private: true, urls: [b.url] }) },
      { type: 'separator' },
      { label: 'Verwijder bladwijzer', click: () => { d.removeBookmark(id); this.ctx.pushAll(); } }
    ]).popup({ window: this.win });
  }

  /* ---------- overlay: zoeken op pagina en suggesties ---------- */
  ensurePop() {
    if (this.pop) return;
    this.pop = new WebContentsView({
      webPreferences: { preload: path.join(ROOT, 'preload-pop.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    this.pop.setBackgroundColor('#00000000');
    this.popReady = false;
    this.ctx.register(this.pop.webContents, this);
    this.pop.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.pop.webContents.loadFile(path.join(ROOT, 'ui', 'popup.html'));
  }
  showPop(mode) {
    this.ensurePop();
    this.popMode = mode;
    this.win.contentView.addChildView(this.pop);   // bovenaan zetten
    this.placePop();
    this.setPop({ mode });
  }
  hidePop() {
    if (!this.pop || !this.popMode) return;
    this.popMode = null;
    if (this.win.contentView.children.includes(this.pop)) this.win.contentView.removeChildView(this.pop);
    this.sugg = []; this.sel = -1;
  }
  setPop(state) {
    this.popState = Object.assign({}, this.popState, state);
    if (this.pop && this.popReady && !this.pop.webContents.isDestroyed()) this.pop.webContents.send('pop:state', this.popState);
  }
  placePop() {
    if (!this.pop || !this.popMode) return;
    const { width: W } = this.win.getContentBounds();
    const top = this.top();
    if (this.popMode === 'find') {
      const pw = this.claudeOpen ? Math.min(PANEL, Math.max(0, W - 320)) : 0;
      this.pop.setBounds({ x: Math.max(8, W - pw - 404), y: top + 8, width: 396, height: 52 });
    } else {
      const h = Math.min(this.sugg.length * 40 + 14, 380);
      this.pop.setBounds({ x: Math.round(this.addrRect.x), y: 92, width: Math.round(this.addrRect.width), height: h });
    }
  }
  openFind() {
    const t = this.cur(); if (!t) return;
    this.showPop('find');
    this.setPop({ mode: 'find', text: this.lastFind, found: { active: 0, matches: 0 } });
    this.pop.webContents.focus();
    this.pop.webContents.send('pop:focus');
    if (this.lastFind) t.view.webContents.findInPage(this.lastFind);
  }
  find(text, forward = true, next = false) {
    const t = this.cur(); if (!t) return;
    this.lastFind = text;
    if (!text) { t.view.webContents.stopFindInPage('clearSelection'); this.setPop({ found: { active: 0, matches: 0 } }); return; }
    t.view.webContents.findInPage(text, { forward, findNext: next });
  }
  closeFind(keepFocus) {
    const t = this.cur();
    if (t) { try { t.view.webContents.stopFindInPage('clearSelection'); } catch (_) {} }
    if (this.popMode === 'find') this.hidePop();
    if (t && !keepFocus) t.view.webContents.focus();
  }
  suggest(text, rect) {
    if (rect) this.addrRect = rect;
    this.typed = text;
    this.sugg = this.ctx.suggestions(text);
    this.sel = -1;
    if (!this.sugg.length) { if (this.popMode === 'suggest') this.hidePop(); return; }
    this.showPop('suggest');
    this.setPop({ mode: 'suggest', items: this.sugg, sel: -1 });
  }
  moveSel(d) {
    if (!this.sugg.length) return this.typed;
    this.sel = Math.max(-1, Math.min(this.sugg.length - 1, this.sel + d));
    this.setPop({ sel: this.sel });
    return this.sel >= 0 ? this.sugg[this.sel].url : this.typed;
  }

  /* ---------- Claude-paneel ---------- */
  toggleClaude() {
    if (!this.claude) {
      this.claude = new WebContentsView({ webPreferences: { partition: this.priv ? 'private-claude-' + this.id : 'persist:claude', sandbox: true, contextIsolation: true } });
      this.ctx.prepareSession(this.claude.webContents.session);
      this.ctx.register(this.claude.webContents, this);
      this.claude.webContents.setWindowOpenHandler(this.openHandler);
      this.claude.webContents.loadURL('https://claude.ai/new').catch(() => {});
    }
    this.claudeOpen = !this.claudeOpen;
    if (this.claudeOpen) this.win.contentView.addChildView(this.claude); else this.win.contentView.removeChildView(this.claude);
    this.layout(); this.push();
    if (this.claudeOpen) this.claude.webContents.focus(); else if (this.shown) this.shown.webContents.focus();
  }
}

module.exports = { BrowserWin, NEWTAB };
