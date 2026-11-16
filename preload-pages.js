// Draait in elk tabblad. Op daarom:// pagina's geeft het toegang tot de interne API,
// op gewone sites regelt het alleen het opslaan en invullen van wachtwoorden.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'daarom:') {
  contextBridge.exposeInMainWorld('daarom', {
    invoke: (name, ...args) => ipcRenderer.invoke('pages:' + name, ...args)
  });
}

if (location.protocol === 'https:' || location.protocol === 'http:') {
  try { passwords(); } catch (_) {}
}

function passwords() {
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const pwFields = scope => [...scope.querySelectorAll('input[type="password"]')].filter(visible);
  const textLike = el => el instanceof HTMLInputElement && !el.disabled && !el.readOnly && visible(el) &&
    ['text', 'email', 'tel', 'url', ''].includes((el.getAttribute('type') || '').toLowerCase());
  const scopeOf = el => el.form || el.closest('form') || document;

  // Het gebruikersnaamveld hoort bij het wachtwoordveld: het dichtstbijzijnde tekstveld ervoor
  function usernameFor(pw) {
    const scope = scopeOf(pw);
    const all = [...scope.querySelectorAll('input')];
    const idx = all.indexOf(pw);
    const before = all.slice(0, idx < 0 ? all.length : idx).filter(textLike);
    const named = before.filter(i => /username|email/.test((i.autocomplete || '') + ' ' + i.name + ' ' + i.id));
    return (named.length ? named : before).pop() || null;
  }
  // Bij "wijzig wachtwoord" met meerdere velden is het nieuwe wachtwoord het laatste
  function pickPassword(scope) {
    const f = pwFields(scope).filter(i => i.value);
    if (!f.length) return null;
    const nw = f.find(i => i.autocomplete === 'new-password');
    if (nw) return nw;
    if (f.length >= 2 && f[f.length - 1].value === f[f.length - 2].value) return f[f.length - 1];
    return f[0];
  }

  let lastSent = '';
  function capture(scope) {
    if (!scope) return;
    const pw = pickPassword(scope); if (!pw) return;
    const u = usernameFor(pw);
    const key = (u ? u.value : '') + '\u0000' + pw.value;
    if (key === lastSent) return;
    lastSent = key; setTimeout(() => { lastSent = ''; }, 1500);
    ipcRenderer.send('pw:captured', { username: u ? u.value : '', password: pw.value });
  }
  document.addEventListener('submit', e => { if (e.isTrusted) capture(e.target); }, true);
  document.addEventListener('click', e => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const b = e.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a');
    if (b) capture(scopeOf(b));
  }, true);
  document.addEventListener('keydown', e => {
    if (!e.isTrusted || e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    capture(scopeOf(e.target));
  }, true);

  // Invullen gebeurt alleen na een echte klik of toetsaanslag van de gebruiker in een inlogveld
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const declined = new WeakSet();
  let busy = false;
  async function offer(target) {
    if (busy || !(target instanceof HTMLInputElement)) return;
    const scope = scopeOf(target);
    const pws = pwFields(scope);
    if (!pws.length) return;
    const pw = pws[0];
    const user = usernameFor(pw);
    const isField = target === pw || target === user;
    if (!isField || pw.value || declined.has(pw)) return;
    if (user && user.value) return;
    busy = true;
    try {
      const r = await ipcRenderer.invoke('pw:request');
      if (!r) { declined.add(pw); return; }
      if (user && !user.value) setVal(user, r.username || '');
      setVal(pw, r.password);
    } finally { busy = false; }
  }
  document.addEventListener('click', e => { if (e.isTrusted) offer(e.target); }, true);
  document.addEventListener('focusin', e => {
    if (e.isTrusted && navigator.userActivation && navigator.userActivation.isActive) offer(e.target);
  }, true);
}
