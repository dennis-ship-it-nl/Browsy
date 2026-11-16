// Versleutelde wachtwoordkluis. De sleutel zit in de macOS-sleutelhanger (Electron safeStorage),
// het bestand zelf staat in de gebruikersmap van Browsy en is zonder die sleutel onleesbaar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const hostKey = h => String(h || '').toLowerCase().replace(/^www\./, '');
function hostOfUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname : ''; } catch (_) { return ''; } }

function createVault() {
  const file = path.join(app.getPath('userData'), 'wachtwoorden.bin');
  let data = { entries: [], never: [] };
  let timer = null, broken = false;

  let ok = false, dirty = false;
  const available = () => ok;

  async function load() {
    try { ok = await safeStorage.isAsyncEncryptionAvailable(); } catch (_) { ok = false; }
    if (!fs.existsSync(file)) return;
    if (!ok) { broken = true; return; }
    try {
      const r = await safeStorage.decryptStringAsync(fs.readFileSync(file));
      const j = JSON.parse(r.result);
      data = { entries: Array.isArray(j.entries) ? j.entries : [], never: Array.isArray(j.never) ? j.never : [] };
      if (r.shouldReEncrypt) save();
    } catch (_) { broken = true; }   // niet overschrijven als lezen mislukt
  }
  async function flush() {
    clearTimeout(timer);
    if (broken || !ok || !dirty) return;
    dirty = false;
    try {
      const buf = await safeStorage.encryptStringAsync(JSON.stringify(data));
      fs.writeFileSync(file + '.tmp', buf, { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    } catch (_) { dirty = true; }
  }
  // Bij afsluiten is er geen tijd voor async werk
  function flushSync() {
    clearTimeout(timer);
    if (broken || !ok || !dirty) return;
    try {
      fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file); dirty = false;
    } catch (_) {}
  }
  const save = () => { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 300); };
  if (process.env.DAAROM_TEST === '1' && process.platform === 'linux') { try { safeStorage.setUsePlainTextEncryption(true); } catch (_) {} }
  const ready = load();

  const api = {
    available, flush: flushSync, ready,
    get broken() { return broken; },
    hostOfUrl, hostKey,
    list(q) {
      q = String(q || '').toLowerCase();
      return data.entries
        .filter(e => !q || e.host.includes(q) || e.username.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q))
        .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username))
        .map(e => ({ id: e.id, host: e.host, url: e.url, title: e.title, username: e.username, notes: !!e.notes, updated: e.updated }));
    },
    get: id => data.entries.find(e => e.id === id) || null,
    forHost(host) {
      const k = hostKey(host); if (!k) return [];
      return data.entries.filter(e => hostKey(e.host) === k).sort((a, b) => (b.used || b.updated || 0) - (a.used || a.updated || 0));
    },
    find(host, username) { return api.forHost(host).find(e => e.username === username) || null; },
    add({ url, username, password, title, notes }) {
      const host = hostOfUrl(url) || String(url || '').trim().replace(/^https?:\/\//i, '').split('/')[0];
      if (!host || !password) return null;
      const now = Date.now();
      const ex = api.find(host, username || '');
      if (ex) { ex.password = password; ex.updated = now; if (notes) ex.notes = notes; save(); return ex; }
      const e = { id: crypto.randomUUID(), host: hostKey(host), url: /^https?:\/\//i.test(url) ? url : 'https://' + host, title: title || hostKey(host),
        username: username || '', password, notes: notes || '', created: now, updated: now };
      data.entries.push(e); save(); return e;
    },
    update(id, patch) {
      const e = api.get(id); if (!e) return false;
      if (typeof patch.username === 'string') e.username = patch.username;
      if (typeof patch.password === 'string' && patch.password) e.password = patch.password;
      if (typeof patch.title === 'string') e.title = patch.title;
      if (typeof patch.notes === 'string') e.notes = patch.notes;
      e.updated = Date.now(); save(); return true;
    },
    touch(id) { const e = api.get(id); if (e) { e.used = Date.now(); save(); } },
    remove(id) { const i = data.entries.findIndex(e => e.id === id); if (i >= 0) { data.entries.splice(i, 1); save(); return true; } return false; },
    isNever: host => data.never.includes(hostKey(host)),
    addNever(host) { const k = hostKey(host); if (k && !data.never.includes(k)) { data.never.push(k); save(); } },
    clearNever() { data.never = []; save(); },
    count: () => data.entries.length,
    all: () => data.entries
  };
  return api;
}

/* ---------- CSV (Wachtwoorden-app van Apple, Chrome en andere beheerders) ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function entriesFromCSV(text) {
  const rows = parseCSV(text); if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iT = col('title', 'name', 'naam'), iU = col('url', 'website', 'login_uri', 'web site'), iN = col('username', 'login_username', 'user', 'gebruikersnaam'),
    iP = col('password', 'login_password', 'wachtwoord'), iNote = col('notes', 'note', 'notities');
  if (iP < 0 || iU < 0) return [];
  return rows.slice(1).map(r => ({ title: iT >= 0 ? r[iT] : '', url: r[iU] || '', username: iN >= 0 ? r[iN] : '', password: r[iP] || '', notes: iNote >= 0 ? r[iNote] : '' }))
    .filter(e => e.url && e.password);
}
function toCSV(entries) {
  const esc = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [['Title', 'URL', 'Username', 'Password', 'Notes'].join(',')];
  entries.forEach(e => lines.push([e.title, e.url, e.username, e.password, e.notes].map(esc).join(',')));
  return lines.join('\n') + '\n';
}

module.exports = { createVault, entriesFromCSV, toCSV, parseCSV, hostOfUrl };
