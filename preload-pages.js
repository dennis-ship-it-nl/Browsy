// Draait in elk tabblad, maar geeft alleen toegang op interne daarom:// pagina's
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'daarom:') {
  contextBridge.exposeInMainWorld('daarom', {
    invoke: (name, ...args) => ipcRenderer.invoke('pages:' + name, ...args)
  });
}
