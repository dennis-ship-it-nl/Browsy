const { Menu, app, shell, dialog } = require('electron');

function buildMenus(ctx) {
  const F = () => ctx.focused();
  const tabDo = fn => () => { const w = F(); const t = w && w.cur(); if (t) fn(t.view.webContents, w, t); };
  const isMac = process.platform === 'darwin';

  const common = {
    newTab: { label: 'Nieuw tabblad', accelerator: 'CmdOrCtrl+T', click: () => { const w = F(); w ? w.createTab('daarom://newtab') : ctx.newWindow(); } },
    newWin: { label: 'Nieuw venster', accelerator: 'CmdOrCtrl+N', click: () => ctx.newWindow() },
    newPriv: { label: 'Nieuw privévenster', accelerator: 'CmdOrCtrl+Shift+N', click: () => ctx.newWindow({ private: true }) },
    reopen: { label: 'Heropen gesloten tabblad', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const w = F(); if (w) w.reopenClosed(); } },
    find: { label: 'Zoek op pagina', accelerator: 'CmdOrCtrl+F', click: () => { const w = F(); if (w) w.openFind(); } },
    print: { label: 'Afdrukken...', accelerator: 'CmdOrCtrl+P', click: tabDo(wc => wc.print()) },
    pdf: { label: 'Sla pagina op als PDF...', click: () => { const w = F(); if (w) w.savePDF(); } },
    history: { label: 'Toon geschiedenis', accelerator: 'CmdOrCtrl+Y', click: () => ctx.openPage('history') },
    bookmarks: { label: 'Bladwijzerbeheer', accelerator: 'CmdOrCtrl+Alt+B', click: () => ctx.openPage('bookmarks') },
    downloads: { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => ctx.openPage('downloads') },
    settings: { label: 'Instellingen', accelerator: 'CmdOrCtrl+,', click: () => ctx.openPage('settings') },
    claude: { label: 'Claude-paneel', accelerator: 'CmdOrCtrl+E', click: () => { const w = F(); if (w) w.toggleClaude(); } },
    devtools: { label: 'Ontwikkelaarstools', accelerator: 'CmdOrCtrl+Alt+I', click: tabDo(wc => wc.openDevTools({ mode: 'detach' })) },
    defaultBrowser: { label: 'Maak standaardbrowser', click: () => ctx.makeDefault() },
    update: { label: 'Zoek naar updates...', click: () => { const u = require('../package.json').updateUrl; if (u) shell.openExternal(u); } }
  };

  const template = [
    { label: 'Browsy', submenu: [
      { role: 'about', label: 'Over Browsy' }, common.update, { type: 'separator' },
      common.settings, common.defaultBrowser, { type: 'separator' },
      { role: 'hide', label: 'Verberg' }, { role: 'hideOthers', label: 'Verberg andere' }, { type: 'separator' },
      { role: 'quit', label: 'Stop Browsy' } ] },
    { label: 'Bestand', submenu: [
      common.newTab, common.newWin, common.newPriv, common.reopen, { type: 'separator' },
      { label: 'Adresbalk', accelerator: 'CmdOrCtrl+L', click: () => { const w = F(); if (w) { w.ui.webContents.focus(); w.ui.webContents.send('focus-address'); } } },
      { label: 'Sluit tabblad', accelerator: 'CmdOrCtrl+W', click: () => { const w = F(); if (w && w.activeId) w.closeTab(w.activeId); } },
      { label: 'Sluit venster', accelerator: 'CmdOrCtrl+Shift+W', click: () => { const w = F(); if (w) w.win.close(); } },
      { type: 'separator' }, common.print, common.pdf ] },
    { label: 'Bewerken', submenu: [
      { role: 'undo', label: 'Herstel' }, { role: 'redo', label: 'Opnieuw' }, { type: 'separator' },
      { role: 'cut', label: 'Knip' }, { role: 'copy', label: 'Kopieer' }, { role: 'paste', label: 'Plak' },
      { role: 'selectAll', label: 'Selecteer alles' }, { type: 'separator' },
      common.find,
      { label: 'Zoek volgende', accelerator: 'CmdOrCtrl+G', click: () => { const w = F(); if (w && w.lastFind) w.find(w.lastFind, true, true); } },
      { label: 'Zoek vorige', accelerator: 'CmdOrCtrl+Shift+G', click: () => { const w = F(); if (w && w.lastFind) w.find(w.lastFind, false, true); } } ] },
    { label: 'Weergave', submenu: [
      { label: 'Herlaad pagina', accelerator: 'CmdOrCtrl+R', click: tabDo(wc => wc.reload()) },
      { label: 'Herlaad zonder cache', accelerator: 'CmdOrCtrl+Shift+R', click: tabDo(wc => wc.reloadIgnoringCache()) },
      { type: 'separator' },
      { label: 'Bladwijzerbalk', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+B', checked: ctx.data.get().bookmarksBar,
        click: m => { ctx.data.set({ bookmarksBar: m.checked }); ctx.relayout(); } },
      common.claude, { type: 'separator' },
      { role: 'resetZoom', label: 'Werkelijke grootte' }, { role: 'zoomIn', label: 'Zoom in' }, { role: 'zoomOut', label: 'Zoom uit' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Volledig scherm' }, common.devtools ] },
    { label: 'Geschiedenis', submenu: [
      { label: 'Terug', accelerator: 'CmdOrCtrl+[', click: tabDo(wc => wc.navigationHistory.goBack()) },
      { label: 'Vooruit', accelerator: 'CmdOrCtrl+]', click: tabDo(wc => wc.navigationHistory.goForward()) },
      { type: 'separator' }, common.history, common.reopen ] },
    { label: 'Bladwijzers', submenu: [
      { label: 'Voeg bladwijzer toe of verwijder', accelerator: 'CmdOrCtrl+D', click: () => { const w = F(); if (w) w.toggleBookmark(); } },
      common.bookmarks, { type: 'separator' },
      { label: 'Importeer bladwijzers uit Chrome', click: () => ctx.importChrome(true) } ] },
    { label: 'Tabbladen', submenu: [
      { label: 'Volgend tabblad', accelerator: 'Ctrl+Tab', click: () => { const w = F(); if (w) w.stepTab(1); } },
      { label: 'Vorig tabblad', accelerator: 'Ctrl+Shift+Tab', click: () => { const w = F(); if (w) w.stepTab(-1); } },
      { type: 'separator' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ label: 'Tabblad ' + n, accelerator: 'CmdOrCtrl+' + n,
        click: () => { const w = F(); if (!w) return; const t = n === 9 ? w.tabs[w.tabs.length - 1] : w.tabs[n - 1]; if (t) w.setActive(t.id); } })),
      { type: 'separator' }, common.downloads ] },
    { role: 'windowMenu', label: 'Venster' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // menu achter de knop rechts in de werkbalk
  ctx.popupMainMenu = win => Menu.buildFromTemplate([
    common.newTab, common.newWin, common.newPriv, { type: 'separator' },
    common.history, common.bookmarks, common.downloads, { type: 'separator' },
    common.find, common.print, common.pdf, { type: 'separator' },
    { label: 'Zoom in', role: 'zoomIn' }, { label: 'Zoom uit', role: 'zoomOut' }, { label: 'Werkelijke grootte', role: 'resetZoom' },
    { type: 'separator' }, common.devtools, common.settings
  ]).popup({ window: win.win });
}

module.exports = { buildMenus };
