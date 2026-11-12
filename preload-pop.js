const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  onState: cb => ipcRenderer.on('pop:state', (_e, s) => cb(s)),
  onFocus: cb => ipcRenderer.on('pop:focus', () => cb()),
  ready: () => call('pop:ready'),
  pick: i => call('pop:pick', i),
  findQuery: t => call('find:query', String(t)),
  findStep: fwd => call('find:step', !!fwd),
  findClose: () => call('find:close')
});
