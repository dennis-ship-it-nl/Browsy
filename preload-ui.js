const { contextBridge, ipcRenderer } = require('electron');
try { require('electron-chrome-extensions/browser-action').injectBrowserAction(); } catch (_) {}
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusAddress: cb => ipcRenderer.on('focus-address', () => cb()),
  ready: () => call('ui:ready'),
  newTab: () => call('tab:new'),
  closeTab: id => call('tab:close', id),
  switchTab: id => call('tab:switch', id),
  moveTab: (id, to) => call('tab:move', id, to),
  tabMenu: id => call('tab:menu', id),
  go: text => call('nav', String(text)),
  back: () => call('back'),
  forward: () => call('forward'),
  reload: () => call('reload'),
  toggleClaude: () => call('claude:toggle'),
  toggleBookmark: () => call('bookmark:toggle'),
  openBookmark: (id, inNew) => call('bookmark:open', id, !!inNew),
  bookmarkMenu: id => call('bookmark:menu', id),
  suggest: (text, rect) => call('suggest:query', String(text), rect),
  suggestMove: d => call('suggest:move', d),
  suggestClose: () => call('suggest:close'),
  mainMenu: () => call('menu:main'),
  __test: code => call('test:eval', code)
});
