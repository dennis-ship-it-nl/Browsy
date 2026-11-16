// Vult Chrome-extensie-API's aan die Electron en electron-chrome-extensions (nog) niet bieden.
// Zonder dit crasht een extensie met "Cannot read properties of undefined" zodra hij bijvoorbeeld
// chrome.sidePanel of chrome.identity gebruikt. Alleen API's waarvoor de extensie toestemming
// in zijn manifest vraagt worden aangevuld, en alleen als ze er nog niet zijn.
const { contextBridge } = require('electron');

if ((process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) && 'executeInMainWorld' in contextBridge) {
  contextBridge.executeInMainWorld({
    func: () => {
      const c = globalThis.chrome;
      if (!c) return;
      // De manifest is op dit moment mogelijk nog niet beschikbaar, dus lees hem pas bij gebruik.
      let permCache = null;
      const has = n => {
        if (!permCache) {
          let m = null;
          try { m = c.runtime.getManifest && c.runtime.getManifest(); } catch (_) {}
          if (!m) return false;
          permCache = [].concat(m.permissions || [], m.optional_permissions || []);
        }
        return permCache.includes(n);
      };

      const ev = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; }, hasListeners() { return false; }, addRules() {}, removeRules() {}, getRules() {} });
      const val = (v) => (...a) => {
        const r = typeof v === 'function' ? v(...a) : v;
        const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
        if (cb) { cb(r); return; }
        return Promise.resolve(r);
      };
      const no = (msg) => () => Promise.reject(new Error(msg));
      // Accessor: de API verschijnt alleen als de extensie er toestemming voor heeft en er niet al een echte is.
      const define = (name, api, perm) => {
        try {
          if (Object.getOwnPropertyDescriptor(c, name)) return;
          Object.defineProperty(c, name, {
            configurable: true, enumerable: true,
            get() { return has(perm || name) ? api : undefined; },
            set() {}
          });
        } catch (_) {}
      };

      define('sidePanel', {
        setOptions: val(undefined), getOptions: val({}), setPanelBehavior: val(undefined),
        getPanelBehavior: val({ openPanelOnActionClick: false }), open: val(undefined)
      });
      define('identity', {
        getAuthToken: no('Inloggen via Google (chrome.identity) wordt in Browsy niet ondersteund.'),
        launchWebAuthFlow: no('Inloggen via chrome.identity wordt in Browsy niet ondersteund.'),
        getRedirectURL: (p) => 'https://' + (c.runtime && c.runtime.id) + '.chromiumapp.org/' + (p || ''),
        getProfileUserInfo: val({ email: '', id: '' }),
        clearAllCachedAuthTokens: val(undefined), removeCachedAuthToken: val(undefined),
        onSignInChanged: ev()
      });
      define('history', {
        search: val([]), getVisits: val([]), addUrl: val(undefined), deleteUrl: val(undefined),
        deleteRange: val(undefined), deleteAll: val(undefined), onVisited: ev(), onVisitRemoved: ev()
      });
      define('bookmarks', {
        getTree: val([{ id: '0', title: '', children: [] }]), get: val([]), getChildren: val([]), getRecent: val([]),
        getSubTree: val([]), search: val([]), create: val({ id: '', title: '' }), update: val({}), move: val({}),
        remove: val(undefined), removeTree: val(undefined),
        onCreated: ev(), onRemoved: ev(), onChanged: ev(), onMoved: ev(), onChildrenReordered: ev(), onImportBegan: ev(), onImportEnded: ev()
      });
      define('sessions', {
        getRecentlyClosed: val([]), getDevices: val([]), restore: val({}), MAX_SESSION_RESULTS: 25, onChanged: ev()
      });
      define('tabGroups', {
        get: no('Tabbladgroepen worden in Browsy niet ondersteund.'), query: val([]), update: val({}), move: val({}),
        TAB_GROUP_ID_NONE: -1, onCreated: ev(), onRemoved: ev(), onUpdated: ev(), onMoved: ev()
      });
      define('offscreen', {
        createDocument: no('Offscreen-documenten worden in Browsy niet ondersteund.'),
        closeDocument: val(undefined), hasDocument: val(false)
      });
      define('idle', { queryState: val('active'), setDetectionInterval() {}, onStateChanged: ev() });
      define('tts', {
        speak: val(undefined), stop() {}, pause() {}, resume() {}, isSpeaking: val(false), getVoices: val([]), onVoicesChanged: ev()
      });
      define('declarativeContent', { onPageChanged: ev() });
      define('system', {
        display: { getInfo: val([]), onDisplayChanged: ev() },
        cpu: { getInfo: val({ numOfProcessors: navigator.hardwareConcurrency || 4, archName: '', modelName: '', features: [], processors: [] }) },
        memory: { getInfo: val({ capacity: 0, availableCapacity: 0 }) }
      }, 'system.display');
      if (c.storage && !c.storage.managed) {
        try { c.storage.managed = { get: val({}), getBytesInUse: val(0), set: no('Alleen-lezen opslag'), remove: no('Alleen-lezen opslag'), clear: no('Alleen-lezen opslag'), onChanged: ev() }; } catch (_) {}
      }
      if (c.runtime && !c.runtime.getContexts) { try { c.runtime.getContexts = val([]); } catch (_) {} }
      if (c.tabs) {
        if (!c.tabs.group) { try { c.tabs.group = val(-1); } catch (_) {} }
        if (!c.tabs.ungroup) { try { c.tabs.ungroup = val(undefined); } catch (_) {} }
      }
    }
  });
}
